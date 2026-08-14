const Redis = require("ioredis");
const axios = require("axios");
const adsCopyChats = require("../Module/adCopy/Chats");
const checkUserExist = require("../Module/adCopy/CheckUserExist");
const { default: mongoose } = require("mongoose");
const logger = require("../utils/logger");
const { updateAdCopyConversation } = require("./newHistory");
const UnifiedCreditController = require("./UnifiedCreditController");
const { trackBackendGA4Event } = require("../utils/ga4");

exports.redisGetSet = new Redis({
  host: process.env.HOST,
  port: process.env.RD_PORT,
  username: process.env.RD_USERNAME,
  password: process.env.redisPass
});

const emitAdCopyError = (payload, message) => {
  trackBackendGA4Event('generation_failed', {
    user_id: payload?.user_id,
    feature: 'ad_copy',
    asset_type: 'copy',
    success: false,
    error_code: 'GENERATION_ERROR',
  });
  emitToSocket(payload?.socket_id, "adCopyResponse", {
    user_id: payload?.user_id,
    sessionId: payload?.sessionId,
    socket_id: payload?.socket_id,
    result: message,
    isLastChunk: true,
    limit: false,
    chatId: payload?.chatId,
    error: true,
  });
};

// Persist the failure into history so a page refresh doesn't show a
// skeleton loader over an unfinished conversation slot. Without this,
// the bot entry stays at `complete: false` and the UI keeps waiting.
const persistAdCopyError = (payload, message) => {
  updateAdCopyConversation({
    sessionId: payload?.sessionId,
    chatId: payload?.chatId,
    adCopyText: message,
  });
};

// Parse the SSE stream coming back from Python's adcopy/generate endpoint.
// Python emits frames separated by blank lines, e.g.:
//   event: chunk
//   data: { "adCopyText": "...", "isLastChunk": false, ... }
//
//   event: final
//   data: { "adCopyText": "...", "sentPayload": {...}, ... }
const consumeAdCopyStream = (stream, requestPayload) => {
  let buffer = "";
  let eventName = "";
  let dataLines = [];
  let finalReceived = false;

  const dispatch = () => {
    if (!eventName && dataLines.length === 0) return;
    let parsed;
    try {
      parsed = JSON.parse(dataLines.join("\n"));
    } catch (e) {
      logger.error(`SSE parse error: ${e?.message}`);
      eventName = "";
      dataLines = [];
      return;
    }
    if (eventName === "chunk") {
      handleAdCopyChunk(parsed);
    } else if (eventName === "final") {
      finalReceived = true;
      handleAdCopyFinal(parsed);
      updateAdCopyConversation(parsed);
    } else if (eventName === "error") {
      const msg =
        parsed?.adCopyText ||
        "Sorry, we couldn't generate ad copy right now. Please try again.";
      finalReceived = true;
      emitAdCopyError(parsed, msg);
      persistAdCopyError(
        { ...requestPayload, ...parsed, adCopyText: msg },
        msg
      );
    }
    eventName = "";
    dataLines = [];
  };

  stream.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      if (line === "") {
        dispatch();
      } else if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  });

  stream.on("end", () => {
    if (eventName || dataLines.length) dispatch();
    // Stream ended without a final/error event — treat as a failure so the
    // UI exits its loading state and history doesn't stay incomplete.
    if (!finalReceived) {
      const msg =
        "Sorry, we couldn't generate ad copy right now. Please try again.";
      emitAdCopyError(requestPayload, msg);
      persistAdCopyError(requestPayload, msg);
    }
  });

  stream.on("error", (err) => {
    logger.error(`Ad copy SSE stream error: ${err?.message}`);
    if (!finalReceived) {
      const msg =
        "Sorry, we couldn't generate ad copy right now. Please try again.";
      emitAdCopyError(requestPayload, msg);
      persistAdCopyError(requestPayload, msg);
      finalReceived = true;
    }
  });
};

