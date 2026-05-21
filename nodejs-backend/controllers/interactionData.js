const { json } = require('body-parser');
const User = require('../Module/userInteractionData/userInteractionData');


let interactionQueue = [];
const BATCH_SIZE = 10; 
const PROCESS_INTERVAL = 5000; 


async function updateUserInteraction(req, res) {
  const { user_id, user_name, user_email, clicks, hovers, copies, scrolls, sessionId,adCreativeSide, adCopySide ,adImageGenerationReview, pageLocation} = req.body;

  try {
    interactionQueue.push({
      user_id,
      user_name,
      user_email,
      clicks,
      hovers,
      copies,
      scrolls,
      adCreativeSide, 
      adImageGenerationReview,
      adCopySide,
      sessionId,
      pageLocation,
    });

    return res.status(200).json({ message: 'Data received and queued for processing.' });
  } catch (error) {
    // console.error('Error queuing the data:', error);
    return res.status(500).json({ message: 'Internal server error.', error });
  }
}

async function processQueue() {
  if (interactionQueue.length === 0) {
    return;
  }
  const batch = interactionQueue.splice(0, BATCH_SIZE);

  try {
    for (const data of batch) {
      const { user_id, user_name, user_email, clicks, hovers, copies, scrolls, sessionId, adCreativeSide, adCopySide, adImageGenerationReview,pageLocation, } = data;
      let user = await User.findOne({ user_id });

      const chatSessionID = clicks?.chat_session_ID || copies?.chat_session_ID || adImageGenerationReview?.chat_session_ID || hovers?.chat_session_ID || scrolls?.chat_session_ID;

      if (!user) {
        const newUser = new User({
          user_id,
          user_name,
          user_email,
          sessions: [
            {
              sessionId,
              pageLocation: pageLocation?.data || null,
              sessionDate: new Date().toLocaleDateString('en-GB'),
              chats: [
                {
                  chatSessionId: chatSessionID,
                  clicks: clicks?.data ? [clicks.data] : [],
                  hover: hovers?.data ? [hovers.data] : [],
                  copy: copies?.data ? [copies.data] : [],
                  scroll: scrolls?.data ? [scrolls.data] : [],
                  adImageGenerationReview: adImageGenerationReview?.data ? [adImageGenerationReview.data] : [],
                  adCreativeSide: Array.isArray(adCreativeSide) ? [...adCreativeSide] : [],
                  adCopySide: Array.isArray(adCopySide) ? [...adCopySide] : [],
                },
              ],
              sessionDate: new Date().toLocaleDateString('en-GB'),
            },
          ],
        });

        await newUser.save();
      } else {
        const sessionIndex = user.sessions.findIndex((session) => session.sessionId === sessionId);

        if (sessionIndex === -1) {
          user.sessions.push({
            sessionId,
            pageLocation: pageLocation?.data || null,
              sessionDate: new Date().toLocaleDateString('en-GB'),
            chats: [
              {
                chatSessionId: chatSessionID,
                clicks: clicks?.data ? [clicks.data] : [],
                hover: hovers?.data ? [hovers.data] : [],
                copy: copies?.data ? [copies.data] : [],
                scroll: scrolls?.data ? [scrolls.data] : [],
                adImageGenerationReview: adImageGenerationReview?.data ? [adImageGenerationReview.data] : [],
                adCreativeSide: Array.isArray(adCreativeSide) ? [...adCreativeSide] : [],
                adCopySide: Array.isArray(adCopySide) ? [...adCopySide] : [],
              },
            ],
            sessionDate: new Date().toLocaleDateString('en-GB'),
          });
        } else {
          if (!user.sessions[sessionIndex].pageLocation && pageLocation?.data) {
            user.sessions[sessionIndex].pageLocation = pageLocation.data;
          }
          const chatIndex = user.sessions[sessionIndex].chats.findIndex(
            (chat) => chat.chatSessionId === chatSessionID
          );

          if (chatIndex === -1) {
            user.sessions[sessionIndex].chats.push({
              chatSessionId: chatSessionID,
              clicks: clicks?.data ? [clicks.data] : [],
              hover: hovers?.data ? [hovers.data] : [],
              copy: copies?.data ? [copies.data] : [],
              scroll: scrolls?.data ? [scrolls.data] : [],
              adImageGenerationReview: adImageGenerationReview?.data ? [adImageGenerationReview.data] : [],
              adCreativeSide: Array.isArray(adCreativeSide) ? [...adCreativeSide] : [],
              adCopySide: Array.isArray(adCopySide) ? [...adCopySide] : [],
            });
          } else {
            const currentChat = user.sessions[sessionIndex].chats[chatIndex];

            // Process clicks
            if (clicks?.data) {
              for (const key in clicks.data) {
                if (currentChat.clicks[0][key]) {
                  currentChat.clicks[0][key].count += clicks.data[key].count;
                  currentChat.clicks[0][key].lastTimestamp = clicks.data[key].lastTimestamp;
                } else {
                  currentChat.clicks[0][key] = clicks.data[key];
                }
              }
            }

            // Process hovers
            if (hovers?.data) {
              Object.assign(currentChat.hover[0], hovers.data);
            }

            if (scrolls?.data) {
              for (const key in scrolls.data) {
                if (currentChat.scroll[0][key]) {
                  const uniqueAdIds = new Set([...currentChat.scroll[0][key].adId, ...scrolls.data[key].adId]);
                  currentChat.scroll[0][key].adId = [...uniqueAdIds];
                } else {
                  currentChat.scroll[0][key] = scrolls.data[key];
                }
              }
            }
            
            if (copies?.data) {
              for (const key in copies.data) {
                if (currentChat.copy[0][key]) {
                  currentChat.copy[0][key].count += copies.data[key].count;
                  currentChat.copy[0][key].lastTimestamp = copies.data[key].lastTimestamp;
                  const uniqueCopiedText = new Set([...currentChat.copy[0][key].copiedText, ...copies.data[key].copiedText]);
                  currentChat.copy[0][key].copiedText = [...uniqueCopiedText];
                } else {
                  currentChat.copy[0][key] = copies.data[key];
                }
              }
            }

            // Process adImageGenerationReview
            if (adImageGenerationReview?.data) {
              for (const key in adImageGenerationReview.data) {
                if (currentChat.adImageGenerationReview[0][key]) {
                  currentChat.adImageGenerationReview[0][key].like = adImageGenerationReview.data[key].like;
                  currentChat.adImageGenerationReview[0][key].dislike = adImageGenerationReview.data[key].dislike;
                  currentChat.adImageGenerationReview[0][key].save = adImageGenerationReview.data[key].save;
                  currentChat.adImageGenerationReview[0][key].download = adImageGenerationReview.data[key].download;
                } else {
                  currentChat.adImageGenerationReview[0][key] = adImageGenerationReview.data[key];
                }
              }
            }

            // Process adCreativeSide
            if (Array.isArray(adCreativeSide)) {
              currentChat.adCreativeSide = Array.from(new Set([...currentChat.adCreativeSide, ...adCreativeSide]));
            }

            // Process adCopySide
            if (Array.isArray(adCopySide)) {
              currentChat.adCopySide = Array.from(new Set([...currentChat.adCopySide, ...adCopySide]));
            }

            // Process adImageGenerationReview data array
            if (Array.isArray(adImageGenerationReview?.data)) {
              currentChat.adImageGenerationReview = Array.from(new Set([...currentChat.adImageGenerationReview, ...adImageGenerationReview.data]));
            }
          }
        }

        user.markModified('sessions');
        await user.save();
      }
    }
  } catch (error) {
    // console.error(error);
  }
}

