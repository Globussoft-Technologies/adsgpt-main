

const appLogger = require('../utils/logger');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Initialize AWS S3 client
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Modular logger function
const logger = (testingMode, ...args) => {
  if (testingMode) appLogger.info(...args);
};

// Ensure directories exist
if (!fs.existsSync('./temp')) fs.mkdirSync('./temp');
if (!fs.existsSync('./renders')) fs.mkdirSync('./renders');

async function downloadFile(url, dest, testingMode) {
  if (!url || typeof url !== 'string' || url.trim() === '' || url.startsWith('data:')) {
    throw new Error(`Invalid or missing URL: ${url}`);
  }
  logger(testingMode, `Debugger - Downloading ${url} to ${dest}`);
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
    });
    response.data.pipe(fs.createWriteStream(dest));
    return new Promise((resolve, reject) => {
      response.data.on('end', () => {
        logger(testingMode, `Debugger - Download complete: ${dest}`);
        resolve(dest);
      });
      response.data.on('error', (err) => {
        logger(testingMode, `Debugger - Download error for ${url}: ${err.message}`);
        reject(err);
      });
    });
  } catch (err) {
    logger(testingMode, `Debugger - Axios error for ${url}: ${err.message}`);
    throw err;
  }
}

function addLineBreaks(text, maxWidth, fontSize, fontFamily) {
  const words = text.split(' ');
  let currentLine = '';
  let result = '';
  
  const avgCharWidth = fontSize * 0.6;
  const spaceWidth = fontSize * 0.3;
  
  words.forEach((word, index) => {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    const testWidth = testLine.length * avgCharWidth;
    
    if (testWidth > maxWidth && currentLine) {
      result += currentLine + '\n';
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  });
  
  if (currentLine) {
    result += currentLine;
  }
  
  return result;
}

async function uploadToS3(filePath, renderId, testingMode) {
  const fileContent = fs.readFileSync(filePath);
  const s3Key = `renders/${renderId}.mp4`;
  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: s3Key,
    Body: fileContent,
    ContentType: 'video/mp4',
  };
  try {
    await s3.send(new PutObjectCommand(params));
    logger(testingMode, `Debugger - Uploaded to S3: ${s3Key}`);
    return `s3://${process.env.AWS_S3_BUCKET_NAME}/${s3Key}`;
  } catch (err) {
    logger(testingMode, `Debugger - S3 upload error: ${err.message}`);
    throw err;
  }
}

async function hasAudioStream(filePath) {
  try {
    const { stdout } = await execPromise(`ffprobe -i "${filePath}" -show_streams -select_streams a -loglevel error`);
    return stdout.includes('Stream #');
  } catch {
    return false;
  }
}

