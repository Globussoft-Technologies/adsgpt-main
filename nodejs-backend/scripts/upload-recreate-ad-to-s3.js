#!/usr/bin/env node
/**
 * upload-recreate-ad-to-s3.js
 *
 * Uploads the Recreate Ad demo video (recreateAd.mp4) to AWS S3 under
 * `static/adVideo/recreateAd.mp4` for dev, staging, or prod environments.
 *
 * Credentials Resolution Order:
 *   1. Command-line flags (--access-key, --secret-key, --bucket, --region)
 *   2. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET_NAME)
 *   3. .env file in nodejs-backend/
 *
 * Usage:
 *   # Option 1: Run with current .env credentials
 *   node scripts/upload-recreate-ad-to-s3.js
 *
 *   # Option 2: Run with production env variables
 *   AWS_ACCESS_KEY_ID="xxx" AWS_SECRET_ACCESS_KEY="yyy" AWS_S3_BUCKET_NAME="media.adsgpt.io" node scripts/upload-recreate-ad-to-s3.js
 *
 *   # Option 3: Run with command-line flags
 *   node scripts/upload-recreate-ad-to-s3.js --bucket media.adsgpt.io --access-key xxx --secret-key yyy
 *
 * Options:
 *   --file <path>        Path to local MP4 (default: ../react-frontend/public/adcreative/recreateAd.mp4)
 *   --bucket <name>      Target S3 bucket (default: process.env.AWS_S3_BUCKET_NAME)
 *   --key <key>          Target S3 key (default: static/adVideo/recreateAd.mp4)
 *   --region <region>    AWS region (default: process.env.AWS_REGION || 'us-east-1')
 *   --access-key <key>   AWS Access Key ID
 *   --secret-key <key>   AWS Secret Access Key
 *   --cdn-base <url>     Public CDN base URL for verification (default: process.env.AWS_IMAGE_VIEW_URL)
 */

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
require("dotenv").config();

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    }
  }
  return options;
}

async function verifyPublicUrl(url) {
  return new Promise((resolve) => {
    https
      .get(url, (res) => {
        resolve({
          statusCode: res.statusCode,
          contentType: res.headers["content-type"],
          contentLength: res.headers["content-length"],
        });
      })
      .on("error", (err) => {
        resolve({ error: err.message });
      });
  });
}

async function main() {
  const opts = parseArgs();

  // 1. Resolve source video file
  const defaultFilePath = path.resolve(
    __dirname,
    "../../react-frontend/public/adcreative/recreateAd.mp4"
  );
  const resolvedFilePath = opts.file ? path.resolve(opts.file) : defaultFilePath;

  if (!fs.existsSync(resolvedFilePath)) {
    console.error(`\n[ERROR] Source video file not found at: ${resolvedFilePath}`);
    console.error(`Please provide the correct path using: --file <path/to/recreateAd.mp4>\n`);
    process.exit(1);
  }

  // 2. Resolve AWS config
  const accessKeyId = opts["access-key"] || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = opts["secret-key"] || process.env.AWS_SECRET_ACCESS_KEY;
  const region = opts.region || process.env.AWS_REGION || "us-east-1";
  const bucket = opts.bucket || process.env.AWS_S3_BUCKET_NAME || "content-dev.adsgpt.io";
  const key = opts.key || "static/adVideo/recreateAd.mp4";
  const cdnBase =
    opts["cdn-base"] ||
    process.env.AWS_IMAGE_VIEW_URL ||
    (bucket.includes("dev") ? "https://contents.adsgpt.io" : "https://media.adsgpt.io");

  if (!accessKeyId || !secretAccessKey) {
    console.error(`\n[ERROR] Missing AWS credentials!`);
    console.error(`Please provide credentials via:`);
    console.error(`  - .env file (AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)`);
    console.error(`  - Environment variables: AWS_ACCESS_KEY_ID="xxx" AWS_SECRET_ACCESS_KEY="yyy"`);
    console.error(`  - Flags: --access-key xxx --secret-key yyy\n`);
    process.exit(1);
  }

  const fileStats = fs.statSync(resolvedFilePath);
  const fileSizeMb = (fileStats.size / (1024 * 1024)).toFixed(2);

  console.log("====================================================");
  console.log("       ADS-GPT RECREATE AD S3 UPLOAD SCRIPT        ");
  console.log("====================================================");
  console.log(`Source File : ${resolvedFilePath} (${fileSizeMb} MB)`);
  console.log(`AWS Region  : ${region}`);
  console.log(`Target Bucket: ${bucket}`);
  console.log(`S3 Key      : ${key}`);
  console.log(`CDN Base    : ${cdnBase}`);
  console.log("====================================================\n");

  const s3Client = new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  try {
    console.log("Reading file buffer...");
    const fileStream = fs.readFileSync(resolvedFilePath);

    console.log(`Uploading to s3://${bucket}/${key}...`);
    const uploadCmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileStream,
      ContentType: "video/mp4",
    });

    const startTime = Date.now();
    const result = await s3Client.send(uploadCmd);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n Upload SUCCESSFUL in ${duration}s!`);
    console.log(`ETag        : ${result.ETag}`);

    const publicUrl = `${cdnBase.replace(/\/+$/, "")}/${key}`;
    console.log(`Public URL  : ${publicUrl}`);

    // Verify over public HTTPS
    console.log(`\nVerifying public availability over HTTPS...`);
    const verify = await verifyPublicUrl(publicUrl);
    if (verify.statusCode === 200) {
      console.log(` Verification SUCCESSFUL (HTTP 200 OK)`);
      console.log(`Content-Type  : ${verify.contentType}`);
      console.log(`Content-Length: ${verify.contentLength} bytes`);
    } else {
      console.warn(` Warning: HTTP status was ${verify.statusCode || verify.error}`);
      console.warn(`(If CloudFront/CDN propagation takes a moment, this may turn 200 shortly)`);
    }

    console.log("\n====================================================");
    console.log("Done! The Recreate Ad video is ready for production.");
    console.log("====================================================\n");
  } catch (error) {
    console.error(`\n[FATAL] S3 Upload failed:`, error.message);
    if (error.$metadata) {
      console.error(`HTTP Status : ${error.$metadata.httpStatusCode}`);
    }
    process.exit(1);
  }
}

main();
