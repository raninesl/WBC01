// backend/models/ChatMessage.js
import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["user", "bot"], required: true },
    content: { type: String, required: true, trim: true },
    conversationId: { type: String, default: "default" },
    conversationTitle: { type: String, default: "Nouvelle conversation" }
  },
  { timestamps: true }
);

export default mongoose.model("ChatMessage", chatMessageSchema);