exports.sendAdCopyRequest = async (payload) => {
  trackBackendGA4Event('ad_copy', {
    user_id: payload?.user_id,
    feature: 'ad_copy',
    action_name: 'adcopy_requested',
    source: 'adcopy_prompt',
    success: true,
  });
  const apiUrl = process.env.ADCOPY_REQUEST_API;
  try {
    if (!apiUrl) throw new Error("ADCOPY_REQUEST_API env var is not set");
    const response = await axios.post(apiUrl, payload, {
      responseType: "stream",
      headers: { Accept: "text/event-stream" },
    });
    consumeAdCopyStream(response.data, payload);
  } catch (error) {
    // Python rejected the request — handleAdCopyFullResponse will never
    // fire, so release the freeze held in sockets/index.js adCopyRequest.
    if (payload?.chatId) {
      try {
        await UnifiedCreditController.releaseCredits(payload.chatId);
      } catch (e) {
        logger.error("Failed to release ad copy freeze:", e);
      }
    }
    const status = error?.response?.status;
    logger.error(
      `Error in sendAdCopyRequest [status=${status}] ${error?.message}`
    );
    const msg =
      "Sorry, we couldn't generate ad copy right now. Please try again.";
    emitAdCopyError(payload, msg);
    persistAdCopyError(payload, msg);
  }
};

const emitToSocket = (socketId, channel, data) => {
  if (global.io && socketId) {
    global.io.to(socketId).emit(channel, data);
  }
};

const handleAdCopyChunk = (data) => {
  emitToSocket(data?.socket_id, "adCopyResponse", {
    user_id: data?.user_id,
    sessionId: data?.session_id || data?.sessionId,
    socket_id: data?.socket_id,
    result: data?.adCopyText,
    isLastChunk: data?.isLastChunk,
    limit: data?.limit ?? false,
    chatId: data?.chatId,
  });
};

const handleAdCopyFinal = async (data) => {
  try {
    if (!data?.socket_id) return;

    trackBackendGA4Event('ad_copy', {
      user_id: data.user_id,
      feature: 'ad_copy',
      action_name: 'adcopy_generated',
      source: 'adcopy_chat',
      success: true,
    });

    const payload = {
      adCopyText: data.adCopyText,
      user_id: data.user_id,
      sessionId: data.sessionId,
      response_by: "adsGpt",
      sentPayload: data?.sentPayload,
      response: true,
    };

    emitToSocket(data.socket_id, "finalAdCopyResponse", payload);
    logger.info(`Ad Copy Response: ${JSON.stringify(payload)}`);
  } catch (error) {
    console.error("Error in adCopy final response:", error);
    logger.error(`Error in adCopy final response: ${error}`);
  }
};

exports.saveSocketId = async (userId, socketId) => {
  try {
    await this.redisGetSet.set(`user:${userId}`, socketId);
    // console.log(`User ${userId} registered with socket ID ${socketId}`);
  } catch (error) {
    console.error(`Failed to save user ${userId} with socket ID ${socketId}`, error);
  }
};

// async function saveAdsCopyChat({ user_id, sessionId, ...restData }) {
//   try {
//     const chatDoc = await adsCopyChats.findOne({ user_id });

//     if (chatDoc) {
//       const sessionIndex = chatDoc.chat_sessions.findIndex(
//         (session) => session.sessionId === sessionId
//       );

//       if (sessionIndex !== -1) {
//         // Update existing session
//         const updatedChat = await adsCopyChats.findOneAndUpdate(
//           { user_id, 'chat_sessions.sessionId': sessionId },
//           {
//             $set: {
//               'chat_sessions.$.data': [...chatDoc.chat_sessions[sessionIndex].data, restData],
//               'chat_sessions.$.lastUpdateTime': new Date(),
//             },
//           },
//           { new: true }
//         );

//         return {
//           success: true,
//           message: "Chat updated successfully",
//           chat: updatedChat,
//           statusCode: 200,
//         };
//       } else {
//         // Create new session
//         chatDoc.chat_sessions.push({
//           sessionId,
//           data: [restData],
//           lastUpdateTime: new Date(),
//         });

//         const updatedChat = await chatDoc.save();
//         return {
//           success: true,
//           message: "New session created successfully",
//           chat: updatedChat,
//           statusCode: 201,
//         };
//       }
//     } else {
//       // Create new chat document
//       const newChat = new adsCopyChats({
//         user_id,
//         chat_sessions: [
//           {
//             sessionId,
//             data: [restData],
//             lastUpdateTime: new Date(),
//           },
//         ],
//       });

//       const savedChat = await newChat.save();
//       return {
//         success: true,
//         message: "Chat created successfully",
//         chat: savedChat,
//         statusCode: 201,
//       };
//     }
//   } catch (error) {
//     console.error('Failed to create or update chat:', error);
//     return {
//       success: false,
//       message: "Failed to create or update chat",
//       error: error.message,
//       statusCode: 500,
//     };
//   }
// }

