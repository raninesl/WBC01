import mongoose from "mongoose";

const CourseSlotSchema = new mongoose.Schema({
  heure: { type: String, required: true },
  matiere: { type: String, required: true },
  professeur: { type: String, default: "" },
  salle: { type: String, default: "" }
});

const ExamEntrySchema = new mongoose.Schema({
  date: { type: Date, required: true },
  matiere: { type: String, required: true },
  heureDebut: { type: String, required: true },
  heureFin: { type: String, required: true },
  duree: { type: String, default: "" },
  salle: { type: String, default: "" },
  professeur: { type: String, default: "" },
  type: { type: String, enum: ["DS", "CC", "Examen final", "TP noté", "Oral", "Autre"], default: "DS" },
  description: { type: String, default: "" }
});

const ScheduleSchema = new mongoose.Schema(
  {
    className: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    displayName: { type: String, default: "" },
    formation: { type: String, default: "" },
    track: { type: String, default: "" },
    studentClass: { type: String, default: "" },
    semaineType: { type: String, enum: ["A", "B", "Toutes"], default: "Toutes" },
    anneeScolaire: { type: String, default: "" },
    weeklyTimetable: {
      lundi: [CourseSlotSchema],
      mardi: [CourseSlotSchema],
      mercredi: [CourseSlotSchema],
      jeudi: [CourseSlotSchema],
      vendredi: [CourseSlotSchema],
      samedi: [CourseSlotSchema],
      dimanche: [CourseSlotSchema]
    },
    exams: [ExamEntrySchema],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

ScheduleSchema.index({ formation: 1, studentClass: 1 });
ScheduleSchema.index({ formation: 1, track: 1 });

export default mongoose.model("Schedule", ScheduleSchema);
