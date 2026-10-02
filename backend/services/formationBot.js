import Schedule from "../models/Schedule.js";

/**
 * Base de données des formations et emplois du temps de Wes'sup
 * (legacy - fallback si rien en DB)
 */
export const FORMATIONS = {
  "BTS CG 2": {
    nom: "BTS Comptabilité et Gestion - 2ème année",
    emploi_du_temps: {
      lundi: [
        { heure: "09:00 - 12:00", matiere: "P1 plus P2", professeur: "M. COHAS" },
        { heure: "13:30 - 17:30", matiere: "P3 plus P4", professeur: "M. COHAS" }
      ],
      mardi: [
        { heure: "09:00 - 12:30", matiere: "Culture Générale et Expression", professeur: "Mme. FABIÉ" },
        { heure: "13:30 - 15:30", matiere: "Culture Économique, Juridique et Managériale", professeur: "M. LEMRAZI" },
        { heure: "15:30 - 17:30", matiere: "Anglais LV1", professeur: "Mme. GEDGE" }
      ]
    }
  },
  "B3 Finance": {
    nom: "Bachelor 3 Finance",
    emploi_du_temps: {
      lundi: [
        { heure: "09:00 - 12:30", matiere: "P1 plus P2", professeur: "M. COHAS" },
        { heure: "13:30 - 16:30", matiere: "P3 plus P1", professeur: "M. COHAS" }
      ],
      mardi: [
        { heure: "13:00 - 16:00", matiere: "B3 Contrôle de Gestion", professeur: "M. COHAS" }
      ],
      jeudi: [
        { heure: "09:00 - 12:00", matiere: "Anglais LV1", professeur: "M. TARANTINO" },
        { heure: "13:30 - 16:30", matiere: "Méthodologie", professeur: "Mme. FADHLOUN" }
      ]
    }
  },
  "BTS 1 MCO": {
    nom: "BTS Management Commercial Opérationnel - 1ère année",
    emploi_du_temps: {
      lundi: [
        { heure: "09:00 - 12:30", matiere: "Animation et dynamisation de l'offre commerciale", professeur: "M. MARION-DEMETZ" },
        { heure: "13:30 - 16:30", matiere: "Management de l'équipe commerciale", professeur: "M. MARION-DEMETZ" }
      ],
      mardi: [
        { heure: "09:30 - 12:30", matiere: "Culture Générale et Expression", professeur: "Mme. FABIÉ" },
        { heure: "13:30 - 15:30", matiere: "Anglais LV1", professeur: "Mme. GEDGE" },
        { heure: "15:30 - 17:30", matiere: "Culture Économique, Juridique et Management", professeur: "Inconnu" }
      ]
    }
  },
  "MSE 2": {
    nom: "Mastère Stratégie d'Entreprise - 2ème année",
    emploi_du_temps: {
      jeudi: [
        { heure: "09:00 - 12:00", matiere: "Anglais LV1", professeur: "M. IFTIKHAR" },
        { heure: "13:30 - 16:30", matiere: "D52 Thèse Pro", professeur: "Mme. FADHLOUN" }
      ],
      vendredi: [
        { heure: "09:00 - 12:00", matiere: "Gestion Financière - Contrôle Fiscal - Redressement", professeur: "M. COHAS" },
        { heure: "13:30 - 16:30", matiere: "Gestion Financière - Contrôle Fiscal - Redressement", professeur: "M. COHAS" }
      ]
    }
  }
};

const DAYS_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/**
 * Construit les variantes de className à tester à partir du profil utilisateur
 */
export function buildScheduleKeys(userProfile) {
  const { formation = "", track = "", studentClass = "" } = userProfile || {};
  const f = String(formation).trim();
  const t = String(track).trim();
  const sc = String(studentClass).trim();

  const keys = new Set();

  if (f) {
    if (sc) keys.add(`${f} ${sc}`.trim());
    if (t) keys.add(`${f} ${t}`.trim());
    keys.add(f);
  }
  if (t) keys.add(t);
  if (sc) keys.add(sc);
  if (f && t && sc) keys.add(`${f} ${t} ${sc}`.trim());

  return Array.from(keys).filter(Boolean);
}

/**
 * Récupère l'emploi du temps d'un étudiant depuis la DB (fallback sur legacy FORMATIONS)
 */