exports.handleAdCopyResponse = async (data, socket) => {
  try {
    if (data?.socket_id) {
      socket.to(data?.socket_id).emit("adCopyResponse", {
        user_id: data?.user_id,
        sessionId: data?.session_id,
        socket_id: data?.socket_id,
        result: data?.adCopyText,
        isLastChunk: data?.isLastChunk,
        limit: data?.limit ?? false,
        chatId: data?.chatId,
      });
    } 
  } catch (error) {
    console.error("Error in responseToNode event:", error);
  }
};



exports.handleResponse = async (data, socket, uidChannel) => {
  try {
    if (data?.socket_id) {
      socket.to(data?.socket_id).emit(uidChannel, data);
      // console.log(`Sent response to user ${data.user_id}`);
    } else {
      // console.error(`User ${data.user_id} not found`);
    }
  } catch (error) {
    // console.error("Error in responseToNode event:", error);
  }
};


exports.clearSocketIds = async (disconnectedId) => {
  try {
    const userKeys = await this.redisGetSet.keys("user:*");
    for (const userId of userKeys) {
      const socketId = await this.redisGetSet.get(userId);
      if (socketId === disconnectedId) {
        await this.redisGetSet.del(userId);
        // console.log(`User ${userId} removed from Redis`);
        break;
      }
    }
  } catch (error) {
    console.error("Error in disconnect event:", error);
  }
};


// Create or Update Chat
// exports.createAdsCopyChat = async (data, socket) => {
  
//   try {
//       const { user_id,sessionId,platform,brand_name,brand_description,ad_title,ad_description,flag,...restData} = data;
//       const chatDoc = await adsCopyChats.findOne({ user_id });
//       if (chatDoc) {
//           const sessionIndex = chatDoc.chat_sessions.findIndex(session => session.sessionId === sessionId);

//           if (sessionIndex !== -1) {
//               const updatedChat = await adsCopyChats.findOneAndUpdate(
//                   { user_id, 'chat_sessions.sessionId': sessionId },
//                   { 
//                       $set: { 'chat_sessions.$.data': [...chatDoc.chat_sessions[sessionIndex].data,restData],
//                       'chat_sessions.$.lastUpdateTime': new Date() // Ensure lastUpdateTime is always set
//                      } 
//                   },
//                   { new: true }
//               );

//               return socket.emit('success', { code: 200, message: 'Chat updated successfully', chat: updatedChat });
//           } else {
//               // Create a new session if it doesn't exist
//               chatDoc.chat_sessions.push({
//                   sessionId,
//                   data: [restData],
//                   lastUpdateTime: new Date()
//               });

//               const updatedChat = await chatDoc.save();
//               return socket.emit('success', { code: 201, message: 'New session created successfully', chat: updatedChat });
//           }
//       } else {
//           const newChat = new adsCopyChats({
//             user_id,
//               chat_sessions: [{
//                   sessionId,
//                   data: [restData],
//                   lastUpdateTime: new Date()
//               }]
//           });

//           const savedChat = await newChat.save();
//           return socket.emit('success', { code: 201, message: 'Chat created successfully', chat: savedChat });
//       }

//   } catch (error) {
//       console.error('Failed to create or update chat:', error);
//       return socket.emit('error', { code: 500, message: 'Failed to create or update chat' });
//   }
// };
exports.storeAdCopyChat = async (req) => {

  
  try {

    const { user_id, sessionId, ...chatData } = req
    // First, try to find the existing user document
    const userDoc = await adsCopyChats?.findOne({ user_id });

    // If user document doesn't exist, create a new one with the session and chat data
    if (!userDoc) {
      const newChatSession = {
        sessionId,
        data: [chatData],
        lastUpdateTime: new Date()
      };

      await adsCopyChats?.create({
        user_id,
        chat_sessions: [newChatSession]
      });

      return { success: true, message: "New user and chat session created successfully" };
    }

    // Try to find the existing session
    const sessionIndex = userDoc?.chat_sessions?.findIndex(s => s?.sessionId === sessionId);

    // If session doesn't exist, add a new session with the chat data
    if (sessionIndex === -1) {
      await adsCopyChats?.updateOne(
        { user_id },
        {
          $push: {
            chat_sessions: {
              sessionId,
              data: [chatData],
              lastUpdateTime: new Date()
            }
          }
        }
      );

      return { success: true, message: "New chat session added successfully" };
    }

    // Session exists, now check for existing chat by chatid
    if (chatData?.sentPayload?.chatid) {
      const chatIndex = userDoc?.chat_sessions[sessionIndex]?.data?.findIndex(
        chat => chat?.response_by === 'adsgpt'&&chat?.sentPayload?.chatid === chatData?.sentPayload?.chatid
      );

      // If chat exists, update it
      if (chatIndex !== -1) {
        const updateOperation = {
          $set: {
            [`chat_sessions.${sessionIndex}.data.${chatIndex}`]: chatData,
            [`chat_sessions.${sessionIndex}.lastUpdateTime`]: new Date()
          }
        };

        await adsCopyChats?.updateOne(
          { user_id, "chat_sessions.sessionId": sessionId },
          updateOperation
        );

        return { success: true, message: "Chat data updated successfully" };
      }
    }

    // Chat doesn't exist or doesn't have chatid, push new chat data
    await adsCopyChats?.updateOne(
      { user_id, "chat_sessions.sessionId": sessionId },
      {
        $push: {
          "chat_sessions.$.data": chatData
        },
        $set: {
          "chat_sessions.$.lastUpdateTime": new Date()
        }
      }
    );

    return { success: true, message: "New chat data added to existing session" };

  } catch (error) {
    console.error("Error storing/updating chat data:", error);
    return { success: false, message: "Failed to store or update chat data" };
  }
};

