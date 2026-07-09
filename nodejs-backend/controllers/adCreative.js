
const adsCreativeChats = require("../Module/adCreative/adCreative");
const Redis = require("ioredis");
const axios = require("axios");
const IMAGE = require("../Module/adCreative/adCreativeImages");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const { s3Client } = require("../storage/s3");
const FormData = require("form-data");
const { timeStamp } = require("console");



const getFileName = (extension) => `${Date.now()}${extension}`;

const ensureTempFolderExists = () => {
  const tempDir = path.join(__dirname, "../temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
};

exports.getImageUrl = async (url, userId) => {
  try {
    // Fetch image stream from the URL
    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
    });

    // Determine file extension from content type
    const contentType = response.headers["content-type"];
    let fileExtension = contentType.includes("image")
      ? ".jpeg"
      : contentType.includes("video")
      ? ".mp4"
      : null;

    if (!fileExtension) {
      console.error(`Unsupported content type: ${contentType}`);
      return null;
    }

    // Create temp directory
    const tempDir = ensureTempFolderExists();
    const originalFileName = getFileName(fileExtension);
    const originalFilePath = path.join(tempDir, originalFileName);

    // Save the original file
    const writer = fs.createWriteStream(originalFilePath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    let finalFilePath = originalFilePath;
    let finalFileName = originalFileName;
    let finalContentType = contentType;

    // If it's an image, compress & convert to WebP
    if (contentType.includes("image")) {
      finalFileName = getFileName(".webp");
      finalFilePath = path.join(tempDir, finalFileName);
      
      await sharp(originalFilePath)
        .resize({ width: 800 }) // Resize width to 800px (adjust as needed)
        .webp({ quality: 80 }) // Convert to WebP with 80% quality
        .toFile(finalFilePath);

      finalContentType = "image/webp";
      await fs.promises.unlink(originalFilePath); // Remove original file
    }

    // Read the optimized/compressed file buffer
    const fileBuffer = await fs.promises.readFile(finalFilePath);

    // Upload file to S3
    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `creatives/${userId}/${finalFileName}`,
      Body: fileBuffer,
      ContentType: finalContentType,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    // Delete the temporary file
    await fs.promises.unlink(finalFilePath);

    const s3Url = `/${uploadParams.Key}`;
    await saveImageUrl(s3Url, userId);
    return s3Url;
  } catch (error) {
    console.error("Error in getImageUrl:", error);
    return null;
  }
};
  
  const saveImageUrl = async (url, user_id) => {
    try {
      const epochTime = parseInt(url.split('/').pop().split('.')[0]); // Extract epoch time
      const createdAt = new Date(epochTime);
  
      const image = new IMAGE({ image_url: url, createdAt, user_id, type: 1 });
      await image.save();
    } catch (error) {
      console.error("Error in saveImageUrl event:", error);
    }
  };

  exports.uploadVideoFromData = async (req,res)=>{
    try {
      const userId = req?.body?.userId;
      const file = req.file;
      const save = req?.body?.save;
      if (!file) {
        console.error("No Video file received");
        return res.status(400).json({ error: "No Video file received" });
      }
      const fileName = getFileName(".mp4");
    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `videos/${userId}/${fileName}`,
      Body: file.buffer,
      ContentType: "video/mp4",
    };

    await s3Client.send(new PutObjectCommand(uploadParams));
    const s3Url = `/${uploadParams.Key}`;
    return res.status(200).json({ data: s3Url });
  }
   catch (error){
    console.log(error);
  }
}
exports.redisGetSet = new Redis({
    host: process.env.HOST,
    port: process.env.RD_PORT,
    username: process.env.RD_USERNAME,
    password: process.env.redisPass
  });