export async function getUserSchedule(userProfile, userId) {
  const keys = buildScheduleKeys(userProfile);

  // 1. Chercher dans la DB MongoDB (Schedule collection)
  if (keys.length > 0) {
    try {
      const dbSchedule = await Schedule.findOne({
        $or: [
          { className: { $in: keys } },
          ...(userProfile?.formation ? [{
            $and: [
              { formation: userProfile.formation },
              ...(userProfile?.track ? [{ track: userProfile.track }] : []),
              ...(userProfile?.studentClass ? [{ studentClass: userProfile.studentClass }] : [])
            ]
          }] : [])
        ]
      }).sort({ updatedAt: -1 }).lean();

      if (dbSchedule) {
        return normalizeSchedule(dbSchedule, "database");
      }
    } catch (err) {
      console.error("[Schedule] DB lookup error:", err.message);
    }
  }

  // 2. Fallback sur FORMATIONS legacy
  for (const key of keys) {
    if (FORMATIONS[key]) {
      return normalizeLegacy(key, FORMATIONS[key]);
    }
  }

  // 3. Rien trouvé
  return null;
}

function normalizeSchedule(dbDoc, source) {
  const wt = dbDoc.weeklyTimetable || {};
  const timetable = {};
  for (const day of DAYS_FR) {
    if (Array.isArray(wt[day]) && wt[day].length > 0) {
      timetable[day] = wt[day].map((c) => ({
        heure: c.heure || "",
        matiere: c.matiere || "",
        professeur: c.professeur || "",
        salle: c.salle || ""
      }));
    }
  }

  const exams = (Array.isArray(dbDoc.exams) ? dbDoc.exams : [])
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((e) => ({
      date: e.date,
      matiere: e.matiere || "",
      heureDebut: e.heureDebut || "",
      heureFin: e.heureFin || "",
      duree: e.duree || "",
      salle: e.salle || "",
      professeur: e.professeur || "",
      type: e.type || "DS",
      description: e.description || ""
    }));

  const upcoming = exams.filter((e) => new Date(e.date) >= new Date(new Date().setHours(0, 0, 0, 0)));
  const past = exams.filter((e) => new Date(e.date) < new Date(new Date().setHours(0, 0, 0, 0)));

  return {
    source,
    className: dbDoc.className,
    displayName: dbDoc.displayName || dbDoc.className,
    formation: dbDoc.formation || "",
    track: dbDoc.track || "",
    studentClass: dbDoc.studentClass || "",
    semaineType: dbDoc.semaineType || "Toutes",
    emploi_du_temps: timetable,
    exams: {
      all: exams,
      upcoming: upcoming.slice(0, 15),
      past: past.slice(0, 10)
    }
  };
}

function normalizeLegacy(key, legacyData) {
  const wt = legacyData.emploi_du_temps || {};
  const timetable = {};
  for (const day of DAYS_FR) {
    if (Array.isArray(wt[day]) && wt[day].length > 0) {
      timetable[day] = wt[day].map((c) => ({
        heure: c.heure || "",
        matiere: c.matiere || "",
        professeur: c.professeur || "",
        salle: c.salle || ""
      }));
    }
  }
  return {
    source: "legacy",
    className: key,
    displayName: legacyData.nom || key,
    formation: "",
    track: "",
    studentClass: "",
    semaineType: "Toutes",
    emploi_du_temps: timetable,
    exams: { all: [], upcoming: [], past: [] }
  };
}

/**
 * Formatte l'emploi du temps pour le LLM (texte clair)
 */
export function formatScheduleForLLM(schedule) {
  if (!schedule) return "";

  const lines = [];
  lines.push(`📚 EMPLOI DU TEMPS - ${schedule.displayName || schedule.className}`);
  if (schedule.source) lines.push(`(Source: ${schedule.source})`);
  lines.push("---");

  const hasAnyDay = DAYS_FR.some((d) => schedule.emploi_du_temps[d]?.length);
  if (!hasAnyDay) {
    lines.push("Aucun cours enregistré pour cette semaine.");
  } else {
    for (const day of DAYS_FR) {
      const slots = schedule.emploi_du_temps[day];
      if (!slots || slots.length === 0) continue;
      lines.push(`\n[${day.toUpperCase()}]`);
      slots.forEach((s, i) => {
        const prof = s.professeur ? ` - ${s.professeur}` : "";
        const salle = s.salle ? ` (salle ${s.salle})` : "";
        lines.push(`  ${i + 1}. ${s.heure || "?"} — ${s.matiere || "?"}${prof}${salle}`);
      });
    }
  }

  if (schedule.exams?.upcoming?.length) {
    lines.push("\n\n---");
    lines.push(`📝 PROCHAINS EXAMENS / CONTRÔLES (${schedule.exams.upcoming.length})`);
    schedule.exams.upcoming.forEach((e, i) => {
      const d = new Date(e.date).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
      const heure = [e.heureDebut, e.heureFin].filter(Boolean).join(" → ");
      const salle = e.salle ? ` | Salle: ${e.salle}` : "";
      const type = e.type ? ` [${e.type}]` : "";
      lines.push(`  ${i + 1}. ${d}${heure ? ` à ${heure}` : ""}${salle} — ${e.matiere}${type}`);
    });
  }

  return lines.join("\n");
}

