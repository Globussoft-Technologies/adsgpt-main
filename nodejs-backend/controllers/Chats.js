const { pub } = require("../db/redis");
const Chats = require("../Module/chatData/Chats");
const validateData = require("../Module/chatData/chatValidate");
const { TokenDecode } = require('../services/authService');
const logger = require('../utils/logger');

 




// Create or Update Chat
// exports.createChat = async (data, socket) => {
//     try {
//         const { error } = validateData(data);
//         if (error) {
//             return socket.emit('error', { code: 400, message: error.details[0].message });
//         }

//         const { uid, username, sessionId, message_chain, token,...restData } = data;
//         user = await TokenDecode(token);
//         subscriptionTypeKey = Object.keys(user?.userSubscriptionType)[0];
//         const chatDoc = await Chats.findOne({ uid });

//         if (chatDoc) {
//             const sessionIndex = chatDoc.chat_sessions.findIndex(session => session.sessionId === sessionId);

//             if (sessionIndex !== -1) {
//                 const updatedChat = await Chats.findOneAndUpdate(
//                     { uid, 'chat_sessions.sessionId': sessionId },
//                     { 
//                         $set: { 'chat_sessions.$.data': [...chatDoc.chat_sessions[sessionIndex].data, restData] } 
//                     },
//                     { new: true }
//                 );

//                 return socket.emit('success', { code: 200, message: 'Chat updated successfully', chat: updatedChat });
//             } else {
//                 // Create a new session if it doesn't exist
//                 chatDoc.chat_sessions.push({
//                     sessionId,
//                     data: [restData]
//                 });

//                 const updatedChat = await chatDoc.save();
//                 return socket.emit('success', { code: 201, message: 'New session created successfully', chat: updatedChat });
//             }
//         } else {
//             const newChat = new Chats({
//                 uid,
//                 username,
//                 chat_sessions: [{
//                     sessionId,
//                     data: [restData]
//                 }]
//             });

//             const savedChat = await newChat.save();
//             return socket.emit('success', { code: 201, message: 'Chat created successfully', chat: savedChat });
//         }

//     } catch (error) {
//         console.error('Failed to create or update chat:', error);
//         return socket.emit('error', { code: 500, message: 'Failed to create or update chat' });
//     }
// };

exports.createChat = async (data) => {
    try {
        const { error } = validateData(data);
        if (error) {
            //return socket.emit('error', { code: 400, message: error.details[0].message });
        }

        const { uid, username, sessionId, token, ...restData } = data;
        const user = await TokenDecode(token);

        // Get the current plan from user subscription type, defaulting to 'undefined_plan'
        const currentPlan = user?.userSubscriptionType ? Object.keys(user.userSubscriptionType)[0] : 'undefined_plan';

        const chatDoc = await Chats.findOne({ uid });

        if (chatDoc) {
            // Update currentPlan if it has changed
            if (chatDoc.currentPlan !== currentPlan) {
                chatDoc.currentPlan = currentPlan;
                await chatDoc.save();
            }

            const sessionIndex = chatDoc.chat_sessions.findIndex(session => session.sessionId === sessionId);

            if (sessionIndex !== -1) {
                // Update existing session
                const updatedChat = await Chats.findOneAndUpdate(
                    { uid, 'chat_sessions.sessionId': sessionId },
                    { 
                        $set: { 
                            'chat_sessions.$.data': [...chatDoc.chat_sessions[sessionIndex].data, restData],
                            'chat_sessions.$.lastUpdateTime': new Date() // Ensure lastUpdateTime is always set
                        }
                    },
                    { new: true }
                );

               // return socket.emit('success', { code: 200, message: 'Chat updated successfully', chat: updatedChat });
            } else {
                // Create a new session if it doesn't exist
                chatDoc.chat_sessions.push({
                    sessionId,
                    data: [restData],
                    lastUpdateTime: new Date()  // Ensure lastUpdateTime is always set
                });

                const updatedChat = await chatDoc.save();
                //return socket.emit('success', { code: 201, message: 'New session created successfully', chat: updatedChat });
            }
        } else {
            // Create a new chat if it doesn't exist
            const newChat = new Chats({
                uid,
                username,
                currentPlan,
                chat_sessions: [{
                    sessionId,
                    data: [restData],
                    lastUpdateTime: new Date()  // Ensure lastUpdateTime is set for new session
                }]
            });

            const savedChat = await newChat.save();
           // return socket.emit('success', { code: 201, message: 'Chat created successfully', chat: savedChat });
        }

    } catch (error) {
        console.error('Failed to create or update chat:', error);
        //return socket.emit('error', { code: 500, message: 'Failed to create or update chat' });
    }
};

