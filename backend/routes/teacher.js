import express from "express";
import { auth } from "../middleware/auth.js";
import requireRole from "../middleware/requireRole.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import Course from "../models/Course.js";

const router = express.Router();

// Middleware: Teachers only (or Admins)
router.use(auth, (req, res, next) => {
  if (req.user.role === "TEACHER" || req.user.role === "ADMIN") {
    next();
  } else {
    res.status(403).json({ message: "Accès réservé aux enseignants" });
  }
});

/**
 * GET /api/teacher/students
 * Récupère la liste des étudiants
 */
router.get("/students", async (req, res) => {
  try {
    const students = await User.find({ role: "STUDENT" })
      .select("fullName username email studentClass academicStatus avatar3DUrl")
      .sort({ studentClass: 1, fullName: 1 });
    res.json(students);
  } catch (e) {
    console.error("Error fetching students:", e);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * POST /api/teacher/students/:id/evaluate
 * Met à jour les remarques et l'emoji de statut
 */
router.post("/students/:id/evaluate", async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks, statusEmoji, subject, absences } = req.body;

    const student = await User.findById(id);
    if (!student) {
      return res.status(404).json({ message: "Étudiant introuvable" });
    }

    // Update Absences (if provided)
    let absenceUpdate = 0;
    if (absences !== undefined && absences !== null) {
        absenceUpdate = parseInt(absences, 10);
    }

    // Security Check: Teacher can only evaluate in their own subjects
    if (req.user.role === "TEACHER") {
        if (!subject) {
            return res.status(400).json({ message: "La matière est obligatoire pour un enseignant" });
        }
        const courseExists = await Course.exists({ teacher: req.user.id, title: subject });
        if (!courseExists) {
            return res.status(403).json({ message: `Vous n'êtes pas autorisé à évaluer dans la matière : ${subject}` });
        }
    }

    // Initialize activeEmojis if undefined
    if (!student.academicStatus.activeEmojis) {
        student.academicStatus.activeEmojis = [];
    }

    // Handle Active Emojis & Remarks Logic
    const myId = req.user.id;
    const existingIndex = student.academicStatus.activeEmojis.findIndex(e => {
        const isMyEval = e.teacherId && e.teacherId.toString() === myId;
        const isAdmin = req.user.role === "ADMIN";
        const subjectMatch = (e.subject || "").toLowerCase().trim() === (subject || "").toLowerCase().trim();
        
        // Admin can edit/remove any evaluation for this subject
        // Teacher can only edit/remove their own
        return (isMyEval || isAdmin) && subjectMatch;
    });
    
    if (existingIndex >= 0) {
        // Update existing entry
        if (statusEmoji !== undefined) student.academicStatus.activeEmojis[existingIndex].emoji = statusEmoji;
        if (remarks !== undefined) student.academicStatus.activeEmojis[existingIndex].remarks = remarks;
        if (subject !== undefined) student.academicStatus.activeEmojis[existingIndex].subject = subject;
        if (absences !== undefined) student.academicStatus.activeEmojis[existingIndex].absences = absenceUpdate;
        student.academicStatus.activeEmojis[existingIndex].timestamp = new Date();
        
        // Don't overwrite teacherName if it's an admin editing someone else's? 
        // Actually, let's keep track of who last edited it.
        student.academicStatus.activeEmojis[existingIndex].teacherName = req.user.fullName || req.user.username || req.user.email;
        
        // If emoji is empty (deactivated) AND remarks are empty, remove it.
        // Or if statusEmoji is explicitly "", it means the teacher wants to remove the emoji part.
        // But the user wants to remove the WHOLE block.
        const current = student.academicStatus.activeEmojis[existingIndex];
        if (statusEmoji === "" || (!current.emoji && !current.remarks && current.absences === 0)) {
             student.academicStatus.activeEmojis.splice(existingIndex, 1);
        }
    } else {
        // Add new entry if there is content (either emoji, remarks, or absences)
        if ((statusEmoji && statusEmoji !== "") || (remarks && remarks.trim() !== "") || absenceUpdate > 0) {
            student.academicStatus.activeEmojis.push({
                emoji: statusEmoji || "",
                remarks: remarks || "",
                subject: subject || "",
                absences: absenceUpdate,
                teacherId: myId,
                teacherName: req.user.fullName || req.user.username || req.user.email,
                timestamp: new Date()
            });
        }
    }

    // Update global absences sum
    const totalAbsences = student.academicStatus.activeEmojis.reduce((sum, item) => sum + (item.absences || 0), 0);
    student.academicStatus.absences = totalAbsences;

    // Legacy Fallback (Last One Wins)
    // If we are deactivating, also clear legacy fields if they match
    if (statusEmoji === "") {
        student.academicStatus.remarks = "";
        student.academicStatus.statusEmoji = "";
    } else {
        if (remarks !== undefined) student.academicStatus.remarks = remarks;
        if (statusEmoji !== undefined) student.academicStatus.statusEmoji = statusEmoji;
    }
    
    student.academicStatus.lastUpdatedBy = req.user.id;
    student.academicStatus.lastUpdatedAt = new Date();

    await student.save();

    // Create a notification for the student
    try {
        const profName = req.user.fullName || req.user.username || req.user.email;
        const notification = new Notification({
            recipient: id,
            type: "EVALUATION",
            title: "Nouvelle évaluation",
            message: `Le professeur ${profName} (${subject || 'Général'}) a mis à jour votre suivi académique : ${statusEmoji || ''} ${remarks || ''}`,
            relatedId: req.user.id,
            link: "/feed" // Redirect to the wall/feed where they see full remarks
        });
        await notification.save();
        
        if (req.io) {
            req.io.to(id).emit("notification:new", notification);
        }
    } catch (notifErr) {
        console.error("Error creating evaluation notification:", notifErr);
    }

    // Notify the student via Socket.IO if connected
    if (req.io) {
      req.io.to(id).emit("evaluation:updated", {
        remarks: student.academicStatus.remarks,
        statusEmoji: student.academicStatus.statusEmoji,
        activeEmojis: student.academicStatus.activeEmojis
      });
    }

    res.json({ message: "Évaluation mise à jour", academicStatus: student.academicStatus });
  } catch (e) {
    console.error("Error updating evaluation:", e);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * POST /api/teacher/attendance
 * Bulk update absences for a course
 */
router.post("/attendance", async (req, res) => {
    try {
        const { courseId, date, students } = req.body;
        // students: array of { studentId: string, status: "ABSENT" | "LATE" | "PRESENT" }
        // For now, we only care about ABSENT to increment count.

        if (!courseId || !students || !Array.isArray(students)) {
            return res.status(400).json({ message: "Données invalides" });
        }

        const course = await Course.findById(courseId);
        if (!course) return res.status(404).json({ message: "Cours introuvable" });

        // Verify teacher owns the course
        if (req.user.role === "TEACHER" && course.teacher.toString() !== req.user.id) {
            return res.status(403).json({ message: "Non autorisé pour ce cours" });
        }

        const results = [];

        for (const item of students) {
            if (item.status === "ABSENT") {
                const student = await User.findById(item.studentId);
                if (student) {
                    if (!student.academicStatus.activeEmojis) {
                        student.academicStatus.activeEmojis = [];
                    }

                    // Check if we already have an absence entry for this subject/teacher today?
                    // Actually, usually we just append a new absence record or increment the counter.
                    // The "activeEmojis" is a list of status cards. We probably don't want 10 cards for 10 absences.
                    // We want ONE card per subject with the TOTAL absences.
                    
                    // Find existing subject card
                    const existingIndex = student.academicStatus.activeEmojis.findIndex(e => 
                        e.subject === course.title && 
                        e.teacherId && e.teacherId.toString() === req.user.id
                    );

                    const absenceDate = date ? new Date(date) : new Date();
                    const formattedDateTime = absenceDate.toLocaleString('fr-FR', { 
                        day: '2-digit', month: '2-digit', year: 'numeric', 
                        hour: '2-digit', minute: '2-digit' 
                    });

                    if (existingIndex >= 0) {
                        // Increment
                        student.academicStatus.activeEmojis[existingIndex].absences = (student.academicStatus.activeEmojis[existingIndex].absences || 0) + 1;
                        
                        if (!student.academicStatus.activeEmojis[existingIndex].absenceDetails) {
                            student.academicStatus.activeEmojis[existingIndex].absenceDetails = [];
                        }
                        
                        student.academicStatus.activeEmojis[existingIndex].absenceDetails.push({
                            date: absenceDate,
                            reason: "Appel en classe"
                        });

                        student.academicStatus.activeEmojis[existingIndex].remarks = `Dernière absence : ${formattedDateTime}`;
                        student.academicStatus.activeEmojis[existingIndex].timestamp = new Date();
                    } else {
                        // Create new
                        student.academicStatus.activeEmojis.push({
                            emoji: "", 
                            remarks: `Absent le ${formattedDateTime}`,
                            subject: course.title,
                            absences: 1,
                            absenceDetails: [{
                                date: absenceDate,
                                reason: "Appel en classe"
                            }],
                            teacherId: req.user.id,
                            teacherName: req.user.fullName || req.user.username,
                            timestamp: new Date()
                        });
                    }

                    // Update global total
                    const total = student.academicStatus.activeEmojis.reduce((sum, e) => sum + (e.absences || 0), 0);
                    student.academicStatus.absences = total;
                    student.academicStatus.lastUpdatedBy = req.user.id;
                    student.academicStatus.lastUpdatedAt = new Date();

                    await student.save();

                    // Notification
                    try {
                        const notif = new Notification({
                            recipient: student._id,
                            type: "ABSENCE",
                            title: "Nouvelle absence signalée",
                            message: `Absence enregistrée en ${course.title} le ${new Date(date).toLocaleDateString()}`,
                            relatedId: course._id,
                            link: "/feed"
                        });
                        await notif.save();
                        if (req.io) req.io.to(student._id.toString()).emit("notification:new", notif);
                    } catch (err) { console.error(err); }

                    results.push({ id: student._id, status: "updated" });
                }
            }
        }

        res.json({ message: "Appel enregistré", results });

    } catch (e) {
        console.error("Error in attendance:", e);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

export default router;
