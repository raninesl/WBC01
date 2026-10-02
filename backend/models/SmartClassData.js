import mongoose from "mongoose";

const SmartClassDataSchema = new mongoose.Schema(
  {
    // ─────────────────────────────────────────────
    // IDENTIFICATION
    // ─────────────────────────────────────────────

    roomId: {
      type: String,
      required: true,
      index: true,
    },

    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SmartClassSession",
      index: true,
    },

    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      index: true,
    },

    // ─────────────────────────────────────────────
    // MÉTRIQUES PRINCIPALES SMARTCLASS
    // ─────────────────────────────────────────────

    attentionPct: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    distractionPct: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    fatiguePct: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    // ─────────────────────────────────────────────
    // NOUVEAU PIPELINE YOLOv8
    // camera_real.py / camera_sim.py
    // ─────────────────────────────────────────────

    peopleCount: {
      type: Number,
      min: 0,
      default: 0,
    },

    actions: {
      focused: {
        type: Number,
        default: 0,
      },

      reading: {
        type: Number,
        default: 0,
      },

      writing: {
        type: Number,
        default: 0,
      },

      hand_raising: {
        type: Number,
        default: 0,
      },

      phone: {
        type: Number,
        default: 0,
      },

      sleeping: {
        type: Number,
        default: 0,
      },

      talking: {
        type: Number,
        default: 0,
      },

      other: {
        type: Number,
        default: 0,
      },
    },

    avgConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },

    source: {
      type: String,
      default: "unknown",
    },

    capturedAt: {
      type: Date,
    },

    // ─────────────────────────────────────────────
    // COMPATIBILITÉ AVEC L'ANCIEN SMARTCLASS
    // On garde ces champs pour ne pas casser
    // le dashboard existant.
    // ─────────────────────────────────────────────

    handsRaisedCount: {
      type: Number,
      default: 0,
    },

    detectedCount: {
      type: Number,
      default: 0,
    },

    // ─────────────────────────────────────────────
    // ANCIEN MOTEUR HYBRIDE
    // Conservé temporairement pour compatibilité
    // ─────────────────────────────────────────────

    engagementScore: {
      type: Number,
      min: 0,
      max: 100,
    },

    studentCount: {
      type: Number,
    },

    attentifPct: {
      type: Number,
      min: 0,
      max: 100,
    },

    distraitPct: {
      type: Number,
      min: 0,
      max: 100,
    },

    fatiguePctHybrid: {
      type: Number,
      min: 0,
      max: 100,
    },

    phonePct: {
      type: Number,
      min: 0,
      max: 100,
    },

    handCountHybrid: {
      type: Number,
    },

    trend: {
      type: String,
    },

    sessionProfile: {
      type: String,
    },

    alertActive: {
      type: Boolean,
      default: false,
    },

    hybrid: {
      fusedScore: {
        type: Number,
        min: 0,
        max: 100,
      },

      mediapipeScore: {
        type: Number,
        min: 0,
        max: 100,
      },

      yoloScore: {
        type: Number,
        min: 0,
        max: 100,
      },

      weights: {
        type: Object,
      },

      trend: {
        type: String,
      },
    },

    // ─────────────────────────────────────────────
    // DATE D'ENREGISTREMENT
    // ─────────────────────────────────────────────

    recordedAt: {
      type: Date,
      default: Date.now,
    },
  },

  {
    timestamps: true,
  }
);


// ─────────────────────────────────────────────
// INDEX MONGODB
// ─────────────────────────────────────────────

SmartClassDataSchema.index({
  roomId: 1,
  recordedAt: -1,
});

SmartClassDataSchema.index({
  sessionId: 1,
  recordedAt: -1,
});

SmartClassDataSchema.index({
  teacher: 1,
  recordedAt: -1,
});

SmartClassDataSchema.index({
  course: 1,
  recordedAt: -1,
});


export default mongoose.model(
  "SmartClassData",
  SmartClassDataSchema
);