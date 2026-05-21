const adsVideoChats = require("../Module/adVideo/adVideo");
const Redis = require("ioredis");
const axios = require("axios");
const { scrapePage, scrapePage2 } = require("../utils/scrape");
const brandNameLists = require("../Module/brandNames/brandNamesSchema");


exports.getAdvideoChatsByResponder = async (req, res) => {
   
    try {
      const uid = req.params.uid;
  
      // Fetch only required fields and use `.lean()` for better performance
      const chat = await adsVideoChats.findOne(
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

  exports.deleteAdvideoByUid = async (req, res)=> {
   
  try {
      const { uid } = req.params;
      const result = await adsVideoChats.deleteOne({ user_id: uid });
      if (result.deletedCount === 0) {
          return res.status(404).json({ code: 404, message: `No document found with uid: ${uid}` });
      } else {
         return res.status(200).json({ code: 200, message: `Document with uid: ${uid} deleted successfully.` });
      }
  } catch (error) {
      return res.status(500).json({ code: 500, message: 'Failed to delete' });
  }
}

exports.deleteAdvideoChatByUidAndSessionId = async (req, res) => {
   
  
   const {uid,sessionId}= req.params;
   try {
       if (!uid || !sessionId) {
           return res.status(400).send('Both uid and sessionId are required');
       }
 
       const result = await adsVideoChats.updateOne(
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

 exports.getAdvideoMessagesBySession = async (req, res) => {
   
  
    try {
      const { uid, sessionId } = req.params;
  
      // Fetch only the required session data for the given user and sessionId
      const chat = await adsVideoChats.findOne(
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

  exports.createAdvideoChat = async (req, res) => {
    try {
        const { user_id, sessionId,adsData,...restData } = req.body;
  
      // Combine chatid with restData before saving
      // const dataToSave = { chatid, ...restData };
        const updateResult = await adsVideoChats.updateOne(
            { user_id, "chat_sessions.sessionId": sessionId },
            {
                $push: { "chat_sessions.$.data":restData },
                $set: { "chat_sessions.$.lastUpdateTime": new Date()}
            }
          );
        if (updateResult.modifiedCount === 0){
            // If no existing session was found, create a new session or a new user record
            await adsVideoChats.updateOne(
                { user_id },
                {
                    $push: {
                        chat_sessions: {
                            sessionId,
                            adsData,
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

  exports.storeAdVideoChat = async (data) => {
    try {
      // First, try to find the existing user document
      const storagePayload={
        "sessionId":data?.session?.sessionId,
         "user_id":data?.session?.userId,
         "type":"bot",
         "chatId": data?.session?.chatId,
         "message":"",
         "ads":[
            {
               "video_ad":data?.queryResult?.videoUrl,
               "video_complete":true,
               "aspect_ratio":data?.queryResult?.aspectRatio,
               "numVideos":data?.queryResult?.numVideos
            }
         ],
         "complete":true
        }
      const { user_id, sessionId,...chatData } = storagePayload;
      const userDoc = await adsVideoChats.findOne({ user_id });
  
      // If user document doesn't exist, create a new one with the session and chat data
      if (!userDoc) {
        const newChatSession = {
          sessionId,
          data: [chatData],
          lastUpdateTime: new Date()
        };
  
        await adsVideoChats.create({
          user_id,
          chat_sessions: [newChatSession]
        });
  
        return { success: true, message: "New user and chat session created successfully" };
      }
  
      // Try to find the existing session
      const sessionIndex = userDoc.chat_sessions.findIndex(s => s.sessionId === sessionId);
  
      // If session doesn't exist, add a new session with the chat data
      if (sessionIndex === -1) {
        await adsVideoChats.updateOne(
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
      if (chatData.chatid) {
        const chatIndex = userDoc.chat_sessions[sessionIndex].data.findIndex(
          chat => chat.chatid === chatData.chatid
        );
  
        // If chat exists, update it
        if (chatIndex !== -1) {
          const updateOperation = {
            $set: {
              [`chat_sessions.${sessionIndex}.data.${chatIndex}`]: chatData,
              [`chat_sessions.${sessionIndex}.lastUpdateTime`]: new Date()
            }
          };
  
          await adsVideoChats.updateOne(
            { user_id, "chat_sessions.sessionId": sessionId },
            updateOperation
          );
  
          return { success: true, message: "Chat data updated successfully" };
        }
      }
  
      // Chat doesn't exist or doesn't have chatid, push new chat data
      await adsVideoChats.updateOne(
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


  

// utils/normalizeWebsiteUrl.js (or same file)
const getHostname = (rawUrl) => {
  let normalized;
  try {
    normalized = new URL(rawUrl);
  } catch {
    // No protocol → assume https://
    normalized = new URL(`https://${rawUrl}`);
  }
  return normalized.hostname.replace(/^www\./, "").toLowerCase();
};

const buildDomainRegex = (host) => {
  return new RegExp(`^https?:\\/\\/(www\\.)?${host}(\\/|$)`, "i");
};
exports.analyzeUrl = async (req, res) => {
  try {
    const { url } = req.query;
    const userId = req.user?.user_id;

  if (!userId) {
    return res.status(401).json({
      message: "Unauthorized"
    });
  }

  if (!url) {
    return res.status(400).json({
      message: "Website URL is required"
    });
  }

  let incomingHost;
  try {
    incomingHost = getHostname(url);
  } catch {
    return res.status(400).json({
      message: "Invalid website URL"
    });
  }

    const domainRegex = buildDomainRegex(incomingHost);

  
    // const alreadyExists = await brandNameLists.findOne({
    //   user_id: userId,
    //   brands: {
    //     $elemMatch: {
    //       websiteUrl: incomingHost,
    //     },
    //   },
    // }).lean();

    // if (alreadyExists) {
    //   return res.status(409).json({
    //     message: "This website is already added for this user"
    //   });
    // }

  
    const data = await scrapePage2(url);

    const analyzedBrandName =
      data?.meta?.title?.trim()?.toLowerCase();
      // console.log(data.meta.title)

    // if (analyzedBrandName) {
    //   const brandExists = await brandNameLists.findOne({
    //     user_id: userId,
    //     brands: {
    //       $elemMatch: {
    //         brandName: {
    //           $regex: `^${analyzedBrandName}$`,
    //           $options: "i",
    //         },
    //       },
    //     },
    //   }).lean();

    //   if (brandExists) {
    //     return res.status(409).json({
    //       message: "Brand already exists for this user",
    //       brandName: data.meta.title,
    //     });
    //   }
    // }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({
      message: "Scraping failed",
      details: err.message,
    });
  }
};