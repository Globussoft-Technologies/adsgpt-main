const { createLogger, format, transports } = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const fs = require("fs");
const path = require("path");


const logDir = path.join(__dirname, "../logs");

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const { combine, timestamp, printf, errors } = format;

const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} ${level}: ${stack || message}`;
});

const dailyRotateTransport = new DailyRotateFile({
  dirname: logDir,
  filename: `%DATE%.log`,
  datePattern: "YYYY-MM-DD",
  zippedArchive: false,
  maxFiles: "10d", // keep logs for last 15 days
});

// In dev, also stream logs to stdout so the developer can watch what's
// happening in the terminal (autopilot ticks, etc.) without tailing the
// daily log file. Gated on MODE=DEV (set in .env) — prod stays file-only.
const isDev =
  String(process.env.MODE || "").toUpperCase() === "DEV" ||
  process.env.NODE_ENV === "development";

const transportsList = [dailyRotateTransport];
if (isDev) {
  transportsList.push(
    new transports.Console({
      format: combine(
        timestamp({ format: "HH:mm:ss" }),
        errors({ stack: true }),
        logFormat,
      ),
    }),
  );
}

const logger = createLogger({
  level: isDev ? "debug" : "info",
  format: combine(
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    errors({ stack: true }),
    logFormat
  ),
  transports: transportsList,
});

module.exports = logger;
