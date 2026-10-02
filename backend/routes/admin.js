// backend/routes/admin.js
import express from "express";
import { auth } from "../middleware/auth.js";
import requireRole from "../middleware/requireRole.js";
import User from "../models/User.js";
import Assignment from "../models/Assignment.js";
import Schedule from "../models/Schedule.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendMail } from "../utils/mailer.js";

const router = express.Router();

router.use(auth, requireRole("ADMIN"));

router.get("/users", async (req, res) => {
  const users = await User.find().select("-passwordHash");
  res.json(users);
});

router.post("/users", async (req, res) => {
  try {
    const { fullName, username, email, role, password, status, studentClass } = req.body;

    if (!password || String(password).length < 6) {
      return res.status(400).json({ message: "Mot de passe trop court" });
    }

    const exists = await User.findOne({
      $or: [
        username ? { username } : null,
        email ? { email } : null,
      ].filter(Boolean),
    });
    if (exists) return res.status(409).json({ message: "Utilisateur déjà existant" });

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      fullName: fullName || "",
      username: username || "",
      email: email || "",
      role: role ? String(role).toUpperCase() : "STUDENT",
      studentClass: role === "student" && studentClass ? studentClass : "L1",
      status: status === "inactive" ? "inactive" : "active",
      isActive: status === "inactive" ? false : true,
      emailVerified: false,
      passwordHash,
    });

    res.json({ message: "Utilisateur créé", user: { id: user._id, username: user.username, email: user.email, role: user.role } });
  } catch (e) {
    console.error("admin create user error:", e);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    // Sécurité : empêcher de se supprimer soi-même
    if (String(user._id) === String(req.user.id)) {
      return res.status(403).json({ message: "Impossible de supprimer son propre compte" });
    }

    await User.findByIdAndDelete(id);
    res.json({ message: "Utilisateur supprimé" });
  } catch (e) {
    console.error("admin delete user error:", e);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

router.post("/teachers/invite", async (req, res) => {
  try {
    const { email, firstName, lastName, fullName } = req.body || {};

    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail) {
      return res.status(400).json({ message: "Email requis pour inviter un professeur" });
    }

    let user = await User.findOne({ email: cleanEmail });

    if (user) {
      if (user.role !== "TEACHER") {
        return res
          .status(409)
          .json({ message: "Un utilisateur avec cet email existe déjà avec un autre rôle" });
      }
    } else {
      const name =
        fullName ||
        `${String(firstName || "").trim()} ${String(lastName || "").trim()}`.trim();

      user = new User({
        fullName: name,
        username: "",
        email: cleanEmail,
        role: "TEACHER",
        status: "inactive",
        isActive: false,
        emailVerified: false,
      });
    }

    const invitationToken = crypto.randomBytes(32).toString("hex");
    const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    user.invitationToken = invitationToken;
    user.invitationExpiresAt = invitationExpiresAt;
    user.isActive = false;
    user.emailVerified = false;
    user.invitedBy = req.user?.id || null;

    await user.save();

    const baseFrontend =
      process.env.FRONTEND_BASE_URL || "http://127.0.0.1:5501/frontend";
    const activationUrl = `${baseFrontend}/teacher-complete-account.html?token=${invitationToken}`;

    try {
      await sendMail({
        to: cleanEmail,
        subject: "Invitation Wes'sup – Activation de ton compte professeur",
        text:
          `Bonjour,\n\n` +
          `Tu as été invité(e) en tant que professeur sur Wes'sup Business City.\n\n` +
          `Pour activer ton compte, clique sur le lien suivant :\n${activationUrl}\n\n` +
          `Si tu n'es pas à l'origine de cette demande, tu peux ignorer ce message.\n\n` +
          `L'équipe Wes'sup.`,
        html: `
          <p>Bonjour,</p>
          <p>Tu as été invité(e) en tant que <strong>professeur</strong> sur Wes'sup Business City.</p>
          <p>
            Pour activer ton compte, clique sur le lien suivant :<br/>
            <a href="${activationUrl}">${activationUrl}</a>
          </p>
          <p>Si tu n'es pas à l'origine de cette demande, tu peux ignorer ce message.</p>
          <p>L'équipe Wes'sup.</p>
        `,
      });
    } catch (err) {
      console.error("Erreur envoi mail invitation prof:", err.message);
    }

    return res.json({
      message: "Invitation professeur créée",
      email: cleanEmail,
      expiresAt: invitationExpiresAt,
      activationUrl,
    });
  } catch (e) {
    console.error("admin teacher invite error:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// PATCH /api/admin/users/:id
router.patch("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, username, email, role, formation, track, studentClass, status } = req.body;

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });

    if (fullName !== undefined) user.fullName = fullName;
    if (username !== undefined) user.username = username;
    if (email !== undefined) user.email = email;
    if (role !== undefined) user.role = role.toUpperCase();
    if (formation !== undefined) user.formation = formation;
    if (track !== undefined) user.track = track;
    if (studentClass !== undefined) user.studentClass = studentClass;
    
    if (status !== undefined) {
      user.status = status;
      user.isActive = status === "active";
    }

    await user.save();

    res.json({ message: "Utilisateur mis à jour", user });
  } catch (e) {
    console.error("admin update user error:", e);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

router.patch("/users/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    const cleanStatus = String(status || "").toLowerCase();
    if (!["active", "inactive"].includes(cleanStatus)) {
      return res.status(400).json({ message: "Statut invalide" });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });

    const nextStatus = cleanStatus === "active" ? "active" : "inactive";
    user.status = nextStatus;
    user.isActive = nextStatus === "active";
    await user.save();

    return res.json({
      ok: true,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        username: user.username,
        role: user.role,
        status: user.status,
        isActive: user.isActive,
      },
    });
  } catch (e) {
    console.error("admin update status error:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// GET /api/admin/grades?studentClass=BTS%201
router.get("/grades", async (req, res) => {
  try {
    const studentClass = String(req.query.studentClass || "").trim();
    if (!studentClass) {
      return res.status(400).json({ message: "studentClass requis" });
    }

    const students = await User.find({ role: "STUDENT", studentClass })
      .select("_id fullName username email studentClass")
      .lean();

    if (!students.length) return res.json({ studentClass, students: [] });

    const studentIds = students.map((s) => s._id);
    const targetSet = new Set(studentIds.map((id) => String(id)));

    const assignments = await Assignment.find({
      "submissions.student": { $in: studentIds },
    })
      .select("title course submissions")
      .populate("course", "title")
      .lean();

    const byStudent = new Map();
    students.forEach((s) => {
      byStudent.set(String(s._id), {
        student: s,
        average: null,
        gradedCount: 0,
        pendingCount: 0,
        details: [],
      });
    });

    assignments.forEach((a) => {
      const courseTitle = a?.course?.title || "";
      const assignmentTitle = a?.title || "";
      const subs = Array.isArray(a.submissions) ? a.submissions : [];
      subs.forEach((sub) => {
        const sid = String(sub?.student || "");
        if (!targetSet.has(sid)) return;
        const item = byStudent.get(sid);
        if (!item) return;

        const hasGrade = sub.grade !== undefined && sub.grade !== null && sub.grade !== "";
        if (hasGrade) {
          const g = Number(sub.grade);
          if (Number.isFinite(g)) {
            item.gradedCount += 1;
            item.details.push({
              courseTitle,
              assignmentTitle,
              grade: g,
              feedback: String(sub.feedback || ""),
              submittedAt: sub.submittedAt || null,
            });
            item._sum = (item._sum || 0) + g;
          } else {
            item.pendingCount += 1;
          }
        } else {
          item.pendingCount += 1;
        }
      });
    });

    const result = Array.from(byStudent.values()).map((x) => {
      const sum = x._sum || 0;
      const avg = x.gradedCount > 0 ? sum / x.gradedCount : null;
      const details = (x.details || [])
        .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0))
        .slice(0, 30);
      return {
        student: x.student,
        average: avg,
        gradedCount: x.gradedCount,
        pendingCount: x.pendingCount,
        details,
      };
    });

    result.sort((a, b) => {
      const av = a.average === null ? -1 : a.average;
      const bv = b.average === null ? -1 : b.average;
      return bv - av;
    });

    return res.json({ studentClass, students: result });
  } catch (e) {
    console.error("admin grades error:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// GET /api/admin/absences?studentClass=BTS%201
router.get("/absences", async (req, res) => {
  try {
    const studentClass = String(req.query.studentClass || "").trim();
    if (!studentClass) {
      return res.status(400).json({ message: "studentClass requis" });
    }

    const students = await User.find({ role: "STUDENT", studentClass })
      .select("_id fullName username email studentClass academicStatus")
      .lean();

    const result = (students || []).map((s) => {
      const academicStatus = s.academicStatus || {};
      const activeEmojis = Array.isArray(academicStatus.activeEmojis)
        ? academicStatus.activeEmojis
        : [];

      const computedTotal = activeEmojis.reduce((acc, e) => acc + (Number(e?.absences) || 0), 0);
      const totalAbsences =
        academicStatus.absences !== undefined && academicStatus.absences !== null
          ? Number(academicStatus.absences) || 0
          : computedTotal;

      const bySubject = activeEmojis
        .filter((e) => (Number(e?.absences) || 0) > 0)
        .map((e) => ({
          subject: String(e?.subject || ""),
          absences: Number(e?.absences) || 0,
          details: (Array.isArray(e?.absenceDetails) ? e.absenceDetails : []).map((d) => ({
            date: d?.date || null,
            reason: String(d?.reason || ""),
          })),
        }))
        .sort((a, b) => b.absences - a.absences);

      return {
        student: {
          _id: s._id,
          fullName: s.fullName || "",
          username: s.username || "",
          email: s.email || "",
          studentClass: s.studentClass || studentClass,
        },
        totalAbsences,
        bySubject,
      };
    });

    result.sort((a, b) => (b.totalAbsences || 0) - (a.totalAbsences || 0));
    return res.json({ studentClass, students: result });
  } catch (e) {
    console.error("admin absences error:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// =====================================================
// 📅 GESTION DES EMPLOIS DU TEMPS (SCHEDULES) - ADMIN
// =====================================================

// GET /api/admin/schedules - Liste tous les emplois du temps
router.get("/schedules", async (req, res) => {
  try {
    const schedules = await Schedule.find()
      .sort({ className: 1 })
      .select("className displayName formation track studentClass semaineType anneeScolaire createdAt updatedAt")
      .lean();
    return res.json({ count: schedules.length, schedules });
  } catch (e) {
    console.error("admin schedules list error:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// GET /api/admin/schedules/:id - Détail complet d'un emploi du temps
router.get("/schedules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await Schedule.findById(id).lean();
    if (!schedule) return res.status(404).json({ message: "Emploi du temps introuvable" });
    return res.json(schedule);
  } catch (e) {
    console.error("admin schedule detail error:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/admin/schedules - Créer un nouvel emploi du temps
router.post("/schedules", async (req, res) => {
  try {
    const {
      className, displayName, formation, track, studentClass,
      semaineType, anneeScolaire, weeklyTimetable, exams
    } = req.body;

    if (!className || String(className).trim().length < 2) {
      return res.status(400).json({ message: "Nom de la classe requis (className)" });
    }

    const exists = await Schedule.findOne({ className: className.trim() });
    if (exists) {
      return res.status(409).json({ message: `Un emploi du temps existe déjà pour la classe "${className}"` });
    }

    const schedule = await Schedule.create({
      className: className.trim(),
      displayName: displayName || className,
      formation: formation || "",
      track: track || "",
      studentClass: studentClass || "",
      semaineType: semaineType || "Toutes",
      anneeScolaire: anneeScolaire || "",
      weeklyTimetable: weeklyTimetable || {},
      exams: exams || [],
      createdBy: req.user.id,
      updatedBy: req.user.id
    });

    return res.json({ message: "Emploi du temps créé", schedule });
  } catch (e) {
    console.error("admin create schedule error:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// PATCH /api/admin/schedules/:id - Modifier un emploi du temps
router.patch("/schedules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await Schedule.findById(id);
    if (!schedule) return res.status(404).json({ message: "Emploi du temps introuvable" });

    const fields = [
      "className", "displayName", "formation", "track",
      "studentClass", "semaineType", "anneeScolaire",
      "weeklyTimetable", "exams"
    ];

    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        schedule[field] = req.body[field];
      }
    });

    schedule.updatedBy = req.user.id;
    await schedule.save();

    return res.json({ message: "Emploi du temps mis à jour", schedule });
  } catch (e) {
    console.error("admin update schedule error:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// DELETE /api/admin/schedules/:id - Supprimer un emploi du temps
router.delete("/schedules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await Schedule.findById(id);
    if (!schedule) return res.status(404).json({ message: "Emploi du temps introuvable" });

    await Schedule.findByIdAndDelete(id);
    return res.json({ message: `Emploi du temps "${schedule.className}" supprimé` });
  } catch (e) {
    console.error("admin delete schedule error:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// PATCH /api/admin/schedules/:id/exams - Ajouter/modifier les examens
router.patch("/schedules/:id/exams", async (req, res) => {
  try {
    const { id } = req.params;
    const { exams } = req.body;

    const schedule = await Schedule.findById(id);
    if (!schedule) return res.status(404).json({ message: "Emploi du temps introuvable" });

    if (exams !== undefined) {
      schedule.exams = exams;
      schedule.updatedBy = req.user.id;
      await schedule.save();
    }

    return res.json({ message: "Examens mis à jour", exams: schedule.exams });
  } catch (e) {
    console.error("admin schedule exams error:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/admin/schedules/import-legacy - Importer les anciennes formations en dur
router.post("/schedules/import-legacy", async (req, res) => {
  try {
    const { FORMATIONS } = await import("../services/formationBot.js");
    const imported = [];
    const skipped = [];

    for (const [key, data] of Object.entries(FORMATIONS)) {
      const exists = await Schedule.findOne({ className: key });
      if (exists) {
        skipped.push(key);
        continue;
      }

      const weekMap = {};
      if (data.emploi_du_temps) {
        for (const [day, slots] of Object.entries(data.emploi_du_temps)) {
          weekMap[day] = slots.map((s) => ({
            heure: s.heure || "",
            matiere: s.matiere || "",
            professeur: s.professeur || "",
            salle: s.salle || ""
          }));
        }
      }

      const schedule = await Schedule.create({
        className: key,
        displayName: data.nom || key,
        semaineType: "Toutes",
        weeklyTimetable: weekMap,
        exams: [],
        createdBy: req.user.id,
        updatedBy: req.user.id
      });

      imported.push({ className: key, _id: schedule._id });
    }

    return res.json({
      message: `Import terminé`,
      imported: imported.length,
      skipped: skipped.length,
      imported,
      skipped
    });
  } catch (e) {
    console.error("admin schedule legacy import error:", e);
    return res.status(500).json({ message: "Erreur serveur: " + e.message });
  }
});

export default router;
