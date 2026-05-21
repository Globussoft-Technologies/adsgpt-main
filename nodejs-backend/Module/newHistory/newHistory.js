const mongoose = require("mongoose");

const historySchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
    },
    conversations: {
      type: Array,
      default: [],
    },
    type: {
      type: String,
      enum: ["adCopy", "adCreative", "adVideo", "emulator"],
      required: true,
    },
    userId: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      default: "Untitled Chat",
      trim: true,
    },
    ad: {
      type: Object,
      default: {},
    },
    emulatorData: {
      type: Object,
      default: {}
    }
  },
  {
    timestamps: true,
  }
);

// Pre-save hook to set title = first "user" message
historySchema.pre("save", function (next) {
  if (this.conversations?.length > 0 && this.isNew) {
    const firstUserMsg = this.conversations.find((msg) => msg.type === "user");
    if (firstUserMsg?.message) {
      this.title = firstUserMsg.message;
    }
  }
  next();
});

const History = mongoose.model("History", historySchema);

module.exports = History;