exports.createAdsCopyChatHistory = async (req, res) => {
  try {
      const { user_id, sessionId, ...restData } = req.body;
      const updateResult = await adsCopyChats.updateOne(
          { user_id, "chat_sessions.sessionId": sessionId },
          {
              $push: { "chat_sessions.$.data": restData },
              $set: { "chat_sessions.$.lastUpdateTime": new Date()}
          }
        );
      if (updateResult.modifiedCount === 0){
          // If no existing session was found, create a new session or a new user record
          await adsCopyChats.updateOne(
              { user_id },
              {
                  $push: {
                      chat_sessions: {
                          sessionId,
                          data: [restData],
                          lastUpdateTime: new Date()
                      }
                  }
              },
              { upsert: true }
          );
      }

      return res.status(200).json({ message: "Chat updated or created successfully" });
  } catch (error) {
      console.error("Error creating/updating chat:", error);
      return res.status(500).json({ message: "Failed to create or update chat" });
  }
};
// exports.createAdsCopyChat2 = async (req, res) => {
//   try {
//     const { user_id, sessionId, ...restData } = req.body;
    
//     // Validate required fields
//     if (!user_id || !sessionId) {
//       return res.status(400).json({ message: "Missing required fields: user_id or sessionId" });
//     }

//     // Atomic operations to prevent race conditions
//     const chatDoc = await adsCopyChats.findOne({ user_id });
    
//     // If no document exists for this user, create one
//     if (!chatDoc){
//       const newChat = new adsCopyChats({
//         user_id,
//         chat_sessions: [{
//           sessionId,
//           data: [restData],
//           lastUpdateTime: new Date()
//         }]
//       });
//       const savedChat = await newChat.save();
//       return res.status(201).json({ message: "Chat created successfully", chat: savedChat });
//     }

//     // Find existing session
//     const sessionIndex = chatDoc.chat_sessions.findIndex(session => session.sessionId === sessionId);
//     const now = new Date();

//     // For adsgpt responses - ensure they match a previous request
//     if (restData.response_by === 'adsgpt') {
//       const chatid = restData.sentPayload?.chatid;
//       if (!chatid) {
//         return res.status(400).json({ message: "Missing chatid for adsgpt response" });
//       }

//       // Find matching request
//       const matchingRequestIndex = chatDoc.chat_sessions[sessionIndex]?.data.findIndex(
//         item => item.chatid === chatid && item.request_by === 'user'
//       );
      
//       if (matchingRequestIndex === -1) {
//         return res.status(400).json({ message: "No matching user request found for this response" });
//       }

      
//       // Check if response already exists
//       const existingResponseIndex = chatDoc.chat_sessions[sessionIndex]?.data.findIndex(
//         item => item.response_by === 'adsgpt' && item.sentPayload?.chatid === chatid
//       );

//       // Update or add response
//       const updateOperation = existingResponseIndex !== -1 
//         ? {
//             $set: {
//               [`chat_sessions.${sessionIndex}.data.${existingResponseIndex}`]: restData,
//               [`chat_sessions.${sessionIndex}.lastUpdateTime`]: now
//             }
//           }
//         : {
//             $push: {
//               [`chat_sessions.${sessionIndex}.data`]: restData
//             },
//             $set: {
//               [`chat_sessions.${sessionIndex}.lastUpdateTime`]: now
//             }
//           };

//       const updatedChat = await adsCopyChats.findOneAndUpdate(
//         { user_id, 'chat_sessions.sessionId': sessionId },
//         updateOperation,
//         { new: true }
//       );

