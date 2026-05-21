const { redisGetSet } = require('../controllers/adCopy');
const validate = require("../Module/draftData/draftValidation");
require('dotenv').config();
 
// Create or Update Draft
exports.createDraft = async (req, res) => {
    
    try {
        let draftData = req.body;
       
         draftData.updatedTime = new Date().toISOString();
         const draftKey = `draft:${draftData.uid+(draftData?.uniqsessionId??"")}`;
        const existingDraft = await redisGetSet.get(draftKey);

        // Use KEEPTTL option to keep the existing expiry if the draft already exists
        if (existingDraft) {
            await redisGetSet.set(draftKey, JSON.stringify(draftData), 'KEEPTTL');
            res.status(201).json({ code: 201, message: "Data updated successfully, expiration unchanged" });
        } else {
            // Set new draft data with a 60-minute expiration if it doesn't already exist
            await redisGetSet.set(draftKey, JSON.stringify(draftData), 'EX', process.env.TOKEN_EXPIRY_TIME * 60);
            res.status(201).json({ code: 201, message: "Data created successfully with One day expiration" });
        }
    } catch (error) {
        console.error("Error saving or updating draft data:", error);
        res.status(500).json({ code: 500, message: 'Failed to create or update data' });
    }
};
// Get Draft by UID
exports.getDraftData = async (req, res) => {
    
    try {
        const uid = req.params.uid;
        const draftKey = `draft:${uid}`;
        const draftData = await redisGetSet.get(draftKey);

        if (draftData) {
            res.status(200).json({ code: 200, message: JSON.parse(draftData) });
        } else {
            res.status(404).json({ code: 404, message: "Draft not found" });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ code: 500, message: "Internal Server Error" });
    }
};

// Check if Draft Exists by Count
exports.getDraftDataCount = async (uid) => {
    try {
        const draftKey = `draft:${uid}`;
        const exists = await redisGetSet.exists(draftKey);
        return exists > 0;
    } catch (error) {
        console.error(error);
        return false;
    }
};

// Delete Draft by UID
exports.deleteDraft = async (req, res) => {
   
    try {
        const uid = req.params.uid;
        const draftKey = `draft:${uid}`;
        const deletedCount = await redisGetSet.del(draftKey);

        if (deletedCount > 0) {
            res.status(200).json({ code: 200, message: "Draft deleted successfully" });
        } else {
            res.status(404).json({ code: 404, message: "Draft not found" });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ code: 500, message: 'Failed to delete draft' });
    }
};
