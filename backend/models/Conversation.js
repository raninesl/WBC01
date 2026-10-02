import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  type: { type: String, enum: ["private", "group", "class"], default: "private" },
  relatedClass: { type: String },
  name: { type: String }, // For group chats
  admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // For group admins
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model("Conversation", conversationSchema);