// Delete Chat With time

exports.deleteOldChatSessionsFromPlans = async (planNum, months = 1) => {
    try {
        // Step 1: Calculate the date based on the provided number of months ago
        const currentDate = new Date();
        const dateAgo = new Date();
        dateAgo.setMonth(currentDate.getMonth() - months);

        // Step 2: Find chats where 'currentPlan' matches and where at least one session is older than the calculated date
        const result = await Chats.updateMany(
            { 
                currentPlan: planNum, // Filter by the provided plan number
                'chat_sessions.lastUpdateTime': { $lt: dateAgo } // Filter for sessions older than the calculated date
            },
            { 
                $pull: { chat_sessions: { lastUpdateTime: { $lt: dateAgo } } } // Remove old sessions
            }
        );

        // Step 3: Check if any sessions were modified and respond accordingly
        if (result.modifiedCount > 0) {
            const message = `${result.modifiedCount} chat sessions older than ${months} month(s) have been deleted from users with currentPlan '${planNum}'`;
            logger.info(message); // Log the successful deletion
           // console.log(message); // Optionally log to console
            return;
        } else {
            const message = `No chat sessions older than ${months} month(s) found for users with currentPlan ${planNum}`;
            logger.info(message); // Log the absence of sessions
          //  console.log(message); // Optionally log to console
            return;
        }
    } catch (error) {
        logger.error('Error deleting old chat sessions:', error); // Log the error
       // console.error('Error deleting old chat sessions:', error); // Optionally log to console
    }
};