exports.storeAdCreativeChat = async (user_id, sessionId, chatData) => {
  try {
    // First, try to find the existing user document
    const userDoc = await adsCreativeChats.findOne({ user_id });

    // If user document doesn't exist, create a new one with the session and chat data
    if (!userDoc) {
      const newChatSession = {
        sessionId,
        data: [chatData],
        lastUpdateTime: new Date()
      };

      await adsCreativeChats.create({
        user_id,
        chat_sessions: [newChatSession]
      });

      return { success: true, message: "New user and chat session created successfully" };
    }

    // Try to find the existing session
    const sessionIndex = userDoc.chat_sessions.findIndex(s => s.sessionId === sessionId);

    // If session doesn't exist, add a new session with the chat data
    if (sessionIndex === -1) {
      await adsCreativeChats.updateOne(
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
    if (chatData?.chatId) {
      const chatIndex = userDoc.chat_sessions[sessionIndex].data.findIndex(
        chat => chat?.chatId === chatData?.chatId
      );

      // If chat exists, update it
      if (chatIndex !== -1) {
        const updateOperation = {
          $set: {
            [`chat_sessions.${sessionIndex}.data.${chatIndex}`]: chatData,
            [`chat_sessions.${sessionIndex}.lastUpdateTime`]: new Date()
          }
        };

        await adsCreativeChats.updateOne(
          { user_id, "chat_sessions.sessionId": sessionId },
          updateOperation
        );

        return { success: true, message: "Chat data updated successfully" };
      }
    }

    // Chat doesn't exist or doesn't have chatid, push new chat data
    await adsCreativeChats.updateOne(
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

// exports.storeAdCreativeChat = async (user_id, sessionId, chatData) => {
//   try {
//     // First, try to find the existing user document
//     const userDoc = await adsCreativeChats.findOne({ user_id });

//     // If user document doesn't exist, create a new one with the session and chat data
//     if (!userDoc) {
//       const newChatSession = {
//         sessionId,
//         data: [chatData],
//         lastUpdateTime: new Date()
//       };

//       await adsCreativeChats.create({
//         user_id,
//         chat_sessions: [newChatSession]
//       });

//       return { success: true, message: "New user and chat session created successfully" };
//     }

//     // Try to find the existing session
//     const sessionIndex = userDoc.chat_sessions.findIndex(s => s.sessionId === sessionId);

//     // If session doesn't exist, add a new session with the chat data
//     if (sessionIndex === -1) {
//       await adsCreativeChats.updateOne(
//         { user_id },
//         {
//           $push: {
//             chat_sessions: {
//               sessionId,
//               data: [chatData],
//               lastUpdateTime: new Date()
//             }
//           }
//         }
//       );

//       return { success: true, message: "New chat session added successfully" };
//     }

//     // Session exists, now check for matching user/bot pairs
//     if (chatData.chatid && chatData.type === "bot") {
//       // Find the corresponding user message with the same chatid
//       const userMessageIndex = userDoc.chat_sessions[sessionIndex].data.findIndex(
//         chat => chat.chatid === chatData.chatid && chat.type === "user"
//       );

//       // If user message exists, find the bot response to update
//       if (userMessageIndex !== -1) {
//         const botResponseIndex = userDoc.chat_sessions[sessionIndex].data.findIndex(
//           chat => chat.chatid === chatData.chatid && chat.type === "bot"
//         );

//         // If bot response exists, update it
//         if (botResponseIndex !== -1) {
//           const updateOperation = {
//             $set: {
//               [`chat_sessions.${sessionIndex}.data.${botResponseIndex}`]: chatData,
//               [`chat_sessions.${sessionIndex}.lastUpdateTime`]: new Date()
//             }
//           };

//           await adsCreativeChats.updateOne(
//             { user_id, "chat_sessions.sessionId": sessionId },
//             updateOperation
//           );

//           return { success: true, message: "Bot response updated successfully" };
//         }else{
//           // const updateOperation = {
//           //   $set: {
//           //     [`chat_sessions.${sessionIndex}.data.${userMessageIndex+1}`]: chatData,
//           //     [`chat_sessions.${sessionIndex}.lastUpdateTime`]: new Date()
//           //   }
//           // };

//           // await adsCreativeChats.updateOne(
//           //   { user_id, "chat_sessions.sessionId": sessionId },
//           //   updateOperation
//           // );
//           await adsCreativeChats.updateOne(
//             { user_id, "chat_sessions.sessionId": sessionId },
//             {
//               $push: {
//                 [`chat_sessions.${sessionIndex}.data`]: {
//                   $each: [chatData],
//                   $position: userMessageIndex + 1
//                 }
//               },
//               $set: {
//                 [`chat_sessions.${sessionIndex}.lastUpdateTime`]: new Date()
//               }
//             }
//           );
//         }
//       }
//     }

//     // If no matching pair found or not a bot response, push new chat data
//     // await adsCreativeChats.updateOne(
//     //   { user_id, "chat_sessions.sessionId": sessionId },
//     //   {
//     //     $push: {
//     //       "chat_sessions.$.data": chatData
//     //     },
//     //     $set: {
//     //       "chat_sessions.$.lastUpdateTime": new Date()
//     //     }
//     //   }
//     // );

//     return { success: true, message: "New chat data added to existing session" };

//   } catch (error) {
//     console.error("Error storing/updating chat data:", error);
//     return { success: false, message: "Failed to store or update chat data" };
//   }
// };

// exports.createAdCreativeChat = async (req, res) => {
//   try {
//       const { user_id, sessionId,adsData,...restData } = req.body;

//     // Combine chatid with restData before saving
//     // const dataToSave = { chatid, ...restData };
//       const updateResult = await adsCreativeChats.updateOne(
//           { user_id, "chat_sessions.sessionId": sessionId },
//           {
//               $push: { "chat_sessions.$.data":restData },
//               $set: { "chat_sessions.$.lastUpdateTime": new Date()}
//           }
//         );
//       if (updateResult.modifiedCount === 0){
//           // If no existing session was found, create a new session or a new user record
//           await adsCreativeChats.updateOne(
//               { user_id },
//               {
//                   $push: {
//                       chat_sessions: {
//                           sessionId,
//                           adsData,
//                           data: [restData],
//                           lastUpdateTime: new Date()
//                       }
//                   }
//               },
//               { upsert: true }
//           );
//       }

//       return res.status(200).json({ message: "Chat updated or created successfully" });
//   } catch (error) {
//       console.error("Error creating/updating chat:", error);
//       return res.status(500).json({ message: "Failed to create or update chat" });
//   }
// };
exports.createAdCreativeChat = async (req, res) => {
  try {
    const { user_id, sessionId, adsData, ads, ...restData } = req.body;

    // Check if this is an image response that should update an existing text response
    if (ads && ads[0] && ads[0].image_ad && ads[0].image_ad !== '') {
      // This is an image response - find the session and update the most recent data entry
      const session = await adsCreativeChats.findOne(
        { 
          user_id, 
          "chat_sessions.sessionId": sessionId
        },
        { "chat_sessions.$": 1 }
      );

      if (session && session.chat_sessions && session.chat_sessions.length > 0) {
        const chatSession = session.chat_sessions[0];
        
        // Find the index of the most recent data entry that has ads but image_ad is empty or not complete
        const dataEntries = chatSession.data || [];
        let targetIndex = -1;
        
        // Look for the most recent incomplete ad (working backwards from the end)
        for (let i = dataEntries.length - 1; i >= 0; i--) {
          const entry = dataEntries[i];
          if (entry.ads && entry.ads[0] && 
              (entry.ads[0].image_ad === '' || 
               entry.ads[0].image_ad === undefined || 
               !entry.complete)) {
            targetIndex = i;
            break;
          }
        }

        if (targetIndex !== -1) {
          // Update the specific data entry
          const updateResult = await adsCreativeChats.updateOne(
            { 
              user_id, 
              "chat_sessions.sessionId": sessionId
            },
            {
              $set: { 
                "chat_sessions.$.lastUpdateTime": new Date(),
                [`chat_sessions.$.data.${targetIndex}.ads`]: ads,
                [`chat_sessions.$.data.${targetIndex}.complete`]: restData.complete
              }
            }
          );

          if (updateResult.modifiedCount > 0) {
            return res.status(200).json({ message: "Image data updated successfully" });
          }
        }
      }
    }

    // For text responses or if image update didn't find existing ad
    const updateResult = await adsCreativeChats.updateOne(
      { user_id, "chat_sessions.sessionId": sessionId },
      {
        $push: { "chat_sessions.$.data": { ...restData, ads } },
        $set: { "chat_sessions.$.lastUpdateTime": new Date() }
      }
    );

    if (updateResult.modifiedCount === 0) {
      // If no existing session was found, create a new session or a new user record
      await adsCreativeChats.updateOne(
        { user_id },
        {
          $push: {
            chat_sessions: {
              sessionId,
              adsData,
              data: [{ ...restData, ads }],
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
exports.updateAdCreativeChatMessage = async (req, res) => {
  try {
    const { user_id, sessionId, index, image_ad ,imageIndex} = req.body;
    const logo = req?.body?.logo || null;

    if (typeof index !== "number" || typeof imageIndex !== "number" || !image_ad) {
      return res.status(400).json({ message: "Index and imageIndex must be numbers and image_ad is required" });
    }

    const imagePath = `chat_sessions.$.data.${index}.ads.${imageIndex}.image_ad`;
    const logoPath = `chat_sessions.$.data.${index}.ads.${imageIndex}.logo`;

     // Prepare the update object
     const updateObj = {
      $set: {
        [imagePath]: image_ad,
        "chat_sessions.$.lastUpdateTime": new Date()
      }
    };

    // Only add logo to the update if it exists
    if (logo) {
      updateObj.$set[logoPath] = logo;
    }

    const updateResult = await adsCreativeChats.updateOne(
      { user_id, "chat_sessions.sessionId": sessionId },
      updateObj
    );

    if (updateResult.modifiedCount === 0) {
      return res.status(404).json({ message: "Session or image_ad not found" });
    }

    res.status(200).json({ message: "image_ad updated successfully" });
  } catch (error) {
    console.error("Error updating image_ad:", error);
    res.status(500).json({ message: "Failed to update image_ad" });
  }
};

// exports.getAdCreativeMessagesBySession = async (req, res) => {


//   const { pub } = require("./../index");
//   try {
//       const { uid, sessionId } = req.params;
//       const chat = await adsCreativeChats.findOne({ user_id: uid});



//       if (!chat) {
//           return res.status(404).json({ code: 404, message: 'Chat not found for the specified UID' });
//       }
//       const session = chat.chat_sessions.find(session => session.sessionId === sessionId);
    
//       if (!session) {
//           return res.status(404).json({ code: 404, message: 'Session not found for the specified Session ID' });
//       }
//       const messages = session.data.filter(message => message.type === 'user');
    
//       if (messages.length === 0) {
//           return res.status(404).json({ code: 404, message: 'No messages from user found in this session' });
//       }

//       res.status(200).json({ code: 200, message: session.data });
//   } catch (error) {
//       console.error(error);
//       res.status(500).json({ code: 500, message: 'Failed to get messages' });
//   }
// };


exports.getAdCreativeMessagesBySession = async (req, res) => {
 

  try {
    const { uid, sessionId } = req.params;

    // Fetch only the required session data for the given user and sessionId
    const chat = await adsCreativeChats.findOne(
      { user_id: uid, "chat_sessions.sessionId": sessionId },
      { "chat_sessions.$": 1 } // Use MongoDB projection to return only the matching session
    ).lean();

    if (!chat || !chat.chat_sessions.length) {
      return res.status(404).json({ code: 404, message: "Session not found for the specified UID and Session ID" });
    }

    res.status(200).json({ code: 200, message: chat.chat_sessions[0].data , adsData: chat.chat_sessions[0].adsData });
  } catch (error) {
    console.error("Error fetching session messages:", error);
    res.status(500).json({ code: 500, message: "Failed to get messages" });
  }
};


exports.deleteAdsCreativeByUid = async (req, res)=> {
   
  try {
      const { uid } = req.params;
      const result = await adsCreativeChats.deleteOne({ user_id: uid });
      if (result.deletedCount === 0) {
          return res.status(404).json({ code: 404, message: `No document found with uid: ${uid}` });
      } else {
         return res.status(200).json({ code: 200, message: `Document with uid: ${uid} deleted successfully.` });
      }
  } catch (error) {
      return res.status(500).json({ code: 500, message: 'Failed to delete' });
  }
}

exports.deleteAdCreativeChatByUidAndSessionId = async (req, res) => {
   
   const {uid,sessionId}= req.params;
   try {
       if (!uid || !sessionId) {
           return res.status(400).send('Both uid and sessionId are required');
       }
 
       const result = await adsCreativeChats.updateOne(
           { user_id: uid },
           { $pull: { chat_sessions: { sessionId: sessionId } } }
       );
 
       if (result.modifiedCount === 0) {
           return res.status(404).json({ code: 404, message: `No chat found with uid: ${uid} and sessionId: ${sessionId}` });
       } else {
           return res.status(200).json({ code: 200, message: `Chat with uid: ${uid} and sessionId: ${sessionId} deleted successfully.` });
       }
   } catch (error) {
       console.error(`Error deleting chat with uid: ${uid} and sessionId: ${sessionId}`, error);
       return res.status(500).json({ code: 500, message: 'Failed to delete' });
   }
 };

//  exports.getAdCreativeChatsByResponder = async (req, res) => {

   
  
//     try {
//         const uid = req.params.uid;
  
//         const chat = await adsCreativeChats.findOne({ user_id: uid});
  
//         if (!chat) {
//             return res.status(404).json({ code: 404, message: 'Chat not found for the specified UID' });
//         }
  
//         const getLastMessagesByResponder = (chatData, responder) => {
//             return chatData.chat_sessions.map(session => {
//                 const userMessages = session.data.filter(message => message.type === responder);

//                 const lastMessage = userMessages[userMessages.length - 1]?.message
//                 const lastMessageDate = userMessages[userMessages.length - 1]?.timestamp
  
//                 return {
//                     sessionId: session.sessionId,
//                     lastMessage,
//                     lastMessageDate
//                 };
//             }).filter(session => session.lastMessage);
//         };
  
//         const filteredSessions = getLastMessagesByResponder(chat, 'user');
  
//         if (filteredSessions.length === 0) {
//             return res.status(404).json({ code: 404, message: 'No chats found responded by the specified user' });
//         }
//         const result = {
//             uid: chat.user_id,
//             // username: chat.username,
//             chat_sessions: filteredSessions.reverse()
//         };
  
//         res.status(200).json({ code: 200, chat: result });
//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ code: 500, message: 'Failed to get chats' });
//     }
//   };


// exports.getAdCreativeChatsByResponder = async (req, res) => {

  
//     try {
//       const uid = req.params.uid;
  
//       // Fetch only required fields and use `.lean()` to return plain JSON objects for faster processing
//       const chat = await adsCreativeChats.findOne(
//         { user_id: uid },
//         { "chat_sessions.sessionId": 1, "chat_sessions.data.type": 1, "chat_sessions.data.message": 1, "chat_sessions.data.timestamp": 1 }
//       ).lean();
  
//       if (!chat) {
//         return res.status(404).json({ code: 404, message: "Chat not found for the specified UID" });
//       }
  
//       // Extract last message from 'user' for each session
//       const filteredSessions = chat.chat_sessions
//         .map(({ sessionId, data }) => {
//           const lastMessageObj = [...data]
//             .reverse() // Reverse once to get the last user message efficiently
//             .find(({ type }) => type === "user");
//           return lastMessageObj
//             ? { sessionId, lastMessage: lastMessageObj.message, lastMessageDate: lastMessageObj.timestamp }
//             : null;
//         })
//         .filter(Boolean) // Remove null values
//         .reverse(); // Reverse the final list for the required order
  
//       if (filteredSessions.length === 0) {
//         return res.status(404).json({ code: 404, message: "No chats found responded by the specified user" });
//       }
  
//       res.status(200).json({
//         code: 200,
//         chat: {
//           uid: chat.user_id,
//           chat_sessions: filteredSessions
//         }
//       });
//     } catch (error) {
//       console.error("Error fetching chats:", error);
//       res.status(500).json({ code: 500, message: "Failed to get chats" });
//     }
//   };
exports.getAdCreativeChatsByResponder = async (req, res) => {
 
  try {
    const uid = req.params.uid;

    // Fetch only required fields and use `.lean()` for better performance
    const chat = await adsCreativeChats.findOne(
      { user_id: uid },
      { 
        "chat_sessions.sessionId": 1, 
        "chat_sessions.data.type": 1, 
        "chat_sessions.data.message": 1, 
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
          .slice() // Create a copy to avoid mutating original
          .reverse()
          .find(({ type }) => type === "user");
        
        if (!lastMessageObj) return null;
        
        // Convert timestamp to proper ISO format for accurate sorting
        const isoFormattedTimestamp = lastMessageObj.timestamp
          .replace(/(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})/, '$1-$2-$3T$4:$5:$6')
          .replace(' ', 'T');
        
        return { 
          sessionId, 
          lastMessage: lastMessageObj.message, 
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
// Save image when user clicks on save
exports.saveImage = async (req, res) => {
  try {
    const data = req.body;
    if (!data?.url)
      return res.status(400).json({ message: "Image url is required", success: false });
    const image = await IMAGE.findOneAndUpdate({ image_url: data?.url }, { type: 2 }, { new: true });
    
    if (!image) {
      return res.status(404).json({ message: "Image not found", success: false });
    }

    return res.status(200).json({
        message: "Image saved successfully",
        success: true,
        data: image,
      });
  } catch (error) {
    console.error("Error saving image:", error);
    return res.status(500).json({ message: "Internal server error", success: false });
  }
};

// Save edited image
exports.saveEditedImage = async (req, res) => {
  try {
    const data = req.body;
    if(!data?.image_url || !data?.user_id) return res.status(400).json({ message: "Image url and user id is required", success: false });
    const image = new IMAGE({ image_url: data?.image_url, user_id: data?.user_id, type: 2 });
    await image.save();
    return res.status(200).json({
        message: "Image saved successfully",
        success: true,
        data: image,
    });
  } catch (error) {
    console.error("Error saving image:", error);
    return res.status(500).json({ message: "Internal server error", success: false });
  }
};

// Get all images saved by user
exports.getUserCreatives = async (req, res) => {
  try {
    const { id } = req.params;
    const creatives = await IMAGE.find({ user_id: id });
    if (!creatives) return res.status(404).json({ message: "No creatives found for the user", success: false });
    return res.status(200).json({ message: "Creatives found successfully", success: true, data: creatives });
  } catch (error) {
    console.error("Error fetching images:", error);
    return res.status(500).json({ message: "Internal server error", success: false });
  }
}

// Delete an image
exports.deleteCreative = async (req, res) => { 
  try {
    const data = req.body;
    if(!data?.user_id || !data?.image_url) return res.status(400).json({ message: "Image url and user id is required", success: false });
    await axios.delete(`${process.env.NAS_UPLOAD_URL}/delete${data?.image_url}`);
    const image = await IMAGE.findOneAndDelete({ image_url: data?.image_url, user_id: data?.user_id });
    if (!image) return res.status(404).json({ message: "Creative not found", success: false });
    return res.status(200).json({ message: "Creative deleted successfully", success: true });
  } catch (error) {
    console.error("Error deleting images:", error);
    return res.status(500).json({ message: "Internal server error", success: false });
  }
}

// Get creative details
exports.creativeDetails = async (req, res) => {
  try {
    const { url } = req.body;
    const creative = await IMAGE.findOne({ image_url: url });
    if (!creative) return res.status(404).json({ message: "No creative found", success: false });
    return res.status(200).json({ message: "Creative found successfully", success: true, data: creative });
  } catch (error) {
    console.error("Error fetching image:", error);
    return res.status(500).json({ message: "Internal server error", success: false });
  }
}

  exports.getChatsMessageById = async (req, res) => {
      try {
          const userid = req.params.uid;  
  
         
          const pipeline = [
              { $match: { user_id: userid } },  
              { $unwind: "$chat_sessions" },  
              { $sort: { "chat_sessions.lastUpdateTime": -1 } }, 
              { $limit: 3 },  
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
  
          const result = await adsCreativeChats.aggregate(pipeline);
          let messages = result
          .map((session) =>
            session.chat_sessions
              .map((data) =>
                data.data
                  .filter((message) => message?.type === "bot")
                  .map((message) => ({
                    data: message?.message + message?.end_message,
                    time: message?.timestamp
                  }))
              )
          )
          .flat(2);
          const convertToEpoch = (dateString) => new Date(dateString ? dateString.replace(/(\d{4}-\d{2}-\d{2}) (\d{2})-(\d{2})-(\d{2})/, "$1 $2:$3:$4") : "1990-02-06 18-58-05").getTime() || 0;
          res.status(200).json({ code: 200, recent_sessions:  [...new Set(messages)].sort((a, b) => convertToEpoch(b.time) - convertToEpoch(a.time))[0] });
        // res.status(200).json({ code: 200, recent_sessions:result });
  
      } catch (error) {
          res.status(500).json({ code: 500, message: 'Failed to get chat' });
      }
  };
  
  exports.uploadImageFromFormData = async (req, res) => {
    try {
      const userId = req?.body?.userId;
      const file = req.file;
      const save = req?.body?.save;
      if (!file) {
        console.error("No file received");
        return res.status(400).json({ error: "No file received" });
      }
      // Defense-in-depth: this endpoint is image-only (it re-encodes to webp), so
      // reject anything that isn't an image — otherwise a non-image (e.g. a
      // renamed executable) tagged with an image MIME could be stored via S3.
      if (!(file.mimetype || "").startsWith("image/")) {
        return res
          .status(400)
          .json({ error: "Only image files are supported." });
      }

      const fileName = getFileName(".webp");
  
    // Upload original file directly to S3 without processing
    // 1. Upload to S3
    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `creatives/${userId}/${fileName}`,
      Body: file.buffer,
      ContentType: "image/webp",
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    const s3Url = `/${uploadParams.Key}`;

   

    if (save && save === "True") {
      await saveImageUrl(s3Url, userId);
    }
    return res.status(200).json({ data: s3Url });
    } catch (error) {
      console.error("Error in uploadImageFromFormData:", error);
      return res.status(500).json({ error: "Image upload failed" });
    }
  };


  exports.uploadLogoFromSideBarData = async (req, res) => {
    try {
      const userId = req?.body?.userId;
      const file = req.file;
  
      if (!file) {
        console.error("No file received");
        return res.status(400).json({ error: "No file received" });
      }
  
      // Extract file details
      const tempDir = ensureTempFolderExists();
      const fileName = getFileName(".png"); // Save as WebP format
      const tempFilePath = path.join(tempDir, fileName);
  
      // Compress & Convert to WebP
      // await sharp(file.buffer)
      //   .resize({ width: 800 }) // Resize if larger than 800px
      //   .webp({ quality: 80 }) // Convert to WebP with 80% quality
      //   .toFile(tempFilePath);
  
      // Read compressed file as buffer
      // const compressedBuffer = await fs.promises.readFile(tempFilePath);
  
      // Upload to S3
      const uploadParams = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: `uploads/logo/${userId}/${fileName}`,
        Body: file.buffer,
        ContentType: "image/png",
      };
  
      await s3Client.send(new PutObjectCommand(uploadParams));
      // await fs.promises.unlink(tempFilePath);
      const s3Url = `${process.env.AWS_IMAGE_VIEW_URL}/${uploadParams.Key}`;

    //   const formData = new FormData();
    // formData.append("type", "IMAGE");
    // formData.append("userId", `uploads/logo/${userId}`);
    // formData.append("download", "false");
    // formData.append("file", file.buffer, {
    //   filename: file.originalname || fileName,
    //   contentType: file.mimetype,
    // });
    // const response = await axios.post(
    //   `${process.env.NEW_NAS_UPLOAD_URL}/ads-gpt-download`, // replace with actual URL
    //   formData,
    //   {
    //     headers: formData.getHeaders(),
    //   }
    // );
    // const s3Url = `${process.env.AWS_IMAGE_VIEW_URL}${response.data?.data}` || null;
  
      return res.status(200).json({ data: s3Url });
    } catch (error) {
      console.error("Error in uploadImageFromFormData:", error);
      return res.status(500).json({ error: "Image upload failed" });
    }
  };
