import mongoose from "mongoose";

const CourseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    schedule: { type: String, default: "TBD" },
    location: { type: String, default: "Metaverse" },
    status: { type: String, enum: ["active", "completed", "upcoming"], default: "upcoming" },
    supportUrl: { type: String }, // URL of the uploaded support file
  },
  { timestamps: true }
);

export default mongoose.model("Course", CourseSchema);
