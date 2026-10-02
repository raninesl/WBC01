// backend/routes/avatar-proxy.js
import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// Middleware pour s'assurer que l'URL est valide et autorisée
const validateUrl = (req, res, next) => {
  const { url } = req.query;
  const allowedDomains = [
    "models.readyplayer.me",
    "render.avaturn.me",
    "files.avaturn.dev",
    "api.avaturn.me",
    "avaturn.me"
  ];
  
  const isAllowed = allowedDomains.some(domain => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname === domain || urlObj.hostname.endsWith("." + domain);
    } catch (e) {
      return false;
    }
  });
  
  if (!url || !isAllowed) {
    return res.status(400).json({ message: "URL non valide ou non autorisée." });
  }
  next();
};

router.get("/", validateUrl, async (req, res) => {
  try {
    const { url } = req.query;
    console.log(`[Proxy] Récupération de l'avatar : ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Erreur du serveur ReadyPlayerMe: ${response.statusText}`);
    }

    // Récupérer le contenu binaire du modèle .glb
    const buffer = await response.arrayBuffer();

    // Envoyer le buffer avec le bon type de contenu
    res.setHeader("Content-Type", "model/gltf-binary");
    res.send(Buffer.from(buffer));

  } catch (error) {
    console.error("[Proxy] Erreur lors de la récupération de l'avatar:", error);
    res.status(502).json({ message: "Impossible de contacter le service d'avatars." });
  }
});

export default router;
