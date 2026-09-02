const mongoose = require("mongoose");
const { attachPoolMonitor } = require("../services/mongoMonitor");

const connectMongoDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_CONNECTION_STRING, {
      maxPoolSize: 10,
      // serverSelectionTimeoutMS: 5000, // fail fast
      // socketTimeoutMS: 45000,
    });

    console.log("MongoDB connected successfully");

    // Pool telemetry for the admin DB monitor. Attached here, immediately
    // after the first connect, because a listener registered later would see
    // check-ins for check-outs it never saw and report a negative in-use
    // count. Listeners only, no polling — nothing runs unless an admin looks.
    attachPoolMonitor(mongoose.connection);

    // Events
    mongoose.connection.on("connected", () => {
      console.log("MongoDB connected");
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("MongoDB disconnected. Reconnecting...");
      reconnectMongoDB();
    });

    mongoose.connection.on("error", (err) => {
      console.error("MongoDB error:", err);
    });

  } catch (error) {
    console.error("Initial MongoDB connection failed:", error);
    setTimeout(connectMongoDB, 5000); // retry
  }
};

const reconnectMongoDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_CONNECTION_STRING);
    console.log("MongoDB reconnected");
  } catch (err) {
    console.error("Reconnection failed. Retrying in 5s...");
    setTimeout(reconnectMongoDB, 5000);
  }
};

module.exports = connectMongoDB;