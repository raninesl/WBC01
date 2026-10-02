// backend/routes/chatbot.js
import express from "express";
import { auth } from "../middleware/auth.js";
import ChatMessage from "../models/ChatMessage.js";
import User from "../models/User.js";
import { getUserSchedule, formatScheduleForLLM, tryAnswerPlanningQuery } from "../services/formationBot.js";
import { getLLMAnswer } from "../services/llmService.js";
import Assignment from "../models/Assignment.js";
import mongoose from "mongoose";

const router = express.Router();

function safeObjectId(id) {
  if (!id) return null;
  try {
    if (id instanceof mongoose.Types.ObjectId) return id;
    if (typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id)) {
      return new mongoose.Types.ObjectId(id);
    }
    return null;
  } catch {
    return null;
  }
}

function detectUserLanguage(text) {
  const raw = String(text || "").trim();
  const t = raw.toLowerCase();

  const hasArabicScript = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(raw);
  if (hasArabicScript) {
    return {
      code: "ar",
      label: "arabe",
      instruction:
        "Réponds en arabe. Si l'utilisateur est tunisien, utilise un style tunisien (darija) simple et clair."
    };
  }

  const arabiziKeywords = [
    "3lech", "3lach", "3la", "3andi", "3andek", "3andkom", "ya3ni",
    "7aja", "7keya", "7atta", "7atta", "7keyet",
    "9addech", "9adeh", "9al", "9olt", "9alek", "9alou",
    "barcha", "chnia", "chnoua", "chniya", "shnowa", "winek", "kifach",
    "mouch", "mch", "mashi", "hakka", "wesh", "wsh"
  ];
  const hasArabiziDigit = /[235789]/.test(raw);
  const hasLatin = /[a-zA-Z]/.test(raw);
  const hasArabiziKeyword = new RegExp(`\\b(${arabiziKeywords.join("|")})\\b`, "i").test(raw);

  if ((hasLatin && hasArabiziDigit) || hasArabiziKeyword) {
    return {
      code: "tn_arabizi",
      label: "tunisien (arabizi)",
      instruction:
        "Réponds en tunisien (darija) en alphabet latin. Si l'utilisateur écrit en arabizi, conserve le style arabizi avec chiffres (2/3/5/7/9) quand c'est naturel."
    };
  }

  const hasFrenchChars = /[àâçéèêëîïôùûüÿœæ]/i.test(raw);
  const frWords = /\b(bonjour|salut|merci|svp|s'il te plaît|s'il vous plaît|je|tu|vous|comment|pourquoi|où|quand|est-ce|c'est|d'accord)\b/i.test(raw);
  const enWords = /\b(hello|hi|thanks|please|what|why|where|when|how|can you|could you|i need|i want)\b/i.test(raw);

  if (hasFrenchChars || (frWords && !enWords)) {
    return {
      code: "fr",
      label: "français",
      instruction: "Réponds en français."
    };
  }

  if (enWords) {
    return {
      code: "en",
      label: "anglais",
      instruction: "Reply in English."
    };
  }

  return {
    code: "fr",
    label: "français (par défaut)",
    instruction:
      "Réponds en français. Si l'utilisateur répond clairement dans une autre langue, adapte-toi."
  };
}

/**
 * GET /api/chatbot/conversations
 * Liste les sessions de conversation uniques de l'utilisateur
 */
router.get("/conversations", auth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const oid = safeObjectId(userId);
    if (!oid) return res.status(400).json({ message: "Identifiant utilisateur invalide" });

    console.log(`[Chatbot] Fetching conversations for user: ${userId}`);
    
    const conversations = await ChatMessage.aggregate([
      { $match: { userId: oid } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$conversationId",
          title: { $first: "$conversationTitle" },
          lastMessage: { $first: "$content" },
          updatedAt: { $first: "$createdAt" }
        }
      },
      { $sort: { updatedAt: -1 } }
    ]);

    console.log(`[Chatbot] Found ${conversations.length} conversations`);
    res.json(conversations);
  } catch (err) {
    console.error("Get conversations error:", err);
    res.status(500).json({ message: "Erreur lors de la récupération des conversations" });
  }
});

