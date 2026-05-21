const draft = require("../Module/draftData/adCopyDraft");
const validate = require("../Module/draftData/draftValidation")


exports.createDraft = async (req, res) => {
        try {
        const draftData = req.body;
        draftData.updatedTime = new Date().toISOString();
        const existingUser = await draft.findOne({ uid: draftData.uid });
        if (existingUser) {
            await draft.updateOne({ uid: draftData.uid }, draftData);
            res.status(201).json({ code: 201, message: "Data updated successfully" });
        } else {
            const newDraft = new draft(draftData);
            await newDraft.save();
            res.status(201).json({ code: 201, message: "Data created successfully" });
        }
    } 
    
    catch (error) {
        console.error(error);
        res.status(500).json({ code: 500, message: 'Failed to create or update data' });
    }
};

exports.getDraftData = async (req, res) => {

    try {
        const draftData = req.params.uid;
        const existingUser = await draft.findOne({ uid: draftData });
        if (existingUser) {
            res.status(200).json({ code: 200, message: existingUser });
        } else {
            res.status(404).json({ code: 404, message: "Not Found!" });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ code: 500, message: "Internal Server Error" });
    }
};


exports.deleteDraft = async (req, res) => {
 
    try {
        const uid = req.params.uid;
        const deletedDraft = await draft.findOneAndDelete({ uid: uid });

        if (deletedDraft) {
            res.status(200).json({ code: 200, message: "Draft deleted successfully" });
        } else {
            res.status(404).json({ code: 404, message: "Draft not found" });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ code: 500, message: 'Failed to delete draft' });
    }
};