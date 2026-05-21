const draft = require("../Module/draftData/Draft");
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


exports.getDraftDataCount = async (uid) => {
    try {
        const count = await draft.countDocuments({ uid: uid });

        if (count > 0) {
           return true;
        }
        else {
           return false
        }
     } catch (error) {
        return false
    }
}

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

// exports.getDraftData = async (req, res) => {
//     try {
//         let { category, limit, skip } = req.query;

//         if (category) {
//             if(!limit) limit = 10
//             if(!skip) skip = 0
//             const parsedLimit = parseInt(limit);
//             const parsedSkip = parseInt(skip);
          
//             if (isNaN(parsedLimit) || isNaN(parsedSkip) || parsedLimit < 0 || parsedSkip < 0) {
//                 return res.status(400).json({ code: 400, message: "Invalid limit or skip value" });
//             }

//             const result = await draft.aggregate([
//                 {
//                     $match: { uid: req.params.uid} 
//                 },
//                 {
//                   $project: {
//                     adsData: {
//                       $slice: [`$data.${category}`, parsedSkip, parsedLimit]
//                     }
//                   }
//                 }
//               ]);
//               return res.status(200).json({ code: 200, message: result });
//         } else {
//             const draftId = req.params.uid;
//             const existingUser = await draft.findOne({ uid: draftId });
//             if (existingUser) {
//                 return res.status(200).json({ code: 200, message: existingUser });
//             } else {
//                 return res.status(404).json({ code: 404, message: "Draft not found" });
//             }
//         }
//     } catch (error) {
//         console.error(error);
//         return res.status(500).json({ code: 500, message: "Internal Server Error" });
//     }
// };