// backend/routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

function signToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      isActive: user.isActive,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { fullName, username, email, password, role } = req.body;

    if (!password || String(password).length < 6) {
      return res.status(400).json({ message: "Mot de passe trop court (min 6)" });
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
      passwordHash,
      role: role ? String(role).toUpperCase() : "STUDENT",
      status: "active",
      isActive: true,
      emailVerified: false,
    });

    const token = signToken(user);

    res.json({
      token,
      user: { 
          id: user._id, 
          fullName: user.fullName, 
          username: user.username, 
          email: user.email, 
          role: user.role,
          studentClass: user.studentClass,
          avatar3DUrl: user.avatar3DUrl,
          academicStatus: user.academicStatus
      },
    });
  } catch (e) {
    console.error("register error:", e);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Si "username" est fourni, on cherche par username OU email (pour permettre le login via email)
    const identifier = username || email;
    if (!identifier) return res.status(400).json({ message: "Identifiant manquant" });

    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }],
    });
    if (!user) return res.status(401).json({ message: "Identifiants invalides" });

    if (user.status === "inactive" || user.isActive === false) {
      if (user.role === "TEACHER" && user.emailVerified && user.passwordHash) {
        return res
          .status(403)
          .json({ message: "Compte professeur en attente de validation par l’administrateur." });
      }
      if (user.role === "TEACHER") {
        return res
          .status(403)
          .json({ message: "Compte professeur non activé. Utilise d’abord le lien reçu par email." });
      }
      return res.status(403).json({ message: "Compte inactif." });
    }

    if (!user.passwordHash) {
      return res
        .status(403)
        .json({ message: "Compte incomplet. Termine d’abord l’activation envoyée par email." });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Identifiants invalides" });

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        role: user.role,
        studentClass: user.studentClass,
        avatar3DUrl: user.avatar3DUrl,
        academicStatus: user.academicStatus
      },
    });
  } catch (e) {
    console.error("login error:", e);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// GET /api/auth/teacher/invite-info?token=...
router.get("/teacher/invite-info", async (req, res) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) return res.status(400).json({ message: "Token manquant" });

    const user = await User.findOne({ invitationToken: token });
    if (!user) return res.status(404).json({ message: "Invitation introuvable" });

    if (user.invitationExpiresAt && user.invitationExpiresAt < new Date()) {
      return res.status(410).json({ message: "Lien d’invitation expiré" });
    }

    if (user.isActive) {
      return res.status(409).json({ message: "Ce compte professeur est déjà activé" });
    }

    return res.json({
      email: user.email,
      fullName: user.fullName,
    });
  } catch (e) {
    console.error("invite-info error:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/auth/teacher/complete-invite
router.post("/teacher/complete-invite", async (req, res) => {
  try {
    const { token, password, passwordConfirm, fullName } = req.body || {};

    const cleanToken = String(token || "").trim();
    if (!cleanToken) return res.status(400).json({ message: "Token manquant" });

    if (!password || String(password).length < 8) {
      return res.status(400).json({ message: "Mot de passe trop court (min 8)" });
    }
    if (password !== passwordConfirm) {
      return res.status(400).json({ message: "Les mots de passe ne correspondent pas" });
    }

    const user = await User.findOne({ invitationToken: cleanToken, role: "TEACHER" });
    if (!user) return res.status(404).json({ message: "Invitation introuvable" });

    if (user.invitationExpiresAt && user.invitationExpiresAt < new Date()) {
      return res.status(410).json({ message: "Lien d’invitation expiré" });
    }

    if (user.isActive && user.status === "active" && user.passwordHash) {
      return res.status(409).json({ message: "Ce compte professeur est déjà activé" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    user.passwordHash = passwordHash;
    if (fullName && !user.fullName) {
      user.fullName = String(fullName).trim();
    }
    
    // Générer un username si manquant
    if (!user.username) {
      const nameBase = (user.fullName || "").toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // enlever accents
        .replace(/[^a-z0-9]/g, ""); // garder que alphanum
      user.username = `prof.${nameBase}`;
    }

    user.isActive = false;
    user.status = "inactive";
    user.emailVerified = true;
    user.invitationToken = null;
    user.invitationExpiresAt = null;

    await user.save();

    return res.json({
      ok: true,
      message: "Compte professeur complété. En attente de validation par l’administrateur.",
    });
  } catch (e) {
    console.error("complete-invite error:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

export default router;
