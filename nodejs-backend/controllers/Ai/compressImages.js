const sharp = require("sharp");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const os = require("os");

const downloadImage = async (imageUrl, outputPath) => {
  try {
    if (!imageUrl || typeof imageUrl !== "string") {
      throw new Error("Invalid or missing image URL");
    }
    const cleanUrl = imageUrl.trim();
    const parsedUrl = new URL(cleanUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Only HTTP and HTTPS protocols are allowed");
    }
    if (!outputPath || typeof outputPath !== "string") {
      throw new Error("Invalid output path");
    }

    const safePath = path.resolve(outputPath);
    const allowedBaseDir = path.resolve(process.cwd());
    const tmpDir = path.resolve(os.tmpdir());
    if (!safePath.startsWith(allowedBaseDir) && !safePath.startsWith(tmpDir)) {
      throw new Error("Destination path is outside allowed directory");
    }

    const response = await axios({
      url: cleanUrl,
      responseType: "arraybuffer",
      timeout: 15000,
      maxContentLength: 20 * 1024 * 1024,
    });

    fs.writeFileSync(safePath, Buffer.from(response.data));
    return safePath;
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
