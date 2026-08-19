const AdCreativeImages = require("../Module/adCreative/adCreativeImages");
const History = require("../Module/newHistory/newHistory")

// get api connected with module adCreativeIMG 

const getGalleryImages = async (req, res) => {
  try {
    const { user_id, skip = 0, limit = 10 } = req.query;

    if (!user_id) {
      return res.status(400).json({ message: "user id is required" })
    }

    const query = user_id ? { user_id } : {}; // Filter if userid gieven

    //convert skip , limit to no.
    const skipCount = parseInt(skip);
    const limitCount = parseInt(limit);

    // Fetch total count 
    const totalCount = await AdCreativeImages.countDocuments(query);

    // Fetch paginated documents
    const images = await AdCreativeImages.find(query)
      .skip(skipCount)
      .limit(limitCount)
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      total: totalCount,     // total no. of doc
      skip: skipCount,        // how many skipped
      limit: limitCount,      // lmt per page
      count: images.length,   // current kitna returned doc h
      data: images,     
      // ad: {
      //   data: images
      // }
    });
  } catch (err) {
    console.error("Error fetching gallery:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching gallery images",
    });
  }
};

const deepSearch = (obj, regex) => {
  for (const key in obj) {
    const val = obj[key];
    if (typeof val === "string" && regex.test(val)) return true;
    if (typeof val === "object" && val !== null && deepSearch(val, regex)) return true;
  }
  return false;
};

const getChatForImage = async (req, res) => {
  try {
    const { userId, imageUrl } = req.body;
    if (!userId || !imageUrl) {
      return res.status(400).json({
        success: false,
        message: "Both userId and imageUrl are required",
      });
    }

    const allDocs = await History.find({ userId, type: "adCreative" });
    if (!allDocs.length) {
      return res.status(404).json({
        success: false,
        message: "No chats found for this user",
      });
    }

    const escapeRegExp = (str) => String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escapeRegExp(imageUrl), "i");

    const matchedDocs = allDocs.filter((doc) => deepSearch(doc.toObject(), regex));

    if (!matchedDocs.length) {
      return res.status(404).json({
        success: false,
        message: "No matching chat found for this image",
      });
    }

    const sessionIds = matchedDocs.map(d => d.sessionId)

    return res.status(200).json({
      success: true,
      count: matchedDocs.length,
      data: sessionIds,
    });
  } catch (error) {
    console.error("Error searching chat:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while searching chat",
    });
  }
};

module.exports = {
  getGalleryImages,
  getChatForImage,
};
