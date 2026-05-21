    const { redisGetSet } = require('../adCreative');
    const { v4: uuidv4 } = require("uuid");

        const CHAT_COUNTERS = [
            'ChatCountAdsCopy',
            'ChatCountAdsCreative',
            'ChatCountDashboard',
            'ChatCountAdsVideo'
        ];



    const initChatCounters = async (uid, subscriptionTypeKey, subscriptionTypeValue) => {
            const results = {};
            const now = new Date();
            const expiryDate = new Date(subscriptionTypeValue);
            expiryDate.setHours(23, 59, 59, 999); // End of day

            const secondsUntilExpiry = Math.floor((expiryDate - now) / 1000);
            const maxSeconds = 60 * 60 * 24 * 30; // 30 days max

            for (const counterKey of CHAT_COUNTERS) {
                try {
                    const redisKey = `${counterKey}:GPT-${uid}-${subscriptionTypeKey}`;

                    // Set counter to 0 if it doesn't exist
                    const initialized = await new Promise((resolve, reject) => {
                        redisGetSet.setnx(redisKey, 0, (err, result) => {
                            if (err) reject(err);
                            else resolve(result === 1);
                        });
                    });

                    if (!initialized) {
                        results[counterKey] = "already_exists";
                        continue;
                    }

                    // Set expiry
                    const expiryArgs = secondsUntilExpiry > maxSeconds
                        ? ['expire', redisKey, maxSeconds]
                        : ['expireat', redisKey, Math.floor(expiryDate.getTime() / 1000)];

                    await new Promise((resolve, reject) => {
                        redisGetSet[expiryArgs[0]](...expiryArgs.slice(1), (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });

                    results[counterKey] = "initialized";
                } catch (error) {
                    console.error(`Error initializing ${counterKey}:`, error);
                    results[counterKey] = "error";
                }
            }

            return { success: true, results };
        };

    const initCount = async (req, res) => {
            try {
                const { uid, plan, expiryDate } = req.body;

                if (!uid || !plan || !expiryDate) {
                    return res.status(400).json({
                        success: false,
                        message: "Missing required fields: uid, subscriptionTypeKey, subscriptionTypeValue"
                    });
                }

                const { success, results } = await initChatCounters(
                    uid,
                    plan,
                    expiryDate
                );

                res.json({ success, message: "Counters initialized", results });
            } catch (error) {
                console.error("API Error:", error);
                res.status(500).json({
                    success: false,
                    message: "Internal server error"
                });
            }
        };

        // Video Save 
    const saveVideo = async (req, res) => {
            const { videoUrl } = req.body;
            if (!videoUrl) {
              return res.status(400).json({ success: false, message: "videoUrl is required" });
            }
          
            try {
              const key = `video:${uuidv4()}`; // Unique key
              const ttl = 60 * 60 * 24; // 1 day in seconds
          
              await new Promise((resolve, reject) => {
                redisGetSet.setex(key, ttl, videoUrl, (err, reply) => {
                  if (err) return reject(err);
                  resolve(reply);
                });
              });
          
              return res.json({ success: true, key });
            } catch (error) {
              console.error("Error saving video:", error);
              return res.status(500).json({ success: false, message: "Internal Server Error" });
            }
          };
          
          // Get video URL from Redis using key
    const getVideo = async (req, res) => {
            const { key } = req.params;
            if (!key) {
              return res.status(400).json({ success: false, message: "Key is required" });
            }
          
            try {
              const videoUrl = await new Promise((resolve, reject) => {
                redisGetSet.get(key, (err, reply) => {
                  if (err) return reject(err);
                  resolve(reply);
                });
              });
          
              if (!videoUrl) {
                return res.status(404).json({ success: false, message: "Video not found or expired" });
              }
          
              return res.json({ success: true, videoUrl });
            } catch (error) {
              console.error("Error retrieving video:", error);
              return res.status(500).json({ success: false, message: "Internal Server Error" });
            }
          };


        module.exports = {
            initCount, saveVideo, getVideo,initCount
        };