const getUniquePostOwnersAndBrands = async (req, res) => {
  try {
    const { userid } = req.params;

    if (!userid) {
      return res.status(400).json({ success: false, message: "User ID is required." });
    }

    const pipeline = [
      { $match: { user_id: userid } }, 
      { $unwind: "$sessions" }, 
      { $sort: { "sessions.timestamp": -1 } }, 
      { $limit: 20 }, 
      { $unwind: "$sessions.chats" }, 
      {
        $project: {
          clicks: { $ifNull: ["$sessions.chats.clicks", []] },
          adCopySide: { $ifNull: ["$sessions.chats.adCopySide", []] },
          adCreativeSide: { $ifNull: ["$sessions.chats.adCreativeSide", []] },
          copy: { $ifNull: ["$sessions.chats.copy", []] },
        }
      },
      {
        $addFields: {
          postOwnersFromClicks: {
            $reduce: {
              input: "$clicks",
              initialValue: [],
              in: {
                $concatArrays: [
                  "$$value",
                  {
                    $map: {
                      input: { $objectToArray: "$$this" },
                      as: "click",
                      in: "$$click.v.postOwner"
                    }
                  }
                ]
              }
            }
          },
          postOwnersFromCopy: {
            $reduce: {
              input: "$copy",
              initialValue: [],
              in: {
                $concatArrays: [
                  "$$value",
                  {
                    $map: {
                      input: { $objectToArray: "$$this" },
                      as: "copy",
                      in: "$$copy.v.postOwner"
                    }
                  }
                ]
              }
            }
          },
          brandNamesFromAdCopy: {
            $map: {
              input: "$adCopySide",
              as: "adDetail",
              in: "$$adDetail.brandName"
            }
          },
          brandNamesFromAdCreative: {
            $map: {
              input: "$adCreativeSide",
              as: "adDetail",
              in: "$$adDetail.brandName"
            }
          }
        }
      },
      {
        $addFields: {
          combinedNames: {
            $setUnion: [
              "$postOwnersFromClicks",
              "$brandNamesFromAdCopy",
              "$brandNamesFromAdCreative",
              "$postOwnersFromCopy"
            ]
          }
        }
      },
      { $unwind: "$combinedNames" }, 
      { $match: { combinedNames: { $ne: null } } }, 
      { $group: { _id: null, uniqueNames: { $addToSet: "$combinedNames" } } },
      { $project: { _id: 0, uniqueNames: 1 } } 
    ];

    const result = await User.aggregate(pipeline);

    if (!result || result.length === 0 || !result[0].uniqueNames.length) {
      return res.status(404).json({
        success: false,
        message: "No post owners or brands found in the last two sessions.",
        data: []
      });
    }

    return res.status(200).json({
      success: true,
      message: "Unique postOwner and brandName list retrieved successfully.",
      data: result[0].uniqueNames
    });
  } catch (err) {
    // console.error("Error processing data:", err);

    return res.status(500).json({
      success: false,
      message: "An error occurred while processing the data.",
      data: [],
      error: err.message
    });
  }
};

const getUserInteractionData = async (req, res) => {
  try {
    const { userid } = req.params;
   const user = await User.findOne({ user_id:userid })
   return res.status(200).json(user)
    
  } catch (error) {
    return res.status(400).json({
      message : "User ID not valid"
    })
  }
}

const getUserIds = async (req, res) => {
  try {
    const users = await User.find({}, "user_id user_name");
    return res.status(200).json(users);
  } catch (error) {
    // console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

setInterval(processQueue, PROCESS_INTERVAL);


module.exports = {updateUserInteraction, getUniquePostOwnersAndBrands,getUserInteractionData,getUserIds};