const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const swaggerUi = require("swagger-ui-express");
const App = express();
const port = process.env.PORT;
const router = require("./Routes/Router");
const { auth } = require("./utils/auth");
const authenticateJWT = require("./middlewares/auth");
const { apiLimiter } = require("./middlewares/rateLimitMiddleware");

// Middlewares
App.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
App.use(helmet());
App.use(apiLimiter);
App.use(express.urlencoded({ extended: true }));
App.use(morgan("dev"));
App.use(express.json());
App.use(cors());

const swaggerFile = JSON.parse(
  fs.readFileSync(path.join(__dirname, "resources", "views", "swagger-api.json"), "utf-8")
);
App.use("/explorer", auth, swaggerUi.serve, swaggerUi.setup(swaggerFile));
// Ads route
App.use("/ads", authenticateJWT, router);

// Start the server
App.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