// =====================================================
// 📋 FORMATTAGE TABLEAUX MARKDOWN (sans hallucinations !)
// =====================================================

/**
 * Détermine le jour français demandé depuis une question
 * Retourne: null = toute la semaine, string = jour spécifique,
 *          "exams" = liste des examens
 */
export function detectPlanningIntent(message) {
  if (!message) return { type: "week" };

  const msg = String(message).toLowerCase().trim();

  // Examen / Contrôle / Partiel / DS
  if (/\b(examen|exam|contr[oô]le|partiel|ds|examens|not[eé])\b/.test(msg)) {
    if (/\b(pass[ée]|pass[ée]s|ancien|anciens|d[ée]j[àa]|r[ée]alis[ée]|fait)\b/.test(msg)) {
      return { type: "exams", scope: "past" };
    }
    return { type: "exams", scope: "upcoming" };
  }

  // Quelles matières
  if (/\b(quelles mati[èe]res|mati[èe]res qu|mati[èe]res|quels cours|cours que)\b/.test(msg)) {
    return { type: "subjects" };
  }

  // Recherche jour spécifique
  const dayMap = [
    ["lundi", "lundi"],
    ["mardi", "mardi"],
    ["mercredi", "mercredi"],
    ["jeudi", "jeudi"],
    ["vendredi", "vendredi"],
    ["samedi", "samedi"],
    ["dimanche", "dimanche"],
    ["aujourd'hui", "TODAY"],
    ["aujourdhui", "TODAY"],
    ["demain", "TOMORROW"]
  ];

  for (const [pattern, key] of dayMap) {
    const regex = new RegExp(`(^|\\s|[^a-zàâäéèêëîïôöùûüÿçœæ])${pattern}($|\\s|[^a-zàâäéèêëîïôöùûüÿçœæ])`, "i");
    if (regex.test(msg)) {
      if (key === "TODAY" || key === "TOMORROW") {
        const baseDate = new Date();
        if (key === "TOMORROW") baseDate.setDate(baseDate.getDate() + 1);
        const jsDay = baseDate.getDay(); // 0 = dimanche, 1 = lundi...
        const idx = jsDay === 0 ? 6 : jsDay - 1;
        return { type: "day", day: DAYS_FR[idx], date: baseDate };
      }
      return { type: "day", day: key };
    }
  }

  // Par défaut : semaine entière
  // mais s'il contient "cours aujourd'hui / du jour / que j'ai"
  if (/\b(aujourd'hui|du jour|ce jour|que j'ai aujourd|journ[ée]e)\b/.test(msg)) {
    const d = new Date();
    const jsDay = d.getDay();
    const idx = jsDay === 0 ? 6 : jsDay - 1;
    return { type: "day", day: DAYS_FR[idx], date: d };
  }

  if (/\b(demain|lendemain)\b/.test(msg)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const jsDay = d.getDay();
    const idx = jsDay === 0 ? 6 : jsDay - 1;
    return { type: "day", day: DAYS_FR[idx], date: d };
  }

  return { type: "week" };
}

/**
 * Formatte UN JOUR sous forme de tableau Markdown
 */
export function formatDayTableMarkdown(schedule, dayKey, dateLabel) {
  const slots = schedule?.emploi_du_temps?.[dayKey] || [];
  const dayName = DAYS_FR.find(d => d === dayKey) || dayKey;
  const title = dateLabel
    ? `📅 ${dateLabel} — ${dayName.charAt(0).toUpperCase() + dayName.slice(1)}`
    : `📅 ${dayName.charAt(0).toUpperCase() + dayName.slice(1)}`;

  if (slots.length === 0) {
    return `${title}\n\nℹ️ Aucun cours prévu ${dateLabel ? "ce jour-là" : `ce ${dayName}`}. Profite de ta journée !`;
  }

  const lines = [];
  lines.push(`**${title}**`);
  lines.push("");
  lines.push("| Heure | Matière | Professeur | Salle |");
  lines.push("|:----- |:------- |:---------- |:----- |");

  slots.forEach((s) => {
    lines.push(
      `| ${escapeMd(s.heure || "—")} | ${escapeMd(s.matiere || "—")} | ${escapeMd(s.professeur || "—")} | ${escapeMd(s.salle || "—")} |`
    );
  });

  lines.push("");
  lines.push(`_${slots.length} créneau(x) de cours pour ce jour._`);

  return lines.join("\n");
}