// Get Chat by ID
exports.getChatById = async (req, res) => {
    
    try {
        const chat = await Chats.findOne({ uid: req.params.uid });
        if (chat) {
            res.status(200).json({ code: 200, chat });
        } else {
            res.status(404).json({ code: 404, message: 'Chat not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ code: 500, message: 'Failed to get chat' });
    }
};

exports.getChatsMessageById = async (req, res) => {
    try {
        const userid = req.params.uid;  


       
        const pipeline = [
            { $match: { uid: userid } },  
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

        const result = await Chats.aggregate(pipeline);
        let messages = result
    .flatMap(session => 
        session.chat_sessions.flatMap(data => 
            data.data
                .filter(message => message.responseBy === 'user')
                .map(message => ({
                    data: message?.message,
                    time: message?.timestamp
                }))
        )
    );
        res.status(200).json({ code: 200, recent_sessions: [...new Set(messages)][[...new Set(messages)].length-1] });
        // res.status(200).json({ code: 200, recent_sessions:result });

    } catch (error) {

        res.status(500).json({ code: 500, message: 'Failed to get chat' });
    }
};


exports.getChatsByResponder = async (req, res) => {
    try {
        const uid = req.params.uid;
        // console.log("uid", uid);
        const chat = await Chats.findOne({ uid: uid });

        if (!chat) {
            return res.status(404).json({ code: 404, message: 'Chat not found for the specified UID' });
        }

        const getLastMessagesByResponder = (chatData, responder) => {
            return chatData.chat_sessions.map(session => {
                const userMessages = session.data.filter(message => message.responseBy === responder);
                const lastMessage = userMessages[userMessages.length - 1]?.message
                const lastMessageDate = userMessages[userMessages.length - 1]?.timestamp
                return {
                    sessionId: session.sessionId,
                    lastMessage,
                    lastMessageDate
                };
            }).filter(session => session.lastMessage);
        };

        const filteredSessions = getLastMessagesByResponder(chat, 'user');
        // console.log(filteredSessions)

        if (filteredSessions.length === 0) {
            return res.status(404).json({ code: 404, message: 'No chats found responded by the specified user' });
        }

        const result = {
            uid: chat.uid,
            username: chat.username,
            chat_sessions: filteredSessions.reverse()
        };

        res.status(200).json({ code: 200, chat: result });
    } catch (error) {
     
        res.status(500).json({ code: 500, message: 'Failed to get chats' });
    }
};

exports.getMessagesBySession = async (req, res) => {

    try {
        const { uid, sessionId } = req.params;

        const chat = await Chats.findOne({ uid });

        if (!chat) {
            return res.status(404).json({ code: 404, message: 'Chat not found for the specified UID' });
        }

        const session = chat.chat_sessions.find(session => session.sessionId === sessionId);

        if (!session) {
            return res.status(404).json({ code: 404, message: 'Session not found for the specified Session ID' });
        }

        const messages = session.data.filter(message => message.responseBy === 'user');

        if (messages.length === 0) {
            return res.status(404).json({ code: 404, message: 'No messages from user found in this session' });
        }

        const lastMessage = messages[messages.length - 1];
        const messageChain = messages.slice(Math.max(messages.length - 5, 0), messages.length);
        const logData = {
            uid: chat.uid,
            token:req?.headers?.authorization.replace('Bearer',''),
            username: chat.username,
            sessionId: session.sessionId,
            chatId: lastMessage.chatId,
            message: lastMessage.message,
            timestamp: lastMessage.timestamp,
            responseBy: lastMessage.responseBy,
            history: true,
            message_chain: messageChain
        };
        
        pub.publish("chatRequest", JSON.stringify(logData));

        // console.log(JSON.stringify(logData, null, 2));

        res.status(200).json({ code: 200, message: session.data });
    } catch (error) {
       
        res.status(500).json({ code: 500, message: 'Failed to get messages' });
    }
};


exports.deleteByUid = async (req, res)=> {
    try {
        const { uid } = req.params;
        const result = await Chats.deleteOne({ uid: uid });
        if (result.deletedCount === 0) {
            return res.status(404).json({ code: 404, message: `No document found with uid: ${uid}` });
        } else {
           return res.status(200).json({ code: 200, message: `Document with uid: ${uid} deleted successfully.` });
        }
    } catch (error) {
        // console.error(`Error deleting document with uid: ${uid}`, error);
        return res.status(500).json({ code: 500, message: 'Failed to delete' });
    }
}

exports.deleteChatByUidAndSessionId = async (req, res) => {
    const { uid, sessionId } = req.query;
    
    try {
        if (!uid || !sessionId) {
            return res.status(400).send('Both uid and sessionId are required');
        }

        const result = await Chats.updateOne(
            { uid: uid },
            { $pull: { chat_sessions: { sessionId: sessionId } } }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ code: 404, message: `No chat found with uid: ${uid} and sessionId: ${sessionId}` });
        } else {
            return res.status(200).json({ code: 200, message: `Chat with uid: ${uid} and sessionId: ${sessionId} deleted successfully.` });
        }
    } catch (error) {
        // console.error(`Error deleting chat with uid: ${uid} and sessionId: ${sessionId}`, error);
        return res.status(500).json({ code: 500, message: 'Failed to delete' });
    }
};

exports.createChatHistory = async (req, res) => {
    try {
        const data = req.body;
        const { error } = validateData(data);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        const { uid, username, sessionId, token, ...restData } = data;
        const user =  TokenDecode(token);
        
        // Get the current plan from user subscription type, defaulting to 'undefined_plan'
        const currentPlan = user?.userSubscriptionType ? Object.keys(user.userSubscriptionType)[0] : 'undefined_plan';

        const chatDoc = await Chats.findOne({ uid });

        if (chatDoc) {
            // Update currentPlan if it has changed
            if (chatDoc.currentPlan !== currentPlan) {
                chatDoc.currentPlan = currentPlan;
                await chatDoc.save();
            }
            const sessionIndex = chatDoc.chat_sessions.findIndex(session => session.sessionId === sessionId);
            if (sessionIndex !== -1) {
                // Update existing session
                const updatedChat = await Chats.findOneAndUpdate(
                    { uid, 'chat_sessions.sessionId': sessionId },
                    { 
                        $set: { 
                            'chat_sessions.$.data': [...chatDoc.chat_sessions[sessionIndex].data, restData],
                            'chat_sessions.$.lastUpdateTime': new Date() // Ensure lastUpdateTime is always set
                        }
                    },
                    { new: true }
                );

                return res.status(200).json({ message: 'Chat updated successfully', chat: updatedChat });
            } else {
                // Create a new session if it doesn't exist
                chatDoc.chat_sessions.push({
                    sessionId,
                    data: [restData],
                    lastUpdateTime: new Date()  // Ensure lastUpdateTime is always set
                });

                const updatedChat = await chatDoc.save();
                return res.status(201).json({ message: 'New session created successfully', chat: updatedChat });
            }
        } else {
            // Create a new chat if it doesn't exist
            const newChat = new Chats({
                uid,
                username,
                currentPlan,
                chat_sessions: [{
                    sessionId,
                    data: [restData],
                    lastUpdateTime: new Date()  // Ensure lastUpdateTime is set for new session
                }]
            });

            const savedChat = await newChat.save();
            return res.status(201).json({ message: 'Chat created successfully', chat: savedChat });
        }

    } catch (error) {
        console.error('Failed to create or update chat:', error);
        return res.status(500).json({ message: 'Failed to create or update chat' });
    }
};
// Update Chat by ID
exports.updateChat = async (req, res) => {
    
    try {
        const updatedChat = await Chats.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (updatedChat) {
            res.status(200).json({ code: 200, chat: updatedChat });
        } else {
            res.status(404).json({ code: 404, message: 'Chat not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ code: 500, message: 'Failed to update chat' });
    }
};

// Delete Chat by ID
exports.deleteChat = async (req, res) => {
   
    try {
        const deletedChat = await Chats.findByIdAndDelete(req.params.id);
        if (deletedChat) {
            res.status(200).json({ code: 200, message: 'Chat deleted successfully' });
        } else {
            res.status(404).json({ code: 404, message: 'Chat not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ code: 500, message: 'Failed to delete chat' });
    }
};


exports.getTotalChatCountByUid = async (uid) => {
    try {
        // Use MongoDB aggregation to calculate the total number of user messages
        const result = await Chats.aggregate([
            { $match: { uid } },  // Match the document by uid
            { $unwind: "$chat_sessions" },  // Unwind the chat_sessions array
            { $unwind: "$chat_sessions.data" },  // Unwind the data array within chat_sessions
            {
                $match: {
                    "chat_sessions.data.responseBy": "user"  // Filter messages by responseBy
                }
            },
            {
                $group: {
                    _id: "$uid",  // Group by UID
                    totalChatCount: { $sum: 1 }  // Count each user message
                },
            }
        ]);


        // If no result is returned, the UID has no chats
        if (result.length === 0) {
            return 0;
        }

        // Send the result back to the client
        const { totalChatCount } = result[0];
        //console.log("Aggregation result:", totalChatCount);

        return totalChatCount;
    } catch (error) {
        console.error('Error fetching total chat count:', error);
        return -1;
    }
};


