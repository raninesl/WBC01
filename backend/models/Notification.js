import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["ASSIGNMENT_NEW", "SUBMISSION_NEW", "GRADE_NEW", "FEED_NEW", "INFO"], required: true },
    title: { type: String, required: true },
    message: { type: String },
    relatedId: { type: mongoose.Schema.Types.ObjectId }, // ID of assignment, course, etc.
    link: { type: String }, // Optional direct link or action code
    read: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model("Notification", NotificationSchema);
