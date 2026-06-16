const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const axios = require("axios");
require("dotenv").config();

const UPLOAD_TO_S3 = process.env.UPLOAD_TO_S3 === "true";

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Delete an object by key from S3 (or NAS, mirroring the upload path).
// Best-effort: swallows errors so a missing/already-deleted object never
// blocks the caller. Same behaviour as the helper in brandNamesList.
const deleteFromS3 = async (key) => {
  if (!key) return;
  try {
    if (UPLOAD_TO_S3) {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: key,
        }),
      );
    } else {
      await axios.delete(`${process.env.NEW_NAS_UPLOAD_URL}/delete/${key}`);
    }
  } catch (err) {
    console.error(`Failed to delete object ${key}:`, err.message);
  }
};

exports.s3Client = s3Client;
exports.deleteFromS3 = deleteFromS3;
