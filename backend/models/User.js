// backend/models/User.js
import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    avatar3DUrl: { type: String, default: "" },

    // Configuration détaillée de l'avatar personnalisé
    avatarConfig: {
      body: { type: String, default: "skin_light" },
      face: { type: String, default: "face_1" },
      outfit: { type: String, default: "outfit_casual" },
      mainColor: { type: String, default: "#00f2ff" }
    },
    fullName: { type: String, default: "" },
    username: { type: String, unique: true, sparse: true, trim: true },
    email: { type: String, unique: true, sparse: true, trim: true },
    passwordHash: { type: String, required: false },
    role: { type: String, enum: ["ADMIN", "TEACHER", "STUDENT"], default: "STUDENT" },
    formation: { type: String, default: "" }, // BTS, Bachelor, Mastère
    track: { type: String, default: "" }, // NDRC, GPME, MANAGEMENT, MARKETING, etc.
    studentClass: { type: String, enum: ["BTS 1", "BTS 2", "B1", "B2", "B3", "M1", "M2"], default: "BTS 1" },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    isActive: { type: Boolean, default: true },
    emailVerified: { type: Boolean, default: false },
    invitationToken: { type: String, default: null },
    invitationExpiresAt: { type: Date, default: null },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    academicStatus: {
      remarks: { type: String, default: "" },
      statusEmoji: { type: String, default: "" },
      absences: { type: Number, default: 0 }, // Added absences tracking
      activeEmojis: [
        {
          emoji: String,
          remarks: { type: String, default: "" },
          absences: { type: Number, default: 0 }, // Per-subject absences
          absenceDetails: [
            {
              date: { type: Date, default: Date.now },
              reason: { type: String, default: "" }
            }
          ],
          teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          teacherName: { type: String, default: "" },
          subject: { type: String, default: "" },
          timestamp: { type: Date, default: Date.now }
        }
      ],
      lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      lastUpdatedAt: { type: Date }
    },
  },
  { timestamps: true }
);

export default mongoose.model("User", UserSchema);
