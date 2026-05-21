const Category = require("../Module/adFactory/adFactoryCategory")

exports.getCategories = async (req, res) => {
  try {
    const categories = await Category.find(
      {},
      { _id: 0, category: 1, subcategories: 1 }
    )
      .sort({ category: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: categories.length,
      data: categories
    });
  } catch (error) {
    console.error("Get Categories Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
      error: error.message
    });
  }
};