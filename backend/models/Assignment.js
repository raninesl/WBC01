import mongoose from "mongoose";

const AssignmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    type: { type: String, enum: ["DEVOIR", "EXAMEN", "CONTROLE_CONTINU"], default: "DEVOIR" },
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
    dueDate: { type: Date },
    attachmentUrl: { type: String }, // URL du fichier joint par le prof
    submissions: [
      {
        student: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        content: { type: String }, // URL or text
        submittedAt: { type: Date, default: Date.now },
        grade: { type: Number }, // /20
        feedback: { type: String }
      }
    ]
  },
  { timestamps: true }
);

export default mongoose.model("Assignment", AssignmentSchema);
