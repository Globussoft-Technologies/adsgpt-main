const sharp = require("sharp");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Function to download image
const downloadImage = async (imageUrl, outputPath) => {
  try {
    const response = await axios({
      url: imageUrl,
      responseType: "arraybuffer",
    });

    fs.writeFileSync(outputPath, response.data);
    return outputPath;
  } catch (error) {
    console.error("Error downloading image:", error);
  }
};

// Function to compress image
const compressImage = async (inputPath, outputPath, quality = 70) => {
  try {
    await sharp(inputPath)
      .resize({ width: 800 }) // Resize (optional)
      .jpeg({ quality }) // Compress JPEG quality (1-100)
      .toFile(outputPath);

  } catch (error) {
    console.error("Error compressing image:", error);
  }
};
