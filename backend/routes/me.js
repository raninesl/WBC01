// backend/routes/me.js
import express from "express";
import { auth } from "../middleware/auth.js";
import User from "../models/User.js";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { Readable } from "stream";
import { getUserSchedule, formatScheduleForLLM } from "../services/formationBot.js";

const router = express.Router();

/**
 * GET /api/me
 */
router.get("/", auth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId).select("-passwordHash");
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
    return res.json(user);
  } catch (e) {
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * GET /api/me/avatar
 */
router.get("/avatar", auth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId).select("avatar3DUrl avatarConfig");
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
    return res.json({ 
      avatar3DUrl: user.avatar3DUrl || "",
      avatarConfig: user.avatarConfig
    });
  } catch (e) {
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * PUT /api/me/avatar
 */
router.put("/avatar", auth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { avatar3DUrl, avatarConfig } = req.body;

    const updateData = {};
    if (avatar3DUrl) updateData.avatar3DUrl = avatar3DUrl;
    if (avatarConfig) updateData.avatarConfig = avatarConfig;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "Aucune donnée de mise à jour fournie" });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, select: "avatar3DUrl avatarConfig" }
    );

    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });

    return res.json({ ok: true, avatar3DUrl: user.avatar3DUrl, avatarConfig: user.avatarConfig });
  } catch (e) {
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// 📅 GET /api/me/schedule - Mon emploi du temps (cours + examens)
router.get("/schedule", auth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId).select("formation track studentClass role username fullName");
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });

    const schedule = await getUserSchedule({
      formation: user.formation,
      track: user.track,
      studentClass: user.studentClass
    }, userId);

    if (!schedule) {
      return res.json({
        ok: true,
        found: false,
        message:
          "Aucun emploi du temps configuré pour ta classe. L'administration doit d'abord l'ajouter.",
        profile: {
          formation: user.formation,
          track: user.track,
          studentClass: user.studentClass
        },
        emploi_du_temps: {},
        exams: { all: [], upcoming: [], past: [] }
      });
    }

    return res.json({
      ok: true,
      found: true,
      profile: {
        formation: user.formation,
        track: user.track,
        studentClass: user.studentClass
      },
      className: schedule.className,
      displayName: schedule.displayName,
      source: schedule.source,
      semaineType: schedule.semaineType,
      emploi_du_temps: schedule.emploi_du_temps,
      exams: schedule.exams,
      formattedText: formatScheduleForLLM(schedule)
    });
  } catch (e) {
    console.error("GET /api/me/schedule error:", e.message);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.post("/avatar/import", auth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { url } = req.body || {};

    const inputUrl = String(url || "").trim();
    if (!inputUrl) return res.status(400).json({ message: "url est requis" });
    if (!/^https?:\/\//i.test(inputUrl)) return res.status(400).json({ message: "URL invalide" });

    const allowedPrefixes = (process.env.AVATAR_IMPORT_ALLOWLIST || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (allowedPrefixes.length > 0 && !allowedPrefixes.some((p) => inputUrl.startsWith(p))) {
      return res.status(400).json({ message: "Domaine non autorisé" });
    }

    const response = await fetch(inputUrl);
    if (!response.ok) return res.status(502).json({ message: "Impossible de récupérer l'avatar" });

    const contentLengthHeader = response.headers.get("content-length");
    const maxBytes = 25 * 1024 * 1024;
    if (contentLengthHeader) {
      const n = Number(contentLengthHeader);
      if (Number.isFinite(n) && n > maxBytes) {
        return res.status(413).json({ message: "Fichier trop volumineux" });
      }
    }

    const urlPath = new URL(inputUrl).pathname.toLowerCase();
    const ext = urlPath.endsWith(".vrm") ? ".vrm" : urlPath.endsWith(".gltf") ? ".gltf" : ".glb";
    const filename = `${userId}-${crypto.randomUUID()}${ext}`;

    const uploadsDir = path.join(process.cwd(), "uploads", "avatars");
    await fsp.mkdir(uploadsDir, { recursive: true });
    const filePath = path.join(uploadsDir, filename);

    const writer = fs.createWriteStream(filePath);

    const bodyStream = response.body && typeof response.body.pipe === "function"
      ? response.body
      : Readable.fromWeb(response.body);

    let written = 0;
    await new Promise((resolve, reject) => {
      bodyStream.on("data", (chunk) => {
        written += chunk.length;
        if (written > maxBytes) {
          writer.destroy(new Error("File too large"));
          bodyStream.destroy(new Error("File too large"));
        }
      });
      bodyStream.on("error", reject);
      writer.on("error", reject);
      writer.on("finish", resolve);
      bodyStream.pipe(writer);
    });

    const publicUrl = `/uploads/avatars/${filename}`;
    const user = await User.findByIdAndUpdate(
      userId,
      { avatar3DUrl: publicUrl },
      { new: true, select: "avatar3DUrl avatarConfig" }
    );

    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });

    return res.json({ ok: true, avatar3DUrl: user.avatar3DUrl, avatarConfig: user.avatarConfig });
  } catch (e) {
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

export default router;
