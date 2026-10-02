import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  content: { type: String },
  type: { type: String, enum: ["text", "image", "file", "gif", "emoji"], default: "text" },
  attachmentUrl: { type: String }, // For files/images
  fileName: { type: String }, // Original file name
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // To track read status
}, { timestamps: true });

export default mongoose.model("Message", messageSchema);