/**
 * GET /api/chatbot/history/:conversationId
 * Récupère les messages d'une session spécifique
 */
router.get("/history/:conversationId", auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    
    const messages = await ChatMessage.find({ userId, conversationId })
      .sort({ createdAt: 1 });
      
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: "Erreur chargement messages" });
  }
});

function getUserId(req) {
  const u = req.user || {};
  return u.id || u._id || u.userId || (u.user && (u.user.id || u.user._id));
}

/**
 * GET /api/chatbot/health
 */
router.get("/health", async (req, res) => {
  res.json({ ok: true });
});

/**
 * GET /api/chatbot/history
 * Historique (dernier 60 messages)
 */
router.get("/history", auth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Non autorisé" });

    const msgs = await ChatMessage.find({ userId })
      .sort({ createdAt: 1 })
      .limit(60)
      .lean();

    res.json(msgs);
  } catch (err) {
    console.error("GET /api/chatbot/history error:", err.message);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * DELETE /api/chatbot/history
 * Efface l'historique global de l'utilisateur
 */
router.delete("/history", auth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Non autorisé" });

    await ChatMessage.deleteMany({ userId });
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/chatbot/history error:", err.message);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * DELETE /api/chatbot/history/:conversationId
 * Supprime une conversation spécifique
 */
router.delete("/history/:conversationId", auth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Non autorisé" });
    const { conversationId } = req.params;
    if (!conversationId) return res.status(400).json({ message: "conversationId manquant" });

    await ChatMessage.deleteMany({ userId, conversationId });
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/chatbot/history/:conversationId error:", err.message);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});


/**
 * ✅ POST /api/chatbot
 * Envoi message + sauvegarde
 */
router.post("/", auth, async (req, res) => {
  const { message, conversationId, conversationTitle } = req.body;

  if (!message || String(message).trim().length < 2) {
    return res.status(400).json({ message: "Message invalide" });
  }

  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Non autorisé" });

  const cleanMsg = String(message).trim();

  try {
    const detectedLang = detectUserLanguage(cleanMsg);
    const languagePolicy = `LANGUAGE POLICY (STRICT):
- You MUST reply ONLY in the language of the user's last message.
- Detected language for the user's last message: ${detectedLang.label}.
- Instruction: ${detectedLang.instruction}
- Do NOT mix languages in the same answer.
- Keep proper nouns (WES'SUP, names of formations) as-is.
- If you show dates/times, format them naturally in the reply language.`;

    await ChatMessage.create({ 
      userId, 
      role: "user", 
      content: cleanMsg, 
      conversationId: conversationId || "default",
      conversationTitle: conversationTitle || "Nouvelle discussion"
    });

    // 1. Charger infos user AU PLUS VITE (avant pré-processing planning)
    const user = await User.findById(userId)
      .select("username fullName role formation track studentClass academicStatus")
      .lean();

    // ==================================================================
    // 🚀 PRE-PROCESSING SANS LLM : DÉTECTION QUESTIONS DE PLANNING
    // (Évite 100% des hallucinations sur les emplois du temps / examens)
    // ==================================================================
    const quickPlanning = await tryAnswerPlanningQuery(
      cleanMsg,
      userId,
      user ? {
        formation: user.formation,
        track: user.track,
        studentClass: user.studentClass,
        role: user.role
      } : null
    );

    if (quickPlanning && quickPlanning.answered === true) {
      const botMessage = await ChatMessage.create({
        userId,
        role: "bot",
        content: quickPlanning.answer,
        conversationId: conversationId || "default",
        conversationTitle: conversationTitle || "Nouvelle discussion"
      });
      return res.json({
        answer: quickPlanning.answer,
        preformatted: true,
        planningResponse: true
      });
    }

    // On récupère l'historique de cette session spécifique
    const history = await ChatMessage.find({ 
      userId, 
      conversationId: conversationId || "default" 
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    
    // Inverser pour avoir l'ordre chronologique
    const sortedHistory = history.reverse();

    // Récupérer les notes de l'étudiant
    const assignments = await Assignment.find({
      "submissions.student": userId
    }).select("title submissions course");

    const gradesInfo = assignments.map(a => {
      const sub = a.submissions.find(s => String(s.student) === String(userId));
      return {
        titre: a.title,
        note: sub?.grade !== undefined ? `${sub.grade}/20` : "Non noté",
        feedback: sub?.feedback || ""
      };
    });

    // Préparer les absences détaillées
    const absencesInfo = (user.academicStatus?.activeEmojis || [])
      .filter(e => e.absences > 0)
      .map(e => ({
        matiere: e.subject,
        nombre: e.absences,
        details: (e.absenceDetails || []).map(d => new Date(d.date).toLocaleString('fr-FR'))
      }));

    // 📅 --- RÉCUPÉRATION DYNAMIQUE DE L'EMPLOI DU TEMPS VIA LA DB ---
    const scheduleObj = await getUserSchedule({
      formation: user?.formation,
      track: user?.track,
      studentClass: user?.studentClass
    }, userId);

    const scheduleText = formatScheduleForLLM(scheduleObj);
    const scheduleJson = scheduleObj
      ? JSON.stringify({
          className: scheduleObj.className,
          displayName: scheduleObj.displayName,
          emploi_du_temps: scheduleObj.emploi_du_temps,
          examens_a_venir: scheduleObj.exams?.upcoming || [],
          source: scheduleObj.source
        }, null, 2)
      : "Aucun emploi du temps trouvé pour cet étudiant.";

    const scheduleClassName = scheduleObj?.className || "";
    const scheduleDisplayName = scheduleObj?.displayName || "";

    const systemPrompt = `${languagePolicy}

Tu es l'assistant officiel du campus WES'SUP. 
Ta mission est d'aider les étudiants, futurs étudiants et visiteurs à obtenir des informations précises concernant les formations, l'orientation, les débouchés professionnels, l'alternance et la vie académique du campus.

PRÉSENTATION DE L'ÉTABLISSEMENT :
WES'SUP propose actuellement les formations suivantes : 
- BTS MCO (Management Commercial Opérationnel) 
- BTS CG (Comptabilité et Gestion) 
- Mastère Management et Stratégie d'Entreprise (MSE)

CONNAISSANCES SUR LES FORMATIONS :
- BTS MCO : Gérer une unité commerciale, développer les ventes, manager une équipe. Débouchés : Conseiller commercial, Responsable de magasin, Manager de rayon. Compétences : Vente, Négociation, Marketing.
- BTS CG : Suivi comptable, opérations financières, contrôle de gestion. Débouchés : Assistant comptable, Gestionnaire administratif, Collaborateur de cabinet. Compétences : Comptabilité, Fiscalité, Analyse financière.
- Mastère MSE : Encadrement et pilotage stratégique. Débouchés : Chef de projet, Manager d'équipe, Responsable développement, Directeur opérationnel. Compétences : Stratégie, Leadership, Gestion de projet.

ORIENTATION :
- Commerce/Vente/Management => BTS MCO.
- Comptabilité/Gestion/Chiffres => BTS CG.
- Fonctions managériales/stratégiques (si déjà diplômé) => Mastère MSE.
Pose des questions complémentaires avant de faire une recommandation.

ALTERNANCE ET DÉBOUCHÉS :
Explique les avantages, la recherche d'entreprise, la préparation du CV/entretien. Pour un métier demandé, explique les missions, compétences et la formation WES'SUP adaptée.

LIMITES ET COMPORTEMENT :
- Sois professionnel et pédagogique.
- Si l'information est inconnue, indique-le honnêtement. N'invente jamais de chiffres ou dates.
- Pour les frais de scolarité, inscriptions, résultats d'examens ou infos confidentielles, invite l'utilisateur à contacter l'ADMINISTRATION.

INFOS UTILISATEUR CONNECTÉ :
- Nom complet : ${user?.fullName || user?.username || "Visiteur"}
- Pseudo (username) : ${user?.username || "Non défini"}
- Formation profil : ${user?.formation || "Non définie"}
- Filière (track) : ${user?.track || "Non définie"}
- Classe profil (studentClass) : ${user?.studentClass || "Non définie"}

---
📅 EMPLOI DU TEMPS PERSONNALISÉ DE L'ÉTUDIANT (données dynamiques) :
Nom de l'emploi du temps associé : ${scheduleDisplayName || scheduleClassName || "Aucun"}
Correspondance (className) : ${scheduleClassName || "Non trouvée"}

${scheduleText || "Aucun emploi du temps enregistré pour cette classe."}

---
📋 DONNÉES DÉTAILLÉES STRUCTURÉES (pour JSON si demandé) :
${scheduleJson}

---
⚠️ INSTRUCTIONS SPÉCIALES POUR LES QUESTIONS DE PLANNING :
1. Si l'utilisateur demande "Quel est mon planning ?", "Mon emploi du temps", "Mes cours" :
   - Utilise EXCLUSIVEMENT les données ci-dessus dans "EMPLOI DU TEMPS PERSONNALISÉ"
   - Affiche UNIQUEMENT les jours où il y a des cours
   - Pour CHAQUE cours : mentionne l'HEURE, LA MATIÈRE, et si disponible le PROFESSEUR et la SALLE
   
2. Si l'utilisateur demande pour un JOUR PRÉCIS ("Qu'ai-je lundi ?", "Cours de jeudi") :
   - Réponds UNIQUEMENT pour CE jour
   - Si aucun cours ce jour-là : précise-le clairement

3. Si l'utilisateur demande les MATIÈRES qu'il étudie :
   - Liste toutes les matières UNIQUES présentes dans son emploi du temps de la semaine
   - Peut également préciser quels jours il a chaque matière

4. Si l'utilisateur demande les EXAMENS, "Quand ai-je examen ?", "Planning des examens" :
   - Parle D'ABORD des examens À VENIR (section "PROCHAINS EXAMENS / CONTRÔLES")
   - Pour CHAQUE examen : DATE complète, HEURE, MATIÈRE, TYPE (DS/CC/final/oral), SALLE si dispo
   - S'il n'y a AUCUN examen programmé : précise que rien n'est prévu actuellement, invite à vérifier avec l'administration

5. Si AUCUN emploi du temps ne correspond à sa classe :
   - Explique clairement que l'administration n'a pas encore renseigné son emploi du temps
   - Ne donne PAS de planning générique
   - Conseille de contacter l'administration ou de revenir plus tard

---
NOTES DE L'ÉTUDIANT (si disponibles) :
${gradesInfo.length > 0
  ? gradesInfo.map(g => `- ${g.titre} : ${g.note}${g.feedback ? " (Feedback: " + g.feedback + ")" : ""}`).join("\n")
  : "Aucune note disponible pour le moment."
}

ABSENCES PAR MATIÈRE :
${absencesInfo.length > 0
  ? absencesInfo.map(a => `- ${a.matiere} : ${a.nombre} absence(s)`).join("\n")
  : "Aucune absence enregistrée."
}

Si l'utilisateur demande son planning, utilise ses infos de profil pour chercher dans EMPLOI DU TEMPS PERSONNALISÉ. Si rien n'est trouvé, explique que l'administration n'a pas encore configuré son emploi du temps.`;

    // On essaie d'abord d'obtenir une réponse du LLM
    const answer = await getLLMAnswer(cleanMsg, sortedHistory, systemPrompt);

    await ChatMessage.create({ 
      userId, 
      role: "bot", 
      content: answer, 
      conversationId: conversationId || "default",
      conversationTitle: conversationTitle || "Nouvelle discussion"
    });

    return res.json({ answer });
  } catch (err) {
    console.error("POST /api/chatbot error:", err.message);
    return res.status(500).json({ message: "Erreur IA" });
  }
});

export default router;
