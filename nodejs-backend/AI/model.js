const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config(); // Load environment variables
const { GoogleAIFileManager } = require("@google/generative-ai/server");

const API_KEYS = (process.env.GEMINI_API_KEYS || "")
  .split(",")
  .map(key => key.trim())
  .filter(Boolean);

if (API_KEYS.length === 0) {
  console.error("❌ No valid GEMINI API keys found in .env!");
  process.exit(1);
}

// Round-robin iterator for API keys
let apiKeyIndex = 0;
const getNextApiKey = () => {
  const apiKey = API_KEYS[apiKeyIndex];
  apiKeyIndex = (apiKeyIndex + 1) % API_KEYS.length; // Loop back when reaching the end
  return apiKey;
};
// Function to download an image from a URL
const downloadImage = async (imageUrl, savePath) => {
  try {
    const response = await axios({
      url: imageUrl,
      responseType: "stream",
    });

    const writer = fs.createWriteStream(savePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  } catch (error) {
    console.error("❌ Error downloading image:", error.message);
    throw error;
  }
};


// Function to get Gemini Model for text-only
const getGeminiTextModel = () => {
  const GEMINI_API_KEY = getNextApiKey();
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set in environment variables.");
  }
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  return genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
};

// Function to get Gemini Model that supports both images & text
const getGeminiVisionModel = () => {
  const GEMINI_API_KEY = getNextApiKey();
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set in environment variables.");
  }
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  return genAI.getGenerativeModel({ model: "gemini-pro-vision" });
};


const analyzeImageFromURL = async (imageUrl) => {
  try {
    const API_KEY = getNextApiKey();
    const fileManager = new GoogleAIFileManager(API_KEY);
    
    // Define temp file path
    const tempImagePath = path.join(__dirname, "temp.jpg");
    
    // Download image
    await downloadImage(imageUrl, tempImagePath);

    // Upload image to Google AI
    const uploadResult = await fileManager.uploadFile(tempImagePath, {
      mimeType: "image/jpeg",
      displayName: "Uploaded Image",
    });


    // Polling to check if processing is complete
    let file = await fileManager.getFile(uploadResult.file.name);
    while (file.state === "PROCESSING") {
      process.stdout.write(".");
      await new Promise(resolve => setTimeout(resolve, 10_000)); // Wait for 10 seconds
      file = await fileManager.getFile(uploadResult.file.name);
    }

    if (file.state === "FAILED") {
      throw new Error("❌ Image processing failed.");
    }

    // Analyze the image using Gemini
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent([
      "Tell me about this image.",
      {
        fileData: {
          fileUri: uploadResult.file.uri,
          mimeType: uploadResult.file.mimeType,
        },
      },
    ]);

    // Delete the temporary file after processing
    fs.unlinkSync(tempImagePath);

  } catch (error) {
  }
};

// Example Usage



// -----analyzeImageFromURL-----
// const imageUrl = "https://example.com/sample.jpg"; // Replace with your image URL
// analyzeImageFromURL(imageUrl);

module.exports = { getGeminiTextModel, getGeminiVisionModel ,analyzeImageFromURL};