//       return res.status(200).json({ 
//         message: existingResponseIndex !== -1 
//           ? "Chat response updated successfully" 
//           : "Chat response added successfully", 
//         chat: updatedChat 
//       });
//     }

//     // Handle user requests
//     if (sessionIndex !== -1) {
//       // Check for duplicate chatid in existing data
//       const duplicateChat = chatDoc.chat_sessions[sessionIndex].data.some(
//         item => item.chatid === restData.chatid
//       );

//       if (duplicateChat) {
//         return res.status(400).json({ message: "Duplicate chatid detected" });
//       }

//       // Add new user request
//       const updatedChat = await adsCopyChats.findOneAndUpdate(
//         { user_id, 'chat_sessions.sessionId': sessionId },
//         { 
//           $push: { 
//             [`chat_sessions.${sessionIndex}.data`]: restData 
//           },
//           $set: {
//             [`chat_sessions.${sessionIndex}.lastUpdateTime`]: now
//           }
//         },
//         { new: true }
//       );

//       return res.status(200).json({ message: "User request added successfully", chat: updatedChat });
//     }
//     // Create new session if it doesn't exist
//     const updatedChat = await adsCopyChats.findOneAndUpdate(
//       { user_id },
//       {
//         $push: {
//           chat_sessions: {
//             sessionId,
//             data: [restData],
//             lastUpdateTime: now
//           }
//         }
//       },
//       { new: true }
//     );

//     return res.status(201).json({ message: "New session created successfully", chat: updatedChat });

//   } catch (error) {
//     // console.error('Failed to create or update chat:', error);
//     // return res.status(500).json({ message: "Failed to create or update chat" });
//   }
// };

// exports.createAdsCopyChat2 = async (req, res) => {

//   try {
//       const { user_id, sessionId, ...restData } = req.body;
//       const chatDoc = await adsCopyChats.findOne({ user_id });

//       if (chatDoc) {
//           const sessionIndex = chatDoc.chat_sessions.findIndex(session => session.sessionId === sessionId);
          
//           if (sessionIndex !== -1) {
//               // Check if this is a response from adsgpt with an existing chatid
//               if (restData.response_by === 'adsgpt' && restData.sentPayload?.chatid) {
//                   const chatid = restData.sentPayload.chatid;
                  
//                   // Find if there's an existing response with the same chatid
//                   const existingResponseIndex = chatDoc.chat_sessions[sessionIndex].data.findIndex(
//                       item => item.response_by === 'adsgpt' && item.sentPayload?.chatid === chatid
//                   );
                  
//                   if (existingResponseIndex !== -1) {
//                       // Update existing response instead of adding new one
//                       const updateQuery = {
//                           $set: {
//                               [`chat_sessions.${sessionIndex}.data.${existingResponseIndex}`]: restData,
//                               'chat_sessions.$.lastUpdateTime': new Date()
//                           }
//                       };
                      
//                       const updatedChat = await adsCopyChats.findOneAndUpdate(
//                           { user_id, 'chat_sessions.sessionId': sessionId },
//                           updateQuery,
//                           { new: true }
//                       );
                      
//                       return res.status(200).json({ message: "Chat response updated successfully", chat: updatedChat });
//                   }
//               }
              
//               // If no existing response found or this is a user request, add new data
//               const updatedChat = await adsCopyChats.findOneAndUpdate(
//                   { user_id, 'chat_sessions.sessionId': sessionId },
//                   { 
//                       $set: { 
//                           'chat_sessions.$.data': [...chatDoc.chat_sessions[sessionIndex].data, restData],
//                           'chat_sessions.$.lastUpdateTime': new Date()
//                       } 
//                   },
//                   { new: true }
//               );

//               return res.status(200).json({ message: "Chat updated successfully", chat: updatedChat });
//           } else {
//               // Create a new session if it doesn't exist
//               chatDoc.chat_sessions.push({
//                   sessionId,
//                   data: [restData],
//                   lastUpdateTime: new Date()
//               });

//               const updatedChat = await chatDoc.save();
//               return res.status(201).json({ message: "New session created successfully", chat: updatedChat });
//           }
//       } else {
//           // Create new chat document if it doesn't exist
//           const newChat = new adsCopyChats({
//               user_id,
//               chat_sessions: [{
//                   sessionId,
//                   data: [restData],
//                   lastUpdateTime: new Date()
//               }]
//           });

