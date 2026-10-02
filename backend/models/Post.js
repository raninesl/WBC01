// backend/models/Post.js
import mongoose from "mongoose";

const PostSchema = new mongoose.Schema(
  {
    content: { type: String, default: "" },
    scope: { type: String, enum: ["GLOBAL", "L1", "L2", "L3", "M1", "M2", "CLASS_A", "CLASS_B"], default: "GLOBAL" },
    type: { type: String, enum: ["STATUS", "COURSE", "ANNOUNCEMENT"], default: "STATUS" },

    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // pièce jointe optionnelle
    attachment: {
      filename: String,
      originalName: String,
      mimeType: String,
      size: Number,
      url: String,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Post", PostSchema);
