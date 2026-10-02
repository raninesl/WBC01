// backend/routes/feed.js
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

import { auth } from "../middleware/auth.js";
import Post from "../models/Post.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// stockage local
const uploadDir = path.join(__dirname, "..", "uploads");
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`),
});
const upload = multer({ storage });

// GET /api/feed
router.get("/", auth, async (req, res) => {
  try {
    // Si un scope spécifique est demandé, on l'utilise (filtre explicite)
    // Sinon, on applique la logique "intelligente"
    const specificScope = req.query.scope ? String(req.query.scope).toUpperCase() : null;

    let filter = {};

    if (specificScope) {
      // Cas 1 : Filtre explicite demandé par l'utilisateur
      if (specificScope === "ALL") {
        const currentUser = await User.findById(req.user.id).select("role");
        if (currentUser?.role === "ADMIN") {
          filter = {};
        } else {
          return res.status(403).json({ message: "Non autorisé" });
        }
      } else {
        filter = { scope: specificScope };
      }
    } else {
      // Cas 2 : Affichage par défaut (Feed principal)
      const currentUser = await User.findById(req.user.id).select("role studentClass");

      // ADMIN : voit tout le feed
      if (currentUser?.role === "ADMIN") {
        filter = {};
      } else {
        const conditions = [
          { scope: "GLOBAL" },
          { author: req.user.id } // Je vois toujours ce que je poste
        ];

        // Ajouter la classe de l'utilisateur si elle existe
        if (currentUser?.studentClass) {
          conditions.push({ scope: currentUser.studentClass });
        }

        filter = { $or: conditions };
      }
    }

    const posts = await Post.find(filter)
      .populate("author", "username email role")
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(posts);
  } catch (e) {
    console.error("feed get error:", e);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/feed (message simple)
router.post("/", auth, async (req, res) => {
  try {
    const { content, scope, type } = req.body;
    if (!content || !String(content).trim()) return res.status(400).json({ message: "Contenu vide" });

    const post = await Post.create({
      content: String(content).trim(),
      scope: String(scope || "GLOBAL").toUpperCase(),
      type: String(type || "STATUS").toUpperCase(),
      author: req.user.id,
    });

    const populated = await Post.findById(post._id).populate("author", "username email role avatar3DUrl");

    // Notify if Teacher/Admin posts
    if (req.user.role === "TEACHER" || req.user.role === "ADMIN") {
        try {
            // Notify all users except author
            const users = await User.find({ _id: { $ne: req.user.id }, isActive: true });
            
            if (users.length > 0) {
                const notifications = users.map(u => ({
                    recipient: u._id,
                    type: "FEED_NEW",
                    title: "Nouveau post",
                    message: `${req.user.username || "Un enseignant"} a posté un message.`,
                    relatedId: post._id,
                    link: "/feed.html"
                }));

                await Notification.insertMany(notifications);

                if (req.io) {
                    notifications.forEach(n => {
                        req.io.to(n.recipient.toString()).emit("notification:new", n);
                    });
                }
            }
        } catch (notifErr) {
            console.error("Error creating feed notifications (simple):", notifErr);
        }
    }

    res.json(populated);
  } catch (e) {
    console.error("feed post error:", e);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/feed/upload (pièce jointe + contenu)
router.post("/upload", auth, upload.single("file"), async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();
    const scope = String(req.body.scope || "GLOBAL").toUpperCase();
    const type = String(req.body.type || "STATUS").toUpperCase();

    if (!content && !req.file) return res.status(400).json({ message: "Message ou fichier requis" });

    const attachment = req.file
      ? {
          filename: req.file.filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
          url: `/uploads/${req.file.filename}`,
        }
      : undefined;

    const post = await Post.create({
      content,
      scope,
      type,
      author: req.user.id,
      attachment,
    });

    const populated = await Post.findById(post._id).populate("author", "username email role avatar3DUrl");

    // Notify if Teacher/Admin posts
    if (req.user.role === "TEACHER" || req.user.role === "ADMIN") {
        try {
            // Notify all users except author
            const users = await User.find({ _id: { $ne: req.user.id }, isActive: true });
            
            if (users.length > 0) {
                const notifications = users.map(u => ({
                    recipient: u._id,
                    type: "FEED_NEW",
                    title: "Nouveau post",
                    message: `${req.user.username || "Un enseignant"} a posté un fichier.`,
                    relatedId: post._id,
                    link: "/feed.html"
                }));

                await Notification.insertMany(notifications);

                if (req.io) {
                    notifications.forEach(n => {
                        req.io.to(n.recipient.toString()).emit("notification:new", n);
                    });
                }
            }
        } catch (notifErr) {
            console.error("Error creating feed notifications (upload):", notifErr);
        }
    }

    res.json(populated);
  } catch (e) {
    console.error("feed upload error:", e);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// DELETE /api/feed/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post introuvable" });

    // Verify ownership or admin role
    if (post.author.toString() !== req.user.id && req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Non autorisé" });
    }

    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: "Post supprimé" });
  } catch (e) {
    console.error("feed delete error:", e);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

export default router;
