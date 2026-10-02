// backend/routes/iot.js
import express from "express";
import ClassroomActivity from "../models/ClassroomActivity.js";

const router = express.Router();

// Middleware simple pour la sécurité par clé API
const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === process.env.IOT_API_KEY) {
    next();
  } else {
    res.status(401).json({ message: "Accès non autorisé" });
  }
};

/**
 * POST /api/iot/activity
 * Route pour que la caméra envoie les données d'activité.
 */
router.post("/activity", requireApiKey, async (req, res) => {
  try {
    const { classroomId, movementPercentage } = req.body;

    if (!classroomId || movementPercentage === undefined) {
      return res.status(400).json({ message: "classroomId et movementPercentage sont requis" });
    }

    const activity = await ClassroomActivity.create({
      classroomId,
      movementPercentage,
    });

    // On pourrait aussi émettre un événement socket.io ici pour le dashboard admin
    if (req.io) {
        req.io.to('admin_dashboard').emit('iot:new_activity', activity);
    }

    res.status(201).json(activity);
  } catch (error) {
    console.error("Erreur lors de la sauvegarde de l'activité IoT :", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * GET /api/iot/activity/:classroomId
 * Récupère les dernières données d'activité pour une classe donnée.
 */
router.get("/activity/:classroomId", async (req, res) => {
    try {
        const { classroomId } = req.params;
        const activities = await ClassroomActivity.find({ classroomId })
            .sort({ createdAt: -1 })
            .limit(100); // On récupère les 100 dernières mesures

        res.json(activities);
    } catch (error) {
        console.error("Erreur lors de la récupération de l'activité IoT :", error);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

export default router;