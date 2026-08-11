const express = require("express");
const bodyParser = require("body-parser");
const http = require("node:http");
const fs = require("fs");
const session = require("express-session");
const { Server } = require("socket.io");
const { verifyTokenSocketMain } = require("./middlewares/authMiddleware"); //authentication
const mainRoute = require("./Router/MainRouter");
require("dotenv").config();
const initializeSockets = require("./sockets");
const swaggerUi = require("swagger-ui-express");
const { exec } = require("child_process");
const { runCronJobs } = require("./utils/cron");
const { SwaggerGatewayauth } = require("./controllers/auth/swaggerAuth");
const swaggerFilePath = "./resources/views/swagger-api-view.json";
const viewsDir = "./resources/views";
const resourcesDir = "./resources";
const path = require("path");
const mongoSanitize = require("express-mongo-sanitize");
const { apiLimiter, webhookLimiter } = require("./middlewares/rateLimitMiddleware");
const facebookAuthController = require("./controllers/adPosting/authController");
const googleAuthController = require("./controllers/adPosting/googleAuthController");
const tiktokAuthController = require("./controllers/adPosting/tiktokAuthController");
const { pub, sub } = require("./db/redis");
const connectMongoDB = require("./db/mongo");
const {
  parseAllowedOrigins,
  isOriginAllowed,
} = require("./utils/corsOrigins");

