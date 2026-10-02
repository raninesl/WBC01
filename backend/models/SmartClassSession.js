import mongoose from "mongoose";

const SmartClassSessionSchema = new mongoose.Schema(
  {
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    roomId: { type: String, required: true },
    status: { type: String, enum: ["active", "stopped"], default: "active", index: true },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
  },
  { timestamps: true }
);

SmartClassSessionSchema.index({ teacher: 1, status: 1 });
SmartClassSessionSchema.index({ course: 1, status: 1 });

export default mongoose.model("SmartClassSession", SmartClassSessionSchema);
