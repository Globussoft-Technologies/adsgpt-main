const express = require("express");
const cors = require("cors");
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
const facebookAuthController = require("./controllers/adPosting/authController");
const googleAuthController = require("./controllers/adPosting/googleAuthController");
const { pub, sub } = require("./db/redis");
const connectMongoDB = require("./db/mongo");

async function createServer() {
  const App = express();
  App.use(require("./middlewares/corsMiddleware"));
  const server = http.createServer(App);
  const Socket = new Server(server, {
    cors: {
      origin: "*",
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
  App.use(mongoSanitize());
  App.use(bodyParser.json({ limit: "50mb" }));
  App.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
  App.use(cors());
  App.use(express.json());
  App.use(express.urlencoded({ extended: true }));

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

  // * 8. Facebook oauth routes
  App.get("/api/auth/facebook", facebookAuthController.initiateAuth);
  App.get("/api/auth/facebook/callback", facebookAuthController.handleCallback);

  // * 9. Google OAuth routes
  App.get("/api/auth/google", googleAuthController.initiateAuth);
  App.get("/api/auth/google/callback", googleAuthController.handleCallback);



  const port = process.env.PORT;
  server.listen(port, () => {
    console.log(`Server Started: port: ${port}`);
    // Start the Autopilot Telegram bot in polling mode. No-op if
    // AUTOPILOT_TELEGRAM_BOT_TOKEN isn't set. Polling assumes ONE
    // process per token — if we ever scale to cluster mode, swap this
    // for webhook transport (the planReplyForUpdate core is unchanged).
    try {
      require("./services/autopilot/telegramBotService").startTelegramBot();
    } catch (err) {
      console.error("[autopilot telegram] startup failed:", err.message);
    }
  });
}

createServer();
