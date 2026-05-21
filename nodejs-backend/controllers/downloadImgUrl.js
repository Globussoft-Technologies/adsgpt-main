const http = require("http");
const https = require("https");
const { URL } = require("url");
const { fileTypeFromBuffer } = require("file-type");
const axios = require("axios");
const { PassThrough } = require("stream")
const { pipeline } = require("stream/promises")


const downloadImgUrl = (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl || !isValidHttpUrl(imageUrl)) {
        return res.status(400).json({ error: "Invalid URL" });
    }

    fetchImage(imageUrl, res, 0);
};
const fetchImage = (url, res, redirectCount) => {
    if (redirectCount > 5) {
        return res.status(500).json({ error: "Too many redirects" });
    }

    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === "https:" ? https : http;

    const options = {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
        }
    };

    protocol.get(url, options, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            const redirectUrl = response.headers.location.startsWith('http')
                ? response.headers.location
                : `${parsedUrl.protocol}//${parsedUrl.host}${response.headers.location}`;
            return fetchImage(redirectUrl, res, redirectCount + 1);
        }

        if (response.statusCode !== 200) {
            return res.status(500).json({ error: "Failed to fetch image", statusCode: response.statusCode });
        }

        res.setHeader("Content-Type", response.headers["content-type"] || "image/jpeg");
        response.pipe(res); // 🚀 Stream directly to response
    }).on("error", (err) => {
        res.status(500).json({ error: "Error fetching image", details: err.message });
    });
};

function isValidHttpUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

const convertUrl = async (req, res) => {
    try {
        const imageUrl = req.query.url;

        if (!imageUrl)
            return res.status(400).send("Image URL required");

        if (!/^https?:\/\//i.test(imageUrl))
            return res.status(400).send("Invalid URL");

        //  SINGLE FETCH STREAM
        const response = await axios.get(imageUrl, {
            responseType: "stream",
            timeout: 15000,
            maxRedirects: 5,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                Accept: "image/*,*/*;q=0.8",
            },
        });

        const pass = new PassThrough();

        const chunks = [];
        let total = 0;

        //  read only first few KB for mime detection
        response.data.on("data", chunk => {
            if (total < 4100) {
                chunks.push(chunk);
                total += chunk.length;
            }
        });

        // pipe immediately (no second request)
        response.data.pipe(pass);

        // wait small buffer accumulation
        await new Promise(resolve => setTimeout(resolve, 50));

        const headBuffer = Buffer.concat(chunks);

        const detected = await fileTypeFromBuffer(headBuffer);

        if (!detected || !detected.mime.startsWith("image/")) {
            return res.status(415).send("Not a valid image");
        }

        //  normalized headers
        res.setHeader("Content-Type", detected.mime);
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Cache-Control", "public, max-age=86400");

        await pipeline(pass, res);
    } catch (error) {
        console.error("convertUrl error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Image conversion failed",
        });
    }
};

module.exports = { downloadImgUrl, convertUrl };