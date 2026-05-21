const { redisGetSet } = require('./adCopy');
require('dotenv').config();

// Set the expiration time for cache (1 hour)
const CACHE_EXPIRATION = process.env.TOKEN_EXPIRY_TIME * 60;

// Helper function to create Redis key for drafts
const getDraftKey = (uid) => `draftAdCopy:${uid}`;

// Create or Update Draft
exports.createDraft = async (req, res) => {

   
    try {
        const draftData = req.body;
        draftData.updatedTime = new Date().toISOString();

        // Save or update draft in Redis
        await redisGetSet.setex(getDraftKey(draftData?.uid+draftData?.uniqueSessionId?? ""), CACHE_EXPIRATION, JSON.stringify(draftData));
        
        res.status(201).json({ code: 201, message: "Draft created/updated successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ code: 500, message: 'Failed to create or update draft' });
    }
};

// Get Draft Data
exports.getDraftData = async (req, res) => {
    
    try {
        const draftUID = req.params.uid;

        // Check Redis cache for data
        const cachedData = await redisGetSet.get(getDraftKey(draftUID));
        if (cachedData) {
            return res.status(200).json({ code: 200, message: JSON.parse(cachedData) });
        } else {
            res.status(404).json({ code: 404, message: "Draft not found" });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ code: 500, message: "Internal Server Error" });
    }
};

// Delete Draft
exports.deleteDraft = async (req, res) => {
     
    try {
        const uid = req.params.uid;

        // Delete draft from Redis
        const result = await redisGetSet.del(getDraftKey(uid));

        if (result) {
            res.status(200).json({ code: 200, message: "Draft deleted successfully" });
        } else {
            res.status(404).json({ code: 404, message: "Draft not found" });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ code: 500, message: 'Failed to delete draft' });
    }
};