async function createServer() {
  const App = express();
  // Production traffic reaches this service through a reverse proxy, which
  // appends X-Forwarded-For. Trust only the configured number of proxy hops so
  // Express (and express-rate-limit) can resolve the real client IP without
  // blindly trusting arbitrary forwarded headers.
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || "1");
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 1) {
    throw new Error("TRUST_PROXY_HOPS must be a positive integer");
  }
  App.set("trust proxy", trustProxyHops);

  App.use(require("./middlewares/corsMiddleware"));
  const socketCorsOrigins = parseAllowedOrigins(
    process.env.CORS_ALLOWED_ORIGINS || process.env.FRONTEND_URL || "",
  );
  const server = http.createServer(App);
  const Socket = new Server(server, {
    cors: {
      origin(origin, callback) {
        const allowed =
          isOriginAllowed(origin, socketCorsOrigins) ||
          (socketCorsOrigins.length === 0 && process.env.NODE_ENV !== "production");
        callback(
          allowed ? null : new Error("Origin is not allowed by CORS"),
          allowed,
        );
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Make Socket.IO instance globally available
  global.io = Socket;

  try {
    // * 1. Generate swagger
    if (!fs.existsSync(resourcesDir)) {
      fs.mkdirSync(resourcesDir, { recursive: true });
    }

    // Check if views directory exists, create it if not
    if (!fs.existsSync(viewsDir)) {
      fs.mkdirSync(viewsDir);
    }
    if (fs.existsSync(swaggerFilePath)) {
      const swaggerFile = JSON.parse(fs.readFileSync(swaggerFilePath, "utf-8"));
      App.use(
        "/api-docs",
        SwaggerGatewayauth,
        swaggerUi.serve,
        swaggerUi.setup(swaggerFile),
      );
    } else {
      console.log(
        `${swaggerFilePath} does not exist. Generating Swagger file...`,
      );
      exec("node swagger.js", (err, stdout, stderr) => {
        if (err) {
          console.error(`Error executing swagger.js: ${stderr}`);
          return;
        }
        console.log(`Swagger file generated: ${stdout}`);
      });
    }
  } catch (error) {
    console.error("Error reading or generating Swagger file:", error);
  }
  // * 2. Connect to MongoDB
  await connectMongoDB();
  runCronJobs();

  // * Ads Factory Auto-Pilot — start BullMQ worker + reload active jobs
  try {
    const { startWorker, reloadActiveJobs } = require("./services/adsFactoryAuto/adsFactoryAutoQueue");
    // reloadActiveJobs MUST run before startWorker — it cancels stale/orphan BullMQ
    // entries from Redis. If the worker starts first it will pick up those stale jobs
    // and fire them immediately (past-due one-shots, orphan jobs from deleted campaigns).
    await reloadActiveJobs();
    startWorker();
  } catch (err) {
    console.error("[adsFactory] failed to start autopilot queue:", err.message);
  }

  // * Warm up push (FCM) so the boot log confirms whether it's configured.
  // Init is otherwise lazy; this just surfaces enabled/disabled state per env.
  try {
    require("./services/push/firebaseAdmin").isPushEnabled();
  } catch (err) {
    console.error("[push] warm-up failed:", err.message);
  }

  // ! To be reworked properly
  sub.subscribe("analyticsChartTop");
  sub.subscribe("analyticsChartMid");
  sub.subscribe("analyticsChartBottom");
  sub.subscribe("chatResponse");
  sub.subscribe("adsData");
  sub.subscribe("resolve");
  sub.subscribe("currentContext");

  // * 3. Subscribe to Redis channels
  sub.subscribe("adCreativeResponse");
  sub.subscribe("adCreativeVideoResponse");

  // * 4. Verify Socket.IO connections with JWT
  Socket.use((socket, next) => {
    verifyTokenSocketMain(socket, next);
  });

  // * 5. Initialize Socket.IO event handlers
  initializeSockets(Socket, pub, sub);

  // * 6. Middleware setup
  App.use(apiLimiter);
  App.use(bodyParser.json({ limit: "50mb" }));
  App.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
  App.use(express.json());
  App.use(express.urlencoded({ extended: true }));
  // mongoSanitize MUST stay below the body parsers. It only walks keys that are
  // already populated — `['body','params','headers','query'].forEach(k => { if (req[k]) … })`
  // in express-mongo-sanitize — so mounting it above express.json() leaves
  // req.body completely untouched and operator payloads such as
  // {"userId":{"$ne":null}} reach Mongo unfiltered. req.query/req.params are
  // populated by Express before user middleware, which is why the old order
  // still appeared to work. Guarded by test/security/mongoSanitizeOrder.test.js.
  App.use(mongoSanitize());

  App.use(
    session({
      secret: process.env.JWT_SECRET_KEY,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 60 * 60 * 1000 },
    }),
  );
  App.set("view engine", "ejs");
  App.use(express.static(path.join(__dirname, "public")));

  // * 7. AdsGPT routes
  App.use("/adsgpt", mainRoute);

  // * 7a. OAuth 2.1 provider (see docs/OAUTH_PROVIDER_PLAN.md).
  // Well-known discovery docs live at the app root by spec; the OAuth
  // endpoints themselves live under /oauth. Kept in two routers so the
  // path fragments in each file match their mount points 1:1.
  App.use(require("./Router/oauthWellKnown"));
  App.use("/oauth", require("./Router/oauth"));

  // * 8. Facebook oauth routes
  App.get("/api/auth/facebook", facebookAuthController.initiateAuth);
  App.get("/api/auth/facebook/callback", facebookAuthController.handleCallback);

  // * 9. Google OAuth routes
  App.get("/api/auth/google", googleAuthController.initiateAuth);
  App.get("/api/auth/google/callback", googleAuthController.handleCallback);

  // * 10. Autopilot Telegram webhook (inbound /start → chat-id reply).
  // Telegram POSTs updates here; the route is public but gated by the
  // secret-token header inside the handler. Mounted at app root, like the
  // OAuth callbacks above, since Telegram can't carry our JWT.
  {
    const telegram = require("./services/autopilot/telegramBotService");
    App.post(telegram.DEFAULT_WEBHOOK_PATH, webhookLimiter, telegram.createWebhookHandler());
  }
  // * 10. TikTok OAuth routes
  App.get("/api/auth/tiktok", tiktokAuthController.initiateAuth);
  App.get("/api/auth/tiktok/callback", tiktokAuthController.handleCallback);



  const port = process.env.PORT;
  server.listen(port, () => {
    console.log(`Server Started: port: ${port}`);
    // Register the Autopilot Telegram webhook with Telegram (setWebhook).
    // No-op if AUTOPILOT_TELEGRAM_BOT_TOKEN / _WEBHOOK_URL aren't set.
    // Idempotent, so re-registering on every boot is safe. Unlike the
    // old polling transport this scales horizontally — any worker can
    // serve the webhook route.
    try {
      require("./services/autopilot/telegramBotService")
        .registerWebhook()
        .catch((err) =>
          console.error(
            "[autopilot telegram] webhook registration failed:",
            err.message,
          ),
        );
    } catch (err) {
      console.error("[autopilot telegram] startup failed:", err.message);
    }
  });
}

createServer();