//           const savedChat = await newChat.save();
//           return res.status(201).json({ message: "Chat created successfully", chat: savedChat });
//       }
//   } catch (error) {
//       // console.error('Failed to create or update chat:', error);
//       // return res.status(500).json({ message: "Failed to create or update chat" });
//   }
// };

// exports.createAdsCopyChat2 = async (req,res) => {

//   try {
//       const { user_id, sessionId, ...restData} = req.body;
//       const chatDoc = await adsCopyChats.findOne({ user_id });
//       if (chatDoc) {
       
//           const sessionIndex = chatDoc.chat_sessions.findIndex(session => session.sessionId === sessionId);
         
//           if (sessionIndex !== -1) {
//               const updatedChat = await adsCopyChats.findOneAndUpdate(
//                   { user_id, 'chat_sessions.sessionId': sessionId },
//                   { 
//                       $set: { 'chat_sessions.$.data': [...chatDoc.chat_sessions[sessionIndex].data,restData],
//                       'chat_sessions.$.lastUpdateTime': new Date() // Ensure lastUpdateTime is always set
//                      } 
//                   },
//                   { new: true }
//               );

//               return res.status(200).json({ message: "Chat updated successfully", chat: updatedChat });
//           } else {
//               // Create a new session if it doesn't exist
//               chatDoc.chat_sessions.push({
//                 sessionId,
//                   data: [restData],
//                   lastUpdateTime: new Date()
//               });

//               const updatedChat = await chatDoc.save();
//               return res.status(201).json({message: "New session created successfully", chat: updatedChat});
//           }
//       } else {
//           const newChat = new adsCopyChats({
//             user_id,
//               chat_sessions: [{
//                 sessionId,
//                   data: [restData],
//                   lastUpdateTime: new Date()
//               }]
//           });

//           const savedChat = await newChat.save();
//           return res.status(201).json({ message: "Chat created successfully", chat: savedChat });
//       }

//   } catch (error) {
//       // console.error('Failed to create or update chat:', error);
//       // return res.status(500).json({ message: "Failed to create or update chat" });
//   }
// };




const onboardingController = require("./onboarding/onboardingController");

exports.checkUserExists = onboardingController.checkUserExists;
exports.completeOnboarding = onboardingController.completeOnboarding;
exports.resetOnboarding = onboardingController.resetOnboarding;
 


// exports.getadsCopyChatsByResponder = async (req, res) => {


//   try {
//       const uid = req.params.uid;

//       const chat = await adsCopyChats.findOne({ user_id: uid});

//       if (!chat) {
//           return res.status(404).json({ code: 404, message: 'Chat not found for the specified UID' });
//       }

//       const getLastMessagesByResponder = (chatData, responder) => {
//           return chatData.chat_sessions.map(session => {
//               const userMessages = session.data.filter(message => message.request_by === responder);
//               const lastMessage = userMessages[userMessages.length - 1]?.user_query2
//               const lastMessageDate = userMessages[userMessages.length - 1]?.timestamp

//               return {
//                   sessionId: session.sessionId,
//                   lastMessage,
//                   lastMessageDate
//               };
//           }).filter(session => session.lastMessage);
//       };

//       const filteredSessions = getLastMessagesByResponder(chat, 'user');

//       if (filteredSessions.length === 0) {
//           return res.status(404).json({ code: 404, message: 'No chats found responded by the specified user' });
//       }
//       const result = {
//           uid: chat.user_id,
//           // username: chat.username,
//           chat_sessions: filteredSessions.reverse()
//       };

//       res.status(200).json({ code: 200, chat: result });
//   } catch (error) {
//       console.error(error);
//       res.status(500).json({ code: 500, message: 'Failed to get chats' });
//   }
// };


// exports.getadsCopyChatsByResponder = async (req, res) => {
//   try {
//     const uid = req.params.uid;

//     // Fetch only required fields and use `.lean()` to return plain JSON objects for faster processing
//     const chat = await adsCopyChats.findOne(
//       { user_id: uid },
//       { "chat_sessions.sessionId": 1, "chat_sessions.data.request_by": 1, "chat_sessions.data.user_query2": 1, "chat_sessions.data.timestamp": 1 }
//     ).lean();

//     if (!chat) {
//       return res.status(404).json({ code: 404, message: "Chat not found for the specified UID" });
//     }

//     // Process the chat sessions to extract the last message from "user"
//     const filteredSessions = chat.chat_sessions
//       .map(({ sessionId, data }) => {
//         const lastMessageObj = [...data]
//           .reverse() // Reverse once to get the last user message efficiently
//           .find(({ request_by }) => request_by === "user");

