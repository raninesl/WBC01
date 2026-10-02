// backend/models/ClassroomActivity.js
import mongoose from "mongoose";

const ClassroomActivitySchema = new mongoose.Schema(
  {
    classroomId: { type: String, required: true, index: true }, // e.g., "CLASSa_A", "CLASSa_B"
    movementPercentage: { type: Number, required: true, min: 0, max: 100 },
    recordedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model("ClassroomActivity", ClassroomActivitySchema);