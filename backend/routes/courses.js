import express from "express";
import { auth } from "../middleware/auth.js";
import Course from "../models/Course.js";
import User from "../models/User.js";
import multer from "multer";
import fs from "fs";
import path from "path";

// Configure Multer for Course Supports
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = "uploads/supports";
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

const router = express.Router();

// GET /api/courses/my-courses
// Returns courses where the user is a teacher or a student
router.get("/my-courses", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    let query = {};
    if (user.role === "TEACHER") {
      query = { teacher: userId };
    } else if (user.role === "ADMIN") {
      query = {};
    } else if (user.role === "STUDENT") {
      query = { students: userId };
    }

    const courses = await Course.find(query)
      .populate("teacher", "username email")
      .populate("students", "username email");

    res.json(courses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/courses
// Create a new course (Teacher or Admin)
router.post("/", auth, upload.single("supportFile"), async (req, res) => {
  try {
    const { title, description, schedule, location, status, targetClass } = req.body;
    
    // Check role
    // const user = await User.findById(req.user.id);
    // if (user.role !== "TEACHER" && user.role !== "ADMIN") {
    //   return res.status(403).json({ message: "Non autorisé" });
    // }

    let studentIds = [];
    if (targetClass) {
        const students = await User.find({ role: "STUDENT", studentClass: targetClass });
        studentIds = students.map(s => s._id);
    }

    const newCourse = new Course({
      title,
      description,
      schedule,
      location,
      status,
      teacher: req.user.id, // The creator is the teacher by default for now
      students: studentIds,
      supportUrl: req.file ? `/uploads/supports/${req.file.filename}` : null
    });

    await newCourse.save();
    res.status(201).json(newCourse);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// PUT /api/courses/:id
// Update a course
router.put("/:id", auth, upload.single("supportFile"), async (req, res) => {
  try {
    const { title, description, schedule, location, status, targetClass } = req.body;
    const courseId = req.params.id;

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ message: "Cours introuvable" });

    // Security: only teacher or admin
    if (course.teacher.toString() !== req.user.id && req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Non autorisé" });
    }

    if (title) course.title = title;
    if (description) course.description = description;
    if (schedule) course.schedule = schedule;
    if (location) course.location = location;
    if (status) course.status = status;
    
    if (targetClass) {
        const students = await User.find({ role: "STUDENT", studentClass: targetClass });
        course.students = students.map(s => s._id);
    }

    if (req.file) {
      course.supportUrl = `/uploads/supports/${req.file.filename}`;
    }

    await course.save();
    res.json(course);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// DELETE /api/courses/:id
// Delete a course
router.delete("/:id", auth, async (req, res) => {
  try {
    const courseId = req.params.id;
    const course = await Course.findById(courseId);

    if (!course) return res.status(404).json({ message: "Cours introuvable" });

    // Security: only teacher or admin
    if (course.teacher.toString() !== req.user.id && req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Non autorisé" });
    }

    await Course.findByIdAndDelete(courseId);
    res.json({ message: "Cours supprimé avec succès" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

export default router;