//         return lastMessageObj
//           ? { sessionId, lastMessage: lastMessageObj.user_query2, lastMessageDate: lastMessageObj.timestamp }
//           : null;
//       })
//       .filter(Boolean) // Remove null values
//       .reverse(); // Reverse the final list for the required order
//     if (filteredSessions.length === 0) {
//       return res.status(404).json({ code: 404, message: "No chats found responded by the specified user" });
//     }

//     res.status(200).json({
//       code: 200,
//       chat: {
//         uid: chat.user_id,
//         chat_sessions: filteredSessions
//       }
//     });
//   } catch (error) {
//     console.error("Error fetching chats:", error);
//     res.status(500).json({ code: 500, message: "Failed to get chats" });
//   }
// };
 
exports.getadsCopyChatsByResponder = async (req, res) => {
  try {
    const uid = req.params.uid;

    // Fetch only required fields and use `.lean()` for better performance
    const chat = await adsCopyChats.findOne(
      { user_id: uid },
      { 
        "chat_sessions.sessionId": 1, 
        "chat_sessions.data.request_by": 1, 
        "chat_sessions.data.user_query2": 1, 
        "chat_sessions.data.timestamp": 1 
      }
    ).lean();

    if (!chat) {
      return res.status(404).json({ 
        code: 404, 
        message: "Chat not found for the specified UID" 
      });
    }

    // Process and sort sessions
    const filteredSessions = chat.chat_sessions
      .map(({ sessionId, data }) => {
        // Find the most recent user message
        const lastMessageObj = data
          ?.slice() // Create a copy to avoid mutating original
          ?.reverse()
          ?.find(({ request_by }) => request_by === "user");
        
        if (!lastMessageObj) return null;
        
        // Convert timestamp to proper ISO format for accurate sorting
        const isoFormattedTimestamp = lastMessageObj.timestamp
          .replace(/(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})/, '$1-$2-$3T$4:$5:$6')
          .replace(' ', 'T');
        
        return { 
          sessionId, 
          lastMessage: lastMessageObj.user_query2, 
          lastMessageDate: lastMessageObj.timestamp,
          // Create proper Date object for accurate time-based sorting
          sortableDate: new Date(isoFormattedTimestamp)
        };
      })
      .filter(Boolean) // Remove null values
      // Sort by date and time (newest first)
      .sort((a, b) => b.sortableDate - a.sortableDate)
      // Remove temporary sort property
      .map(({ sortableDate, ...rest }) => rest);

    if (filteredSessions.length === 0) {
      return res.status(404).json({ 
        code: 404, 
        message: "No chats found for the specified user" 
      });
    }

    res.status(200).json({
      code: 200,
      chat: {
        uid: chat.user_id,
        chat_sessions: filteredSessions
      }
    });
  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).json({ 
      code: 500, 
      message: "Failed to get chats",
      error: error.message 
    });
  }
};
 
// exports.getAdsCopyMessagesBySession = async (req, res) => {


//   const { pub } = require("./../index");
//   try {
//       const { uid, sessionId } = req.params;
//       const chat = await adsCopyChats.findOne({ user_id: uid});

  

//       if (!chat) {
//           return res.status(404).json({ code: 404, message: 'Chat not found for the specified UID' });
//       }
//       const session = chat.chat_sessions.find(session => session.sessionId === sessionId);
//       if (!session) {
//           return res.status(404).json({ code: 404, message: 'Session not found for the specified Session ID' });
//       }
//       const messages = session.data.filter(message => message.request_by === 'user');
//       if (messages.length === 0) {
//           return res.status(404).json({ code: 404, message: 'No messages from user found in this session' });
//       }

//       res.status(200).json({ code: 200, message: session.data });
//   } catch (error) {
//       console.error(error);
//       res.status(500).json({ code: 500, message: 'Failed to get messages' });
//   }
// };


exports.getAdsCopyMessagesBySession = async (req, res) => {
  
  try {
      const { uid, sessionId } = req.params;

      // Use MongoDB aggregation for optimized querying
      const chat = await adsCopyChats.aggregate([
          { $match: { user_id: uid } }, // Match the user
          { 
              $project: { 
                  chat_sessions: { 
                      $filter: {
                          input: "$chat_sessions",
                          as: "session",
                          cond: { $eq: ["$$session.sessionId", sessionId] }
                      } 
                  } 
              } 
          },
          { $unwind: "$chat_sessions" } // Flatten the chat_sessions array if there's a match
      ]);

      if (!chat || chat.length === 0) {
          return res.status(404).json({ code: 404, message: 'Session not found for the specified Session ID' });
      }

      const session = chat[0].chat_sessions;

      const messages = session.data.filter(message => message.request_by === 'user');
      if (messages.length === 0) {
          return res.status(404).json({ code: 404, message: 'No messages from user found in this session' });
      }

      res.status(200).json({ code: 200, message: session.data });
  } catch (error) {
      console.error(error);
      res.status(500).json({ code: 500, message: 'Failed to get messages' });
  }
};