async function videoRender(req, res) {
  const payload = req.body;
  const testingMode = payload.testingMode !== undefined ? payload.testingMode : false; // Default to true
  logger(testingMode, 'Debugger - Received payload:', JSON.stringify(req.body, null, 2));
  const renderId = uuid();
  const outPath = `./renders/${renderId}.mp4`;
  const localPaths = {};

  try {
    // Validate payload
    if (!payload.trackItemIds || !Array.isArray(payload.trackItemIds)) throw new Error('trackItemIds is missing or not an array');
    if (!payload.trackItemDetailsMap) throw new Error('trackItemDetailsMap is missing');
    if (!payload.size || !payload.size.width || !payload.size.height) throw new Error('size is missing or invalid');
    if (!payload.canvas || !payload.canvas.width || !payload.canvas.height) throw new Error('canvas size is missing or invalid');

    const widthScale = payload.size.width / payload.canvas.width;
    const heightScale = payload.size.height / payload.canvas.height;
    logger(testingMode, `Debugger - Scaling factors: widthScale=${widthScale}, heightScale=${heightScale}`);

    // Validate src and group resources
    const resourceToItems = {};
    const localPaths = {};
    const resourceToPath = {};
    for (const id of payload.trackItemIds) {
      const item = payload.trackItemsMap[id];
      const details = payload.trackItemDetailsMap[id]?.details;
      if (item.type !== 'text' && item.type !== 'audio') {
        const src = details?.src || item.metadata?.resourceId;
        if (!src || src.startsWith('data:')) throw new Error(`Invalid or missing src for track item ID: ${id}`);
        if (details && (details.computedLeft === undefined || details.computedTop === undefined)) {
          throw new Error(`Missing computedLeft or computedTop for track item ID: ${id}`);
        }
        const resourceId = item.metadata?.resourceId || details?.src;
        resourceToItems[resourceId] = resourceToItems[resourceId] || [];
        resourceToItems[resourceId].push(id);
      } else if (item.type === 'audio') {
        const audioKey = Object.keys(payload.audio || {}).find(key => !payload.audio[key].src.startsWith('data:'));
        const src = audioKey ? payload.audio[audioKey].src : null;
        if (!src) throw new Error(`Invalid or missing src for audio track item ID: ${id}`);
      }
    }

    // Download media files
    for (const resourceId of Object.keys(resourceToItems)) {
      const ext = resourceId.includes('.jpg') || resourceId.includes('.png') ? '.jpg' : '.mp4';
      const tempPath = `./temp/${uuid()}${ext}`;
      await downloadFile(resourceId, tempPath);
      resourceToPath[resourceId] = tempPath;
      resourceToItems[resourceId].forEach(id => localPaths[id] = tempPath);
    }

    // Download audio
    const audioTrack = payload.trackItemIds.find(id => payload.trackItemsMap[id].type === 'audio');
    if (audioTrack) {
      const audioKey = Object.keys(payload.audio || {}).find(key => !payload.audio[key].src.startsWith('data:'));
      const src = audioKey ? payload.audio[audioKey].src : null;
      if (src) {
        const tempPath = `./temp/${uuid()}.mp3`;
        await downloadFile(src, tempPath);
        localPaths[audioTrack] = tempPath;
      }
    }

    // Calculate max duration
    let maxDuration = 0;
    payload.trackItemIds.forEach(id => {
      const displayTo = payload.trackItemsMap[id].display.to / 1000;
      maxDuration = Math.max(maxDuration, displayTo);
    });
    logger(testingMode, `Debugger - Max duration: ${maxDuration}s`);

    // Build FFmpeg command
    const ffmpegCmd = ffmpeg();
    const itemToInput = {};
    let inputIndex = 0;

    // Add inputs and check for audio
    const inputHasAudio = {};
    for (const resourceId of Object.keys(resourceToPath)) {
      const filePath = resourceToPath[resourceId];
      ffmpegCmd.input(filePath);
      inputHasAudio[inputIndex] = await hasAudioStream(filePath);
      logger(testingMode, `Debugger - Input ${inputIndex} (${filePath}) has audio: ${inputHasAudio[inputIndex]}`);
      resourceToItems[resourceId].forEach(id => itemToInput[id] = inputIndex);
      inputIndex++;
    }
    if (localPaths[audioTrack]) {
      ffmpegCmd.input(localPaths[audioTrack]);
      itemToInput[audioTrack] = inputIndex++;
      inputHasAudio[itemToInput[audioTrack]] = true; // Audio files always have audio
    }

    // Complex filters
    const complexFilters = [{
      filter: 'color',
      options: { c: 'black', s: `${payload.size.width}x${payload.size.height}`, r: payload.fps || 30, d: maxDuration },
      outputs: 'base',
    }];

    let currentVideoOut = 'base';
    const audioStreams = [];
    let filterId = 0;

    for (const id of payload.trackItemIds) {
      filterId++;
      const item = payload.trackItemsMap[id];
      const details = payload.trackItemDetailsMap[id]?.details;
      const displayFrom = item.display.from / 1000;
      const displayTo = item.display.to / 1000;
      const trimFrom = item.trim?.from / 1000 || 0;

      let currentV, currentA;
      if (item.type !== 'text' && localPaths[id]) {
        const inputIndex = itemToInput[id];
        currentV = item.type !== 'audio' ? `${inputIndex}:v` : null;
        currentA = (item.type === 'audio' || (item.type === 'video' && inputHasAudio[inputIndex])) ? `${inputIndex}:a` : null;
      }

      // Handle text rendering
      if (item.type === 'text') {
        const textDetails = details;
        const textData = payload.textContent[id];
        
        let textContent = textData.content;
        
        // If frontend detected line breaks but text doesn't have \n, add them
        if (textData.hasLineBreaks && !textContent.includes('\n')) {
          textContent = addLineBreaks(textContent, textData.elementWidth, textData.fontSize, textData.fontFamily);
        }
        
        const fontFile = textDetails.fontUrl ? `./temp/font_${uuid()}.ttf` : null;
        if (fontFile) {
          await downloadFile(textDetails.fontUrl, fontFile);
        }

        const fontSize = textDetails.fontSize;
        const fontColor = textDetails.color.replace('#', '');
        
        const absoluteLeft = parseFloat(textDetails.left || "0");
        const absoluteTop = parseFloat(textDetails.top || "0");
        
        let xPos = absoluteLeft;
        const yPos = absoluteTop;
        
        const textFilterOptions = {
          fontfile: fontFile || textDetails.fontFamily,
          text: textContent,
          fontcolor: fontColor,
          fontsize: fontSize,
          x: xPos,
          y: yPos,
          enable: `between(t,${displayFrom},${displayTo})`,
          box: 0,
        };

        // FIX: Adjust positioning to compensate for FFmpeg's text_align padding
        if (textDetails.textAlign === 'center' || textData.textAlign === 'center') {
          // For center alignment, adjust x position to account for FFmpeg's padding
          textFilterOptions.text_align = 'center';
          // No need to change xPos since text_align='center' handles the centering
        } else if (textDetails.textAlign === 'right' || textData.textAlign === 'right') {
          // For right alignment, adjust x position
          textFilterOptions.text_align = 'right';
          // Move slightly left to compensate for FFmpeg's right alignment padding
          xPos = absoluteLeft - (fontSize * 0.01); // Adjust this value as needed
          textFilterOptions.x = xPos;
        } else {
          // For left alignment, move slightly right to match frontend spacing
          xPos = absoluteLeft + (fontSize * 0.01); // Adjust this value as needed
          textFilterOptions.x = xPos;
        }

        // Reduce line spacing to match frontend more closely
        if (textContent.includes('\n')) {
          textFilterOptions.line_spacing = fontSize * 0.01; // Reduced from 0.2 to 0.1
        }

        if (textDetails.WebkitTextStrokeWidth !== '0px') {
          const strokeWidth = parseFloat(textDetails.WebkitTextStrokeWidth);
          const strokeColor = textDetails.WebkitTextStrokeColor.replace('#', '');
          textFilterOptions.borderw = strokeWidth;
          textFilterOptions.bordercolor = strokeColor;
        }

        logger(testingMode, `Debugger - Text rendering: 
          Content: "${textContent.replace(/\n/g, '\\n')}"
          Original position: left=${absoluteLeft}, top=${absoluteTop}
          Adjusted position: x=${xPos}, y=${yPos}
          Alignment: ${textDetails.textAlign || textData.textAlign}
          Text align option: ${textFilterOptions.text_align || 'left'}
          Font size: ${fontSize}`);

        complexFilters.push({
          filter: 'drawtext',
          options: textFilterOptions,
          inputs: currentVideoOut,
          outputs: `text_${filterId}`,
        });
        currentVideoOut = `text_${filterId}`;
        continue;
      }

      // Handle image rendering
      if (item.type === 'image') {
        const left = details.computedLeft * widthScale;
        const top = details.computedTop * heightScale;
        const boxW = details.computedWidth * widthScale;
        const boxH = details.computedHeight * heightScale;

        complexFilters.push({
          filter: 'scale',
          options: `${Math.max(boxW, 1)}:${Math.max(boxH, 1)}:force_original_aspect_ratio=decrease`,
          inputs: currentV,
          outputs: `fill_${filterId}`,
        });
        currentV = `fill_${filterId}`;

        const opacity = details.opacity || 100;
        if (opacity < 100) {
          complexFilters.push({
            filter: 'format',
            options: 'yuva420p',
            inputs: currentV,
            outputs: `fmt_${filterId}`,
          });
          complexFilters.push({
            filter: 'colorchannelmixer',
            options: `aa=${opacity / 100}`,
            inputs: `fmt_${filterId}`,
            outputs: `op_${filterId}`,
          });
          currentV = `op_${filterId}`;
        }

        complexFilters.push({
          filter: 'overlay',
          options: { x: left, y: top, enable: `between(t,${displayFrom},${displayTo})` },
          inputs: [currentVideoOut, currentV],
          outputs: `ovl_${filterId}`,
        });
        currentVideoOut = `ovl_${filterId}`;
        continue;
      }

      // Handle video rendering
      if (item.type === 'video') {
        if (!details) {
          logger(testingMode, `Debugger - Using default rendering for ${id} due to missing details`);
          complexFilters.push({
            filter: 'scale',
            options: `${payload.size.width}:${payload.size.height}:force_original_aspect_ratio=decrease`,
            inputs: currentV,
            outputs: `fill_${filterId}`,
          });
          complexFilters.push({
            filter: 'setpts',
            options: `PTS-STARTPTS+${trimFrom}/TB`,
            inputs: `fill_${filterId}`,
            outputs: `trim_${filterId}`,
          });
          complexFilters.push({
            filter: 'overlay',
            options: { x: 0, y: 0, enable: `between(t,${displayFrom},${displayTo})` },
            inputs: [currentVideoOut, `trim_${filterId}`],
            outputs: `ovl_${filterId}`,
          });
          currentVideoOut = `ovl_${filterId}`;
        } else {
          const left = details.computedLeft * widthScale;
          const top = details.computedTop * heightScale;
          const boxW = details.computedWidth * widthScale;
          const boxH = details.computedHeight * heightScale;

          let angle = 0;
          if (details.details?.transform?.includes('rotate(')) {
            const rotateMatch = details.details.transform.slice(0, 200).match(/rotate\(([^()]{1,50})\)/);
            if (rotateMatch) angle = parseFloat(rotateMatch[1].replace('deg', ''));
          } else if (details.transform?.includes('rotate(')) {
            const rotateMatch = details.transform.slice(0, 200).match(/rotate\(([^()]{1,50})\)/);
            if (rotateMatch) angle = parseFloat(rotateMatch[1].replace('deg', ''));
          } else if (details.transformMatrix?.startsWith('matrix(')) {
            const matrix = details.transformMatrix.slice(7, -1).split(',').map(Number);
            if (matrix.length === 6) {
              const a = matrix[0], b = matrix[1];
              const angleRad = Math.atan2(b, a);
              angle = angleRad * 180 / Math.PI;
              const determinant = a * matrix[3] - b * matrix[2];
              if (determinant < 0) angle = -angle;
            }
          }
          logger(testingMode, `Debugger - Item ${id}: final rotation angle: ${angle}deg`);

          complexFilters.push({
            filter: 'setpts',
            options: `PTS-STARTPTS+${trimFrom}/TB`,
            inputs: currentV,
            outputs: `trim_${filterId}`,
          });
          currentV = `trim_${filterId}`;

          if (angle !== 0) {
            complexFilters.push({
              filter: 'format',
              options: 'yuva420p',
              inputs: currentV,
              outputs: `alpha_${filterId}`,
            });
            currentV = `alpha_${filterId}`;
            complexFilters.push({
              filter: 'scale',
              options: `${details.width}:${details.height}:force_original_aspect_ratio=decrease`,
              inputs: currentV,
              outputs: `prescale_${filterId}`,
            });
            currentV = `prescale_${filterId}`;
            const rad = (angle * Math.PI / 180).toString();
            complexFilters.push({
              filter: 'rotate',
              options: `${rad}:fillcolor=0x00000000:ow=rotw(${rad}):oh=roth(${rad})`,
              inputs: currentV,
              outputs: `rot_${filterId}`,
            });
            currentV = `rot_${filterId}`;
            complexFilters.push({
              filter: 'scale',
              options: `${Math.max(boxW, 1)}:${Math.max(boxH, 1)}:force_original_aspect_ratio=disable`,
              inputs: currentV,
              outputs: `fill_${filterId}`,
            });
            currentV = `fill_${filterId}`;
          } else {
            complexFilters.push({
              filter: 'scale',
              options: `${Math.max(boxW, 1)}:${Math.max(boxH, 1)}:force_original_aspect_ratio=decrease`,
              inputs: currentV,
              outputs: `fill_${filterId}`,
            });
            currentV = `fill_${filterId}`;
          }

          const opacity = details.opacity || 100;
          if (opacity < 100) {
            complexFilters.push({
              filter: 'format',
              options: 'yuva420p',
              inputs: currentV,
              outputs: `fmt_${filterId}`,
            });
            complexFilters.push({
              filter: 'colorchannelmixer',
              options: `aa=${opacity / 100}`,
              inputs: `fmt_${filterId}`,
              outputs: `op_${filterId}`,
            });
            currentV = `op_${filterId}`;
          }

          complexFilters.push({
            filter: 'overlay',
            options: { x: left, y: top, enable: `between(t,${displayFrom},${displayTo})` },
            inputs: [currentVideoOut, currentV],
            outputs: `ovl_${filterId}`,
          });
          currentVideoOut = `ovl_${filterId}`;
        }

        // Handle audio for video tracks
        if (item.type === 'video' && details?.volume !== 0 && currentA) {
          const vol = (details?.volume || 100) / 100;
          complexFilters.push({
            filter: 'volume',
            options: vol,
            inputs: currentA,
            outputs: `vol_${filterId}`,
          });
          currentA = `vol_${filterId}`;
          if (item.playbackRate !== 1) {
            complexFilters.push({
              filter: 'atempo',
              options: item.playbackRate,
              inputs: currentA,
              outputs: `tempo_${filterId}`,
            });
            currentA = `tempo_${filterId}`;
          }
          const delay = Math.round(displayFrom * 1000);
          complexFilters.push({
            filter: 'adelay',
            options: `${delay}|${delay}`,
            inputs: currentA,
            outputs: `audio_${filterId}`,
          });
          audioStreams.push(`audio_${filterId}`);
        }
      }

      // Handle audio tracks
      if (item.type === 'audio' && currentA) {
        const vol = 1;
        complexFilters.push({
          filter: 'volume',
          options: vol,
          inputs: currentA,
          outputs: `vol_${filterId}`,
        });
        currentA = `vol_${filterId}`;
        if (item.playbackRate !== 1) {
          complexFilters.push({
            filter: 'atempo',
            options: item.playbackRate,
            inputs: currentA,
            outputs: `tempo_${filterId}`,
          });
          currentA = `tempo_${filterId}`;
        }
        const delay = Math.round(displayFrom * 1000);
        complexFilters.push({
          filter: 'adelay',
          options: `${delay}|${delay}`,
          inputs: currentA,
          outputs: `audio_${filterId}`,
        });
        audioStreams.push(`audio_${filterId}`);
      }
    }

    // Handle audio output
    if (audioStreams.length > 0) {
      complexFilters.push({
        filter: 'amix',
        options: { inputs: audioStreams.length, duration: 'longest' },
        inputs: audioStreams,
        outputs: 'audio_out',
      });
    }

    logger(testingMode, `Debugger - Final filtergraph: ${JSON.stringify(complexFilters, null, 2)}`);
    ffmpegCmd.complexFilter(complexFilters);
    ffmpegCmd.outputOptions('-map', `[${currentVideoOut}]`);
    ffmpegCmd.outputOptions(audioStreams.length > 0 ? '-map [audio_out]' : '-an');
    ffmpegCmd.outputOptions('-t', maxDuration);
    ffmpegCmd.videoCodec('libx264').audioCodec('aac').output(outPath);

    ffmpegCmd.on('start', commandLine => {
      logger(testingMode, `Debugger - FFmpeg command: ${commandLine}`);
    });

    ffmpegCmd.on('end', async () => {
      logger(testingMode, `Debugger - Render complete: ${outPath}`);
      let response;
      if (!testingMode) {
        // Upload to S3 and return S3 path
        const s3Path = await uploadToS3(outPath, renderId, testingMode);
        response = { url: s3Path };
      } else {
        // Return local path in testing mode
        response = { url: `/renders/${renderId}.mp4` };
      }
      Object.values(localPaths).forEach(p => {
        try { fs.unlinkSync(p); } catch {}
      });
      res.json({ url: `/renders/${renderId}.mp4` });
    });

    ffmpegCmd.on('error', async err => {
      appLogger.error(`Debugger - Render error: ${err.message}`);
      Object.values(localPaths).forEach(p => {
        try { fs.unlinkSync(p); } catch {}
      });
      res.status(500).json({ error: 'Rendering failed: ' + err.message });
    });

    ffmpegCmd.run();
  } catch (err) {
    appLogger.error(`Debugger - Render error: ${err.message}`);
    Object.values(localPaths).forEach(p => {
      try { fs.unlinkSync(p); } catch {}
    });
    res.status(500).json({ error: err.message });
  }
}

module.exports = { videoRender };