/**
 * Formatte la SEMAINE ENTIÈRE sous forme de tableaux Markdown (1 tableau / jour)
 */
export function formatWeekTableMarkdown(schedule) {
  const out = [];
  out.push(`# 📚 Planning hebdomadaire — ${escapeMd(schedule.displayName || schedule.className)}`);
  out.push("");

  let totalSlots = 0;
  const daysWithCourses = [];

  for (const d of DAYS_FR) {
    const slots = schedule.emploi_du_temps?.[d] || [];
    if (slots.length > 0) daysWithCourses.push(d);
    totalSlots += slots.length;
  }

  if (totalSlots === 0) {
    out.push("⚠️ Aucun cours enregistré pour cette classe.");
    out.push("");
    out.push("_Contacte l'administration pour que ton emploi du temps soit renseigné._");
    return out.join("\n");
  }

  daysWithCourses.forEach((d) => {
    out.push(`## ${d.charAt(0).toUpperCase() + d.slice(1)}`);
    out.push("");
    out.push("| Heure | Matière | Professeur | Salle |");
    out.push("|:----- |:------- |:---------- |:----- |");
    (schedule.emploi_du_temps[d]).forEach((s) => {
      out.push(
        `| ${escapeMd(s.heure || "—")} | ${escapeMd(s.matiere || "—")} | ${escapeMd(s.professeur || "—")} | ${escapeMd(s.salle || "—")} |`
      );
    });
    out.push("");
  });

  out.push(`---\n**Total : ${totalSlots} créneau(x) dans la semaine.**`);
  return out.join("\n");
}

/**
 * Formatte la liste des EXAMENS en tableau Markdown
 */
export function formatExamsTableMarkdown(schedule, scope = "upcoming") {
  const examList =
    scope === "past"
      ? schedule?.exams?.past || []
      : schedule?.exams?.upcoming || [];

  const title = scope === "past"
    ? "# 📝 Examens passés"
    : "# 📝 Examens et contrôles à venir";

  if (examList.length === 0) {
    return scope === "past"
      ? `${title}\n\n✅ Aucun examen passé enregistré.`
      : `${title}\n\n🎉 Rien de prévu pour le moment. Tu peux souffler !\n\n_Pense à vérifier régulièrement ou à contacter l'administration pour confirmer les dates._`;
  }

  const lines = [];
  lines.push(`**${title} — ${escapeMd(schedule.displayName || schedule.className)}**`);
  lines.push("");
  lines.push("| Date | Heure | Matière | Type | Salle | Durée |");
  lines.push("|:---- |:----- |:------- |:---- |:----- |:----- |");

  examList.forEach((e) => {
    const d = new Date(e.date);
    const dateStr = d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
    const heureStr = [e.heureDebut, e.heureFin].filter(Boolean).join(" → ") || "—";
    lines.push(
      `| ${escapeMd(dateStr)} | ${escapeMd(heureStr)} | ${escapeMd(e.matiere || "—")} | ${escapeMd(e.type || "DS")} | ${escapeMd(e.salle || "—")} | ${escapeMd(e.duree || "—")} |`
    );
  });

  lines.push("");
  lines.push(`_${examList.length} examen(s) listé(s)._`);
  return lines.join("\n");
}

/**
 * Formatte la liste des MATIÈRES de la semaine
 */
export function formatSubjectsListMarkdown(schedule) {
  const set = new Map();
  for (const d of DAYS_FR) {
    const slots = schedule?.emploi_du_temps?.[d] || [];
    slots.forEach((s) => {
      if (!s.matiere) return;
      const info = set.get(s.matiere) || { prof: s.professeur, days: [] };
      if (!info.prof && s.professeur) info.prof = s.professeur;
      if (!info.days.includes(d)) info.days.push(d);
      set.set(s.matiere, info);
    });
  }

  const lines = [];
  lines.push(`# 📖 Liste des matières — ${escapeMd(schedule.displayName || schedule.className)}`);
  lines.push("");

  if (set.size === 0) {
    lines.push("_Aucune matière enregistrée pour l'instant._");
    return lines.join("\n");
  }

  lines.push("| Matière | Enseignant | Jours de cours |");
  lines.push("|:------- |:--------- |:-------------- |");
  for (const [matiere, info] of set.entries()) {
    lines.push(
      `| ${escapeMd(matiere)} | ${escapeMd(info.prof || "—")} | ${info.days
        .map((d) => d.charAt(0).toUpperCase() + d.slice(1))
        .join(", ")} |`
    );
  }

  lines.push("");
  lines.push(`_${set.size} matière(s) enseignée(s) cette semaine._`);
  return lines.join("\n");
}