// exports.deleteAdCopyChatByUidAndSessionId = async (req, res) => {

//   const {uid,sessionId}= req.params;
//   try {
//       if (!uid || !sessionId) {
//           return res.status(400).send('Both uid and sessionId are required');
//       }

//       const result = await adsCopyChats.updateOne(
//           { user_id: uid },
//           { $pull: { chat_sessions: { sessionId: sessionId } } }
//       );

//       if (result.modifiedCount === 0) {
//           return res.status(404).json({ code: 404, message: `No chat found with uid: ${uid} and sessionId: ${sessionId}` });
//       } else {
//           return res.status(200).json({ code: 200, message: `Chat with uid: ${uid} and sessionId: ${sessionId} deleted successfully.` });
//       }
//   } catch (error) {
//       console.error(`Error deleting chat with uid: ${uid} and sessionId: ${sessionId}`, error);
//       return res.status(500).json({ code: 500, message: 'Failed to delete' });
//   }
// };


exports.deleteAdCopyChatByUidAndSessionId = async (req, res) => {
 
  const { uid, sessionId } = req.params;

  try {
      if (!uid || !sessionId) {
          return res.status(400).json({ code: 400, message: 'Both uid and sessionId are required' });
      }

      // Perform the deletion directly in the database
      const result = await adsCopyChats.updateOne(
          { user_id: uid, "chat_sessions.sessionId": sessionId },
          { $pull: { chat_sessions: { sessionId: sessionId } } }
      );

      if (result.modifiedCount === 0) {
          return res.status(404).json({ code: 404, message: `No chat found with uid: ${uid} and sessionId: ${sessionId}` });
      }

      return res.status(200).json({ code: 200, message: `Chat with uid: ${uid} and sessionId: ${sessionId} deleted successfully.` });
  } catch (error) {
      console.error(`Error deleting chat with uid: ${uid} and sessionId: ${sessionId}`, error);
      return res.status(500).json({ code: 500, message: 'Failed to delete' });
  }
};

exports.deleteAdCopyByUid = async (req, res)=> {
   
  try {
      const { uid } = req.params;
      const result = await adsCopyChats.deleteOne({ user_id: uid });
      if (result.deletedCount === 0) {
          return res.status(404).json({ code: 404, message: `No document found with uid: ${uid}` });
      } else {
         return res.status(200).json({ code: 200, message: `Document with uid: ${uid} deleted successfully.` });
      }
  } catch (error) {
      return res.status(500).json({ code: 500, message: 'Failed to delete' });
  }
}


exports.getChatsMessageById = async (req, res) => {
      try {
          const userid = req.params.uid;  
  
         
          const pipeline = [
              { $match: { user_id: userid } },  
              { $unwind: "$chat_sessions" },  
              { $sort: { "chat_sessions.lastUpdateTime": -1 } }, 
              { $limit: 1 },  
              { $group: {
                  _id: "$user_id",  
                  chat_sessions: { $push: "$chat_sessions" } 
              }},
              { $project: {
                  _id: 0, 
                  user_id: "$_id",  
                  chat_sessions: 1  
              }}
          ];
  
          const result = await adsCopyChats.aggregate(pipeline);
          let messages = result
    .map((session) =>
        session.chat_sessions
            .map((data) =>
                data.data
                    .filter((message) => message.response_by === "adsGpt") 
                    .map((message) => {

                        const userMessage = data.data.find((msg) => msg.request_by === "user");
                        return {
                            data: message?.adCopyText,
                            time: userMessage ? userMessage.timestamp : null
                        };
                    })
            )
    )
    .flat(2);


const uniqueMessages = [...new Set(messages.map(m => JSON.stringify(m)))].map(m => JSON.parse(m));
const lastMessage = uniqueMessages[uniqueMessages.length - 1];

res.status(200).json({ code: 200, recent_sessions: lastMessage });
        // res.status(200).json({ code: 200, recent_sessions:result });
  
      } catch (error) {
          res.status(500).json({ code: 500, message: 'Failed to get chat' });
      }
  };