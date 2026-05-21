const CHAT_SETTINGS = require("../Module/chatPage/settings");

// Create a new chat setting
exports.createSettings = async (req, res) => {
  try {
    const { user_id, type, ...rest } = req.body;

    // Validate mandatory fields
    if (!user_id || !type) {
      return res
        .status(400)
        .json({ message: "User ID and Type are required", success: false });
    }

    // Create new settings
    const newSetting = await CHAT_SETTINGS.create({ user_id, type, ...rest });
    return res.status(201).json({
      message: "Chat setting created successfully",
      success: true,
      data: newSetting,
    });
  } catch (error) {
    console.error("Error creating new settings:", error);
    return res.status(500).json({ message: error, success: false });
  }
};

// Get all chat settings for a user by user_id
exports.getAllSettings = async (req, res) => {
  try {
    const user_id = req?.params?.user_id;

    // Validate user_id
    if (!user_id) {
      return res
        .status(400)
        .json({ message: "User ID is required", success: false });
    }

    // Find settings
    const chatSettings = await CHAT_SETTINGS.find({ user_id });
    return res.status(200).json({
      message: "Chat settings fetched successfully",
      success: true,
      data: chatSettings,
    });
  } catch (error) {
    console.error("Error fetching settings:", error);
    return res.status(500).json({ message: error, success: false });
  }
};

// Get a single chat setting by document ID
exports.getSettings = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate document ID
    if (!id) {
      return res
        .status(400)
        .json({ message: "Document ID is required", success: false });
    }

    // Find the specific setting
    const chatSetting = await CHAT_SETTINGS.findById(id);
    if (!chatSetting) {
      return res
        .status(404)
        .json({ message: "Chat setting not found", success: false });
    }

    return res.status(200).json({
      message: "Chat setting fetched successfully",
      success: true,
      data: chatSetting,
    });
  } catch (error) {
    console.error("Error fetching settings:", error);
    return res.status(500).json({ message: error, success: false });
  }
};

// Update a chat setting by document ID
exports.updateSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Validate document ID
    if (!id) {
      return res
        .status(400)
        .json({ message: "Document ID is required", success: false });
    }

    // Validate updates
    if (!Object.keys(updates).length) {
      return res
        .status(400)
        .json({ message: "No updates provided", success: false });
    }

    // Update the setting
    const updatedSetting = await CHAT_SETTINGS.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!updatedSetting) {
      return res
        .status(404)
        .json({ message: "Chat setting not found", success: false });
    }

    return res.status(200).json({
      message: "Chat setting updated successfully",
      success: true,
      data: updatedSetting,
    });
  } catch (error) {
    console.error("Error updating settings:", error);
    return res.status(500).json({ message: error, success: false });
  }
};

// Delete a chat setting by document ID
exports.deleteSettings = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate document ID
    if (!id) {
      return res
        .status(400)
        .json({ message: "Document ID is required", success: false });
    }

    // Delete the setting
    const deletedSetting = await CHAT_SETTINGS.findByIdAndDelete(id);
    if (!deletedSetting) {
      return res
        .status(404)
        .json({ message: "Chat setting not found", success: false });
    }

    return res.status(200).json({
      message: "Chat setting deleted successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error deleting settings:", error);
    return res.status(500).json({ message: error, success: false });
  }
};
