import express from "express";
import { auth } from "../middleware/auth.js";
import Assignment from "../models/Assignment.js";
import Course from "../models/Course.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import multer from "multer";
import path from "path";
import fs from "fs";

// Configure Multer for Assignments (Teacher attachments)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = "uploads/assignments";
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_"));
  },
});
const upload = multer({ storage });

// Configure Multer for Submissions (Student files)
const submissionStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = "uploads/submissions";
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + req.user.username + "-" + file.originalname.replace(/\s+/g, "_"));
    },
});
const uploadSubmission = multer({ storage: submissionStorage });

const router = express.Router();

// GET /api/assignments/student
// Get all assignments for courses the student is enrolled in
router.get("/student", auth, async (req, res) => {
    try {
        // 1. Find courses where student is enrolled
        const courses = await Course.find({ students: req.user.id });
        const courseIds = courses.map(c => c._id);

        // 2. Find assignments for these courses
        const fullAssignments = await Assignment.find({ course: { $in: courseIds } })
            .populate("course", "title");

        const result = fullAssignments.map(a => {
            const mySub = a.submissions.find(s => s.student.toString() === req.user.id);
            return {
                _id: a._id,
                title: a.title,
                description: a.description,
                course: a.course,
                dueDate: a.dueDate,
                attachmentUrl: a.attachmentUrl,
                mySubmission: mySub || null,
                status: mySub ? (mySub.grade ? "Graded" : "Submitted") : "Pending"
            };
        });

        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

// POST /api/assignments/:id/submit
// Submit an assignment
router.post("/:id/submit", auth, uploadSubmission.single("file"), async (req, res) => {
    try {
        const { content } = req.body; // Optional text content
        const fileUrl = req.file ? `/uploads/submissions/${req.file.filename}` : null;

        const assignment = await Assignment.findById(req.params.id).populate("course");

        if (!assignment) {
            return res.status(404).json({ message: "Devoir introuvable" });
        }

        // Check if already submitted
        const existingSubIndex = assignment.submissions.findIndex(s => s.student.toString() === req.user.id);
        
        // Use fileUrl if available, otherwise content (or both joined?)
        // Let's store fileUrl in content if it exists, or append it
        // Ideally we should have a separate field, but schema has content: String
        // So we'll store the URL in content. If user also sent text, we might lose it or need to combine.
        // Let's assume content IS the submission. If file, content = URL.
        
        let submissionContent = content;
        if (fileUrl) {
            submissionContent = fileUrl;
        }

        if (existingSubIndex !== -1) {
            // Update existing submission
            assignment.submissions[existingSubIndex].content = submissionContent;
            assignment.submissions[existingSubIndex].submittedAt = Date.now();
        } else {
            // New submission
            assignment.submissions.push({
                student: req.user.id,
                content: submissionContent,
                submittedAt: Date.now()
            });
        }

        await assignment.save();

        // Notify Teacher
        const teacherId = assignment.course.teacher;
        const notification = new Notification({
            recipient: teacherId,
            type: "SUBMISSION_NEW",
            title: "Nouveau rendu",
            message: `Un étudiant a rendu le devoir : ${assignment.title}`,
            relatedId: assignment._id,
            link: "/teacher-dashboard" // Or specific link
        });
        await notification.save();

        if (req.io) {
            req.io.to(teacherId.toString()).emit("notification:new", notification);
        }

        res.json({ message: "Devoir rendu avec succès" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

// GET /api/assignments/teacher
// Get all assignments for courses taught by the current user
router.get("/teacher", auth, async (req, res) => {
  try {
    if (req.user.role !== "TEACHER" && req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Accès refusé" });
    }

    // Find courses taught by this user (or all for tracking)
    let query = {};
    if (req.user.role === "TEACHER") {
        const courses = await Course.find({ teacher: req.user.id });
        const courseIds = courses.map(c => c._id);
        query = { course: { $in: courseIds } };
    } else if (req.user.role === "ADMIN") {
        query = {};
    }

    // Find assignments
    const assignments = await Assignment.find(query)
      .populate("course", "title")
      .populate("submissions.student", "username email");

    res.json(assignments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/assignments
// Create a new assignment
router.post("/", auth, upload.single("file"), async (req, res) => {
  try {
    const { title, description, courseId, dueDate, targetClass, type } = req.body;
    const attachmentUrl = req.file ? `/uploads/assignments/${req.file.filename}` : null;

    if (req.user.role !== "TEACHER" && req.user.role !== "ADMIN") {
        return res.status(403).json({ message: "Accès refusé" });
    }

    // Verify course ownership
    let course = await Course.findOne({ _id: courseId, teacher: req.user.id });
    if (!course && req.user.role !== "ADMIN") {
        return res.status(404).json({ message: "Cours introuvable ou non autorisé" });
    }

    // If targetClass is provided, add students of that class to the course
    if (targetClass) {
        const studentsInClass = await User.find({ role: "STUDENT", studentClass: targetClass });
        if (studentsInClass.length > 0) {
            const studentIds = studentsInClass.map(s => s._id);
            // Add to course
            course = await Course.findByIdAndUpdate(
                courseId, 
                { $addToSet: { students: { $each: studentIds } } },
                { new: true } // Return updated course
            );
        }
    }

    const assignment = new Assignment({
      title,
      description,
      type: type || "DEVOIR",
      course: courseId,
      dueDate,
      attachmentUrl
    });

    await assignment.save();

    // Notify Students
    if (course.students && course.students.length > 0) {
        const notifications = course.students.map(studentId => ({
            recipient: studentId,
            type: "ASSIGNMENT_NEW",
            title: "Nouveau devoir",
            message: `Nouveau devoir en ${course.title} : ${title}`,
            relatedId: assignment._id,
            link: "/hall" // Where they can view it
        }));

        await Notification.insertMany(notifications);

        if (req.io) {
            notifications.forEach(n => {
                req.io.to(n.recipient.toString()).emit("notification:new", n);
            });
        }
    }

    res.status(201).json(assignment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// PUT /api/assignments/:id
// Update an assignment
router.put("/:id", auth, upload.single("file"), async (req, res) => {
    try {
        const { title, description, courseId, dueDate, type } = req.body;
        const assignment = await Assignment.findById(req.params.id).populate("course");

        if (!assignment) {
            return res.status(404).json({ message: "Devoir introuvable" });
        }

        // Verify ownership
        if (assignment.course.teacher.toString() !== req.user.id && req.user.role !== "ADMIN") {
            return res.status(403).json({ message: "Non autorisé" });
        }

        if (title) assignment.title = title;
        if (description) assignment.description = description;
        if (dueDate) assignment.dueDate = dueDate;
        if (type) assignment.type = type;
        
        // Changing course is tricky due to submissions linked to students of that course
        // For now, let's allow it but warn or handle it if needed. 
        // Simplest is to allow if provided.
        if (courseId) assignment.course = courseId;

        if (req.file) {
            assignment.attachmentUrl = `/uploads/assignments/${req.file.filename}`;
        }

        await assignment.save();
        res.json(assignment);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

// PUT /api/assignments/:id/grade
// Grade a submission
router.put("/:id/grade", auth, async (req, res) => {
    try {
        const { studentId, grade, feedback } = req.body;
        const assignment = await Assignment.findOne({ 
            _id: req.params.id,
            // Ensure teacher owns the course
            // Complex query, simplify by just checking assignment then course owner
        }).populate("course");

        if (!assignment) return res.status(404).json({ message: "Devoir introuvable" });

        if (assignment.course.teacher.toString() !== req.user.id && req.user.role !== "ADMIN") {
            return res.status(403).json({ message: "Non autorisé" });
        }

        const subIndex = assignment.submissions.findIndex(s => s.student.toString() === studentId);
        if (subIndex === -1) {
            return res.status(404).json({ message: "Soumission introuvable" });
        }

        assignment.submissions[subIndex].grade = grade;
        assignment.submissions[subIndex].feedback = feedback;

        await assignment.save();

        // Notify Student
        const notification = new Notification({
            recipient: studentId,
            type: "GRADE_NEW",
            title: "Devoir noté",
            message: `Votre devoir "${assignment.title}" a été noté : ${grade}/20`,
            relatedId: assignment._id,
            link: "/hall"
        });
        await notification.save();

        if (req.io) {
            req.io.to(studentId.toString()).emit("notification:new", notification);
        }

        res.json(assignment);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

// DELETE /api/assignments/:id
// Delete an assignment
router.delete("/:id", auth, async (req, res) => {
    try {
        const assignment = await Assignment.findById(req.params.id).populate("course");

        if (!assignment) {
            return res.status(404).json({ message: "Devoir introuvable" });
        }

        // Verify ownership (only teacher who owns the course or admin)
        if (assignment.course.teacher.toString() !== req.user.id && req.user.role !== "ADMIN") {
            return res.status(403).json({ message: "Non autorisé" });
        }

        await Assignment.findByIdAndDelete(req.params.id);

        res.json({ message: "Devoir supprimé avec succès" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

export default router;