/**
 * Génère une RÉPONSE COMPLÈTE PRÉDÉFINIE (PAS DE LLM)
 * Évite 100% des hallucinations quand on détecte une question de planning/examen
 *
 * Retourne: { answered: true, answer: "..." } OU { answered: false }
 */
export async function tryAnswerPlanningQuery(message, userId, userProfile) {
  if (!message) return { answered: false };

  // Détecter l'intention
  const intent = detectPlanningIntent(message);

  const schedule = await getUserSchedule({
    formation: userProfile?.formation,
    track: userProfile?.track,
    studentClass: userProfile?.studentClass
  }, userId);

  // Cas particulier : intention de planning MAIS AUCUN schedule trouvé
  if (intent.type !== "none" && !schedule) {
    const prof = userProfile || {};
    return {
      answered: true,
      answer: formatNoScheduleAnswer(intent, prof)
    };
  }

  if (!schedule) return { answered: false };

  const header = `ℹ️ _Emploi du temps disponible pour : **${escapeMd(schedule.displayName || schedule.className)}**_`;

  switch (intent.type) {
    case "day": {
      const dateLabel = intent.date
        ? intent.date.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
        : null;
      const table = formatDayTableMarkdown(schedule, intent.day, dateLabel);
      return { answered: true, answer: `${header}\n\n${table}` };
    }
    case "subjects": {
      return { answered: true, answer: `${header}\n\n${formatSubjectsListMarkdown(schedule)}` };
    }
    case "exams": {
      return {
        answered: true,
        answer: `${header}\n\n${formatExamsTableMarkdown(schedule, intent.scope)}`
      };
    }
    case "week":
    default: {
      // On répond seulement si le message ressemble à une demande de planning
      const msgLower = String(message).toLowerCase();
      const planningKeywords = /\b(planning|emploi du temps|emplois|cours|qu'ai je|j'ai quoi|quoi j'ai|programme|horaire)\b/;

      if (!planningKeywords.test(msgLower)) {
        // Ce n'est pas une question de planning, on laisse le LLM répondre
        return { answered: false };
      }

      return {
        answered: true,
        answer: `${header}\n\n${formatWeekTableMarkdown(schedule)}`
      };
    }
  }
}

function formatNoScheduleAnswer(intent, profile) {
  const f = profile.formation ? `\n- Formation : **${profile.formation}**` : "";
  const t = profile.track ? `\n- Filière : **${profile.track}**` : "";
  const c = profile.studentClass ? `\n- Année/classe : **${profile.studentClass}**` : "";

  const intro = "⚠️ **Aucun emploi du temps n'est actuellement disponible pour ta classe.**\n\n" +
    "Le service n'a pas trouvé d'emploi du temps correspondant à ton profil :";
  const hint = f + t + c + (f || t || c ? "" : "\n_(Aucun profil détecté — vérifie que tu es bien connecté(e).)_");
  const next = "\n\n💡 **Que faire ?**\n" +
    "1. Contacte l'administration ou ton professeur référent pour signaler l'absence d'emploi du temps\n" +
    "2. Reviens plus tard : l'emploi du temps est peut-être en cours de mise à jour.";

  return intro + hint + next;
}

function escapeMd(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .trim();
}

/**
 * Fonction de secours (legacy) si le LLM est indisponible
 */
export function getFormationBotAnswer(userId, message, userProfile) {
  const msg = message.toLowerCase();
  
  if (msg.includes("planning") || msg.includes("emploi du temps") || msg.includes("cours")) {
    const formation = userProfile?.formation;
    const track = userProfile?.track;
    const key = `${formation} ${track}`.trim();
    
    if (FORMATIONS[key]) {
      return `Voici ton planning pour ${key}. Tu peux aussi me demander pour un jour spécifique !`;
    }
    return "Je connais ton profil mais je n'ai pas encore l'emploi du temps précis pour ta classe. Contacte l'administration pour plus d'infos !";
  }

  return "Je suis Wessy, ton assistant. Pose-moi une question sur ton planning ou tes notes !";
}
