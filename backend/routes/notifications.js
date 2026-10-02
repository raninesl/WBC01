import express from "express";
import { auth } from "../middleware/auth.js";
import Notification from "../models/Notification.js";

const router = express.Router();

// GET /api/notifications
// Get my notifications
router.get("/", auth, async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(notifications);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// PUT /api/notifications/:id/read
// Mark as read
router.put("/:id/read", auth, async (req, res) => {
  try {
    const notification = await Notification.findOne({ _id: req.params.id, recipient: req.user.id });
    if (!notification) return res.status(404).json({ message: "Notification introuvable" });

    notification.read = true;
    await notification.save();
    res.json(notification);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// PUT /api/notifications/read-all
// Mark all as read
router.put("/read-all", auth, async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user.id, read: false },
      { $set: { read: true } }
    );
    res.json({ message: "Tout marqué comme lu" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/notifications/send
// Send a manual notification (message)
router.post("/send", auth, async (req, res) => {
    try {
        if (req.user.role !== "TEACHER" && req.user.role !== "ADMIN") {
            return res.status(403).json({ message: "Accès refusé" });
        }

        const { recipient, title, message, type } = req.body;

        const notification = new Notification({
            recipient,
            type: type || "MESSAGE",
            title,
            message,
            relatedId: req.user.id, // From teacher
            link: "/hall" // Default link
        });

        await notification.save();

        if (req.io) {
            req.io.to(recipient.toString()).emit("notification:new", notification);
        }

        res.status(201).json(notification);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

export default router;
