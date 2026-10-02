// admin-dashboard.js - Gestion des emplois du temps (Schedule)

function getAuthToken() {
  const token = localStorage.getItem("wbc_token") || localStorage.getItem("token");
  if (!token) {
    console.warn("[Auth] Aucun token trouvé, redirection vers la connexion...");
    setTimeout(() => { window.location.href = "index.html"; }, 300);
  }
  return token;
}

function handleAuthError(status, message) {
  if (status === 401 || status === 403) {
    console.warn(`[Auth ${status}] ${message || "Non autorisé"}, redirection...`);
    localStorage.removeItem("wbc_token");
    localStorage.removeItem("token");
    alert("Session expirée ou non autorisée. Veuillez vous reconnecter.");
    setTimeout(() => { window.location.href = "index.html"; }, 400);
    return true;
  }
  return false;
}

const DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const DAY_LABELS = {
  lundi: "Lundi", mardi: "Mardi", mercredi: "Mercredi", jeudi: "Jeudi",
  vendredi: "Vendredi", samedi: "Samedi", dimanche: "Dimanche"
};

// État
let allSchedules = [];
let currentScheduleId = null;
let currentScheduleData = null;
let editingScheduleId = null;
let editingExamIndex = null;

// ======================================================
// INITIALISATION
// ======================================================
document.addEventListener("DOMContentLoaded", async () => {
  console.log("[Admin Schedules] Initialisation...");

  const nav = document.querySelector('.nav-item[data-section="schedules"]');
  if (nav) {
    nav.addEventListener("click", async (e) => {
      e.preventDefault();
      setActiveSection("schedules");
      await loadSchedules();
    });
  }

  // Boutons EDT
  const btnImportLegacy = document.getElementById("sched-import-legacy");
  if (btnImportLegacy) btnImportLegacy.addEventListener("click", importLegacySchedules);

  const btnNewSched = document.querySelector('[data-open-modal="schedule"]');
  if (btnNewSched) btnNewSched.addEventListener("click", () => openScheduleModal());

  document.getElementById("sched-edit-btn")?.addEventListener("click", () => {
    if (currentScheduleId) openScheduleModal(currentScheduleId);
  });

  document.getElementById("sched-exam-add")?.addEventListener("click", () => {
    if (currentScheduleId) openExamModal();
  });

  // Fermeture modaux
  setupModalClose("sched-modal-backdrop", "sched-modal-close", "sched-modal-cancel", () => {
    editingScheduleId = null;
  });
  setupModalClose("exam-modal-backdrop", "exam-modal-close", "exam-modal-cancel", () => {
    editingExamIndex = null;
  });

  // Submit EDT form
  const schedForm = document.getElementById("sched-form");
  if (schedForm) schedForm.addEventListener("submit", submitScheduleForm);

  // Submit examen form
  const examForm = document.getElementById("exam-form");
  if (examForm) examForm.addEventListener("submit", submitExamForm);

  // Build week form inputs une première fois (vide)
  buildWeekForm({});
});

function setupModalClose(backdropId, closeId, cancelId, cb) {
  const backdrop = document.getElementById(backdropId);
  const closeBtn = document.getElementById(closeId);
  const cancelBtn = document.getElementById(cancelId);

  const hide = () => { backdrop.hidden = true; if (cb) cb(); };

  if (closeBtn) closeBtn.addEventListener("click", hide);
  if (cancelBtn) cancelBtn.addEventListener("click", hide);
  if (backdrop) {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) hide();
    });
  }
}

function setActiveSection(name) {
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  const navBtn = document.querySelector(`.nav-item[data-section="${name}"]`);
  if (navBtn) navBtn.classList.add("active");
  const section = document.getElementById(`section-${name}`);
  if (section) section.classList.add("active");
}

function setStatus(msg, color) {
  const s = document.getElementById("sched-status");
  if (!s) return;
  s.textContent = msg || "";
  s.style.color = color || "rgba(255,255,255,0.7)";
}

// ======================================================
// CHARGEMENT - LISTE DES EDT
// ======================================================
async function loadSchedules() {
  setStatus("⏳ Chargement des emplois du temps...");
  try {
    const token = getAuthToken();
    const r = await fetch("/api/admin/schedules", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const json = await r.json();
    if (!r.ok) {
      handleAuthError(r.status, json.message);
      throw new Error(json.message || "Erreur chargement");
    }

    allSchedules = json.schedules || [];
    renderScheduleList();
    setStatus(
      allSchedules.length === 0
        ? "Aucun emploi du temps. Créez-en un nouveau ou cliquez sur 'Importer données existantes'."
        : `✅ ${allSchedules.length} emploi(s) du temps chargé(s)`,
      allSchedules.length === 0 ? "#ffc107" : "#1affb2"
    );
  } catch (e) {
    console.error(e);
    setStatus("❌ Erreur : " + e.message, "#ff6b6b");
  }
}

function countSlots(wt) {
  if (!wt) return 0;
  return DAYS.reduce((n, d) => n + (Array.isArray(wt[d]) ? wt[d].length : 0), 0);
}

function renderScheduleList() {
  const body = document.getElementById("sched-body");
  if (!body) return;
  body.innerHTML = "";

  if (allSchedules.length === 0) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center; opacity:0.6; padding:30px;">
      Aucun emploi du temps enregistré<br>
      <small style="font-size:0.85rem;">Cliquez sur <b>"Importer données existantes"</b> pour ajouter les 4 formations actuelles<br>
      OU cliquez sur <b>"Nouvel EDT"</b> pour créer le vôtre à la main.</small>
    </td></tr>`;
    return;
  }

  for (const s of allSchedules) {
    const tr = document.createElement("tr");

    const courseCount = countSlots(s);
    const updatedAt = s.updatedAt ? new Date(s.updatedAt).toLocaleString("fr-FR") : "-";

    tr.innerHTML = `
      <td><b style="color:#00e6ff;">${escapeHtml(s.className)}</b></td>
      <td>${escapeHtml(s.displayName || "-")}</td>
      <td>${courseCount} créneau(x)</td>
      <td>${Array.isArray(s.exams) ? s.exams.length : 0} examen(s)</td>
      <td><span style="background: rgba(0,255,170,0.15); padding:3px 8px; border-radius: 6px; font-size: 0.8rem; border: 1px solid rgba(0,255,170,0.3);">
        ${s.className.includes(" ") || s.displayName ? "DB" : "DB"}
      </span></td>
      <td style="font-size: 0.85rem; opacity:0.8;">${updatedAt}</td>
      <td>
        <div style="display:flex; gap:6px; flex-wrap: wrap;">
          <button class="btn-neon" style="padding:6px 12px; font-size:0.8rem;" data-action="view" data-id="${s._id}">
            <i class="fas fa-eye"></i> Voir
          </button>
          <button class="btn-neon" style="padding:6px 12px; font-size:0.8rem; background: linear-gradient(135deg, rgba(0,150,255,0.6), rgba(0,200,255,0.7));" data-action="edit" data-id="${s._id}">
            <i class="fas fa-edit"></i> Éditer
          </button>
          <button class="btn-neon" style="padding:6px 12px; font-size:0.8rem; background: linear-gradient(135deg, rgba(160,40,40,0.6), rgba(220,60,60,0.7));" data-action="delete" data-id="${s._id}">
            <i class="fas fa-trash"></i> Suppr.
          </button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  }

  body.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      if (action === "view") await viewSchedule(id);
      if (action === "edit") openScheduleModal(id);
      if (action === "delete") await deleteSchedule(id);
    });
  });
}

// ======================================================
// IMPORT LEGACY
// ======================================================
async function importLegacySchedules() {
  if (!confirm("Importer dans la base de données les emplois du temps déjà codés en dur (BTS CG 2, B3 Finance, BTS 1 MCO, MSE 2) ?\n\nLes doublons seront ignorés.")) return;

  setStatus("⏳ Import en cours...");
  try {
    const token = getAuthToken();
    const r = await fetch("/api/admin/schedules/import-legacy", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` }
    });
    const json = await r.json();
    if (!r.ok) {
      handleAuthError(r.status, json.message);
      throw new Error(json.message || "Erreur import");
    }

    alert(
      `✅ Import terminé !\n` +
      `  - Imporés : ${json.imported}\n` +
      `  - Ignorés (doublons) : ${json.skipped}`
    );
    await loadSchedules();
  } catch (e) {
    console.error(e);
    setStatus("❌ Import échoué: " + e.message, "#ff6b6b");
    alert("Erreur d'import: " + e.message);
  }
}

// ======================================================
// VUE DÉTAILLÉE D'UN EDT
// ======================================================
async function viewSchedule(id) {
  try {
    const token = getAuthToken();
    const r = await fetch(`/api/admin/schedules/${id}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const schedule = await r.json();
    if (!r.ok) {
      handleAuthError(r.status, schedule.message);
      throw new Error(schedule.message || "Erreur chargement détail");
    }

    currentScheduleId = id;
    currentScheduleData = schedule;
    renderScheduleDetail(schedule);
  } catch (e) {
    console.error(e);
    alert("Erreur: " + e.message);
  }
}

function renderScheduleDetail(s) {
  const wrapper = document.getElementById("sched-detail-wrapper");
  if (!wrapper) return;
  wrapper.style.display = "block";
  wrapper.scrollIntoView({ behavior: "smooth", block: "start" });

  document.getElementById("sched-detail-title").innerHTML =
    `<i class="fas fa-calendar-check"></i> ${escapeHtml(s.displayName || s.className)}`;

  const meta = document.getElementById("sched-detail-meta");
  const examCount = Array.isArray(s.exams) ? s.exams.length : 0;
  const upcomingCount = (s.exams || []).filter(e => new Date(e.date) >= new Date(new Date().setHours(0,0,0,0))).length;
  meta.innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:10px;">
      <div><b>Clé (className) :</b> <code style="background:rgba(0,0,0,0.3); padding:2px 6px; border-radius:4px; color:#00e6ff;">${escapeHtml(s.className)}</code></div>
      <div><b>Formation :</b> ${escapeHtml(s.formation || "-")}</div>
      <div><b>Filière (track) :</b> ${escapeHtml(s.track || "-")}</div>
      <div><b>Année (studentClass) :</b> ${escapeHtml(s.studentClass || "-")}</div>
      <div><b>Créneaux :</b> ${countSlots(s.weeklyTimetable)} cours</div>
      <div><b>Examens :</b> ${examCount} au total (${upcomingCount} à venir)</div>
    </div>
  `;

  // Timetable
  const tt = document.getElementById("sched-timetable");
  tt.innerHTML = "";
  const wt = s.weeklyTimetable || {};

  DAYS.forEach(day => {
    const slots = Array.isArray(wt[day]) ? wt[day] : [];
    const card = document.createElement("div");
    card.style.cssText = `
      background: rgba(0, 255, 255, 0.05);
      border: 1px solid rgba(0, 255, 255, 0.2);
      border-radius: 12px;
      padding: 12px;
    `;
    const slotHtml = slots.length === 0
      ? `<p style="opacity:0.4; text-align:center; padding:20px 0; font-size:0.85rem;">Aucun cours</p>`
      : slots.map((c, i) => `
          <div style="
            background: rgba(255,255,255,0.05);
            padding: 8px 10px;
            border-radius: 8px;
            margin-bottom: 8px;
            border-left: 3px solid #00e6ff;
          ">
            <div style="font-weight: 700; color:#00e6ff; font-size: 0.9rem;">
              ${escapeHtml(c.heure || "Horaire non renseigné")}
            </div>
            <div style="margin-top:4px;"><b>${escapeHtml(c.matiere || "-")}</b></div>
            ${c.professeur ? `<div style="opacity:0.7; font-size:0.8rem;">👨‍🏫 ${escapeHtml(c.professeur)}</div>` : ""}
            ${c.salle ? `<div style="opacity:0.7; font-size:0.8rem;">📍 Salle ${escapeHtml(c.salle)}</div>` : ""}
          </div>
        `).join("");

    card.innerHTML = `
      <h5 style="color:#00e6ff; margin-bottom:10px; border-bottom: 1px solid rgba(0,255,255,0.2); padding-bottom: 6px;">
        ${DAY_LABELS[day]} (${slots.length})
      </h5>
      ${slotHtml}
    `;
    tt.appendChild(card);
  });

  // Examens
  const examBody = document.getElementById("sched-exams-body");
  examBody.innerHTML = "";
  const exams = [...(s.exams || [])].sort((a, b) => new Date(a.date) - new Date(b.date));

  if (exams.length === 0) {
    examBody.innerHTML = `<tr><td colspan="6" style="text-align:center; opacity:0.6; padding:25px;">
      Aucun examen enregistré. Cliquez sur <b>"Ajouter un examen"</b> pour en créer un.
    </td></tr>`;
  } else {
    exams.forEach((e, idx) => {
      const d = new Date(e.date);
      const dateFr = d.toLocaleDateString("fr-FR", { weekday: "short", day:"2-digit", month:"2-digit", year:"numeric" });
      const isPast = d < new Date(new Date().setHours(0,0,0,0));
      const tr = document.createElement("tr");
      tr.style.opacity = isPast ? "0.55" : "1";
      tr.innerHTML = `
        <td>${dateFr}${isPast ? ' <span style="font-size:0.7rem; opacity:0.6;">(passé)</span>' : ''}</td>
        <td><b>${escapeHtml(e.matiere)}</b></td>
        <td>${escapeHtml(e.heureDebut || "-")} → ${escapeHtml(e.heureFin || "-")}</td>
        <td><span style="
          background: rgba(255, 120, 255, 0.15);
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 0.8rem;
          border: 1px solid rgba(255, 120, 255, 0.3);
        ">${escapeHtml(e.type || "DS")}</span></td>
        <td>${escapeHtml(e.salle || "-")}</td>
        <td>
          <div style="display:flex; gap:6px; flex-wrap: wrap;">
            <button class="btn-neon" style="padding:5px 10px; font-size:0.75rem; background: linear-gradient(135deg, rgba(0,150,255,0.6), rgba(0,200,255,0.7));" data-exam-edit="${idx}">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn-neon" style="padding:5px 10px; font-size:0.75rem; background: linear-gradient(135deg, rgba(160,40,40,0.6), rgba(220,60,60,0.7));" data-exam-del="${idx}">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      `;
      examBody.appendChild(tr);
    });

    examBody.querySelectorAll("button[data-exam-edit]").forEach(b => {
      b.addEventListener("click", () => {
        const idx = parseInt(b.getAttribute("data-exam-edit"));
        openExamModal(idx);
      });
    });
    examBody.querySelectorAll("button[data-exam-del]").forEach(b => {
      b.addEventListener("click", async () => {
        const idx = parseInt(b.getAttribute("data-exam-del"));
        const ex = exams[idx];
        if (!confirm(`Supprimer l'examen "${ex.matiere}" du ${new Date(ex.date).toLocaleDateString("fr-FR")} ?`)) return;
        const updatedExams = [...exams];
        updatedExams.splice(idx, 1);
        await saveExamsOnly(updatedExams);
      });
    });
  }
}

async function saveExamsOnly(newExams) {
  try {
    const token = getAuthToken();
    const r = await fetch(`/api/admin/schedules/${currentScheduleId}/exams`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ exams: newExams })
    });
    const json = await r.json();
    if (!r.ok) {
      handleAuthError(r.status, json.message);
      throw new Error(json.message || "Erreur sauvegarde");
    }
    alert("✅ Examens mis à jour");
    await viewSchedule(currentScheduleId);
    await loadSchedules();
  } catch (e) {
    alert("Erreur: " + e.message);
  }
}

// ======================================================
// CRÉATION / MODIFICATION D'UN EDT
// ======================================================
function buildWeekForm(weeklyTimetable) {
  const container = document.getElementById("sched-week-form");
  if (!container) return;
  container.innerHTML = "";

  DAYS.forEach(day => {
    const daySlots = Array.isArray(weeklyTimetable[day]) ? weeklyTimetable[day] : [];
    const card = document.createElement("div");
    card.style.cssText = `
      background: rgba(0,255,255,0.04);
      border: 1px solid rgba(0,255,255,0.15);
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 12px;
    `;
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h5 style="color:#00e6ff; margin:0;">${DAY_LABELS[day]}</h5>
        <button type="button" class="btn-neon" style="padding:5px 10px; font-size:0.8rem;" data-add-slot="${day}">
          <i class="fas fa-plus"></i> Ajouter un créneau
        </button>
      </div>
      <div data-day-slots="${day}"></div>
    `;
    container.appendChild(card);

    const slotsDiv = card.querySelector(`[data-day-slots="${day}"]`);

    // Remplir créneaux existants
    daySlots.forEach(slot => addSlotRow(slotsDiv, day, slot));

    // Bouton ajouter
    card.querySelector(`[data-add-slot="${day}"]`).addEventListener("click", () => {
      addSlotRow(slotsDiv, day, { heure: "", matiere: "", professeur: "", salle: "" });
    });
  });
}

function addSlotRow(container, day, slot) {
  const row = document.createElement("div");
  row.style.cssText = `
    display: grid;
    grid-template-columns: 1.2fr 2fr 1.2fr 1fr auto;
    gap: 8px;
    margin-bottom: 8px;
    padding: 8px;
    background: rgba(255,255,255,0.04);
    border-radius: 6px;
  `;
  row.innerHTML = `
    <div class="form-group" style="margin:0;">
      <label style="font-size:0.75rem;">Horaire</label>
      <input type="text" data-field="heure" placeholder="09:00 - 12:00" value="${escapeHtml(slot.heure || "")}" />
    </div>
    <div class="form-group" style="margin:0;">
      <label style="font-size:0.75rem;">Matière *</label>
      <input type="text" data-field="matiere" placeholder="Ex: Anglais" value="${escapeHtml(slot.matiere || "")}" />
    </div>
    <div class="form-group" style="margin:0;">
      <label style="font-size:0.75rem;">Professeur</label>
      <input type="text" data-field="professeur" placeholder="Ex: M. X" value="${escapeHtml(slot.professeur || "")}" />
    </div>
    <div class="form-group" style="margin:0;">
      <label style="font-size:0.75rem;">Salle</label>
      <input type="text" data-field="salle" placeholder="Ex: Salle 201" value="${escapeHtml(slot.salle || "")}" />
    </div>
    <div style="display:flex; align-items:flex-end; padding-bottom:5px;">
      <button type="button" class="btn-neon" style="padding:5px 10px; background: linear-gradient(135deg, rgba(160,40,40,0.6), rgba(220,60,60,0.7));">
        <i class="fas fa-minus"></i>
      </button>
    </div>
  `;
  container.appendChild(row);
  row.querySelector(".btn-neon").addEventListener("click", () => row.remove());
}

function collectWeeklyTimetable() {
  const wt = {};
  DAYS.forEach(day => {
    const slotsDiv = document.querySelector(`[data-day-slots="${day}"]`);
    if (!slotsDiv) { wt[day] = []; return; }
    const rows = slotsDiv.children;
    const daySlots = [];
    for (const row of rows) {
      const heure = row.querySelector('[data-field="heure"]').value.trim();
      const matiere = row.querySelector('[data-field="matiere"]').value.trim();
      if (!matiere) continue;
      daySlots.push({
        heure,
        matiere,
        professeur: row.querySelector('[data-field="professeur"]').value.trim(),
        salle: row.querySelector('[data-field="salle"]').value.trim()
      });
    }
    wt[day] = daySlots;
  });
  return wt;
}

async function openScheduleModal(id) {
  editingScheduleId = id || null;
  const title = document.getElementById("sched-modal-title");
  const btnNew = document.querySelector('[data-open-modal="schedule"]');
  if (id) {
    title.textContent = "Modifier emploi du temps";
    setStatus("⏳ Chargement de l'emploi du temps...");
    try {
      const token = getAuthToken();
      const r = await fetch(`/api/admin/schedules/${id}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      const s = await r.json();
      if (!r.ok) {
        handleAuthError(r.status, s.message);
        throw new Error(s.message);
      }

      document.getElementById("sched-classname").value = s.className || "";
      document.getElementById("sched-displayName").value = s.displayName || "";
      document.getElementById("sched-formation").value = s.formation || "";
      document.getElementById("sched-track").value = s.track || "";
      document.getElementById("sched-studentClass").value = s.studentClass || "";
      buildWeekForm(s.weeklyTimetable || {});
      setStatus("");
    } catch (e) {
      setStatus("❌ " + e.message, "#ff6b6b");
      alert("Erreur chargement: " + e.message);
      return;
    }
  } else {
    title.textContent = "Nouvel emploi du temps";
    const form = document.getElementById("sched-form");
    if (form) form.reset();
    buildWeekForm({});
  }

  document.getElementById("sched-modal-backdrop").hidden = false;
  if (btnNew) btnNew.setAttribute("aria-disabled", "true");
}

async function submitScheduleForm(e) {
  e.preventDefault();

  const className = document.getElementById("sched-classname").value.trim();
  if (!className) { alert("Le nom de classe (clé unique) est requis."); return; }

  const data = {
    className,
    displayName: document.getElementById("sched-displayName").value.trim() || className,
    formation: document.getElementById("sched-formation").value,
    track: document.getElementById("sched-track").value.trim(),
    studentClass: document.getElementById("sched-studentClass").value,
    weeklyTimetable: collectWeeklyTimetable()
  };

  try {
    const token = getAuthToken();
    let r;
    if (editingScheduleId) {
      r = await fetch(`/api/admin/schedules/${editingScheduleId}`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
      });
    } else {
      r = await fetch("/api/admin/schedules", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
      });
    }

    const json = await r.json();
    if (!r.ok) {
      handleAuthError(r.status, json.message);
      throw new Error(json.message || "Erreur sauvegarde");
    }

    alert(`✅ Emploi du temps ${editingScheduleId ? "modifié" : "créé"} !`);
    document.getElementById("sched-modal-backdrop").hidden = true;
    editingScheduleId = null;
    await loadSchedules();
    if (json.schedule?._id) {
      await viewSchedule(json.schedule._id);
    }
  } catch (e) {
    console.error(e);
    alert("Erreur : " + e.message);
  }
}

async function deleteSchedule(id) {
  const sched = allSchedules.find(s => s._id === id);
  if (!confirm(`Supprimer l'emploi du temps "${sched?.className || id}" ?\n⚠️ Cette action est irréversible.`)) return;

  try {
    const token = getAuthToken();
    const r = await fetch(`/api/admin/schedules/${id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });
    const json = await r.json();
    if (!r.ok) {
      handleAuthError(r.status, json.message);
      throw new Error(json.message || "Erreur suppression");
    }

    alert("✅ " + (json.message || "Supprimé"));
    if (currentScheduleId === id) {
      document.getElementById("sched-detail-wrapper").style.display = "none";
      currentScheduleId = null;
    }
    await loadSchedules();
  } catch (e) {
    alert("Erreur: " + e.message);
  }
}

// ======================================================
// GESTION EXAMENS
// ======================================================
async function openExamModal(index) {
  editingExamIndex = typeof index === "number" ? index : null;
  const title = document.getElementById("exam-modal-title");
  const form = document.getElementById("exam-form");
  form.reset();

  if (editingExamIndex !== null && currentScheduleData) {
    const exams = [...(currentScheduleData.exams || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
    const ex = exams[editingExamIndex];
    if (!ex) return;
    title.textContent = "Modifier un examen";

    const dateStr = ex.date ? new Date(ex.date).toISOString().split("T")[0] : "";
    document.getElementById("exam-date").value = dateStr;
    document.getElementById("exam-matiere").value = ex.matiere || "";
    document.getElementById("exam-type").value = ex.type || "DS";
    document.getElementById("exam-heureDebut").value = ex.heureDebut || "";
    document.getElementById("exam-heureFin").value = ex.heureFin || "";
    document.getElementById("exam-duree").value = ex.duree || "";
    document.getElementById("exam-salle").value = ex.salle || "";
    document.getElementById("exam-professeur").value = ex.professeur || "";
    document.getElementById("exam-desc").value = ex.description || "";
  } else {
    title.textContent = "Ajouter un examen";
  }

  document.getElementById("exam-modal-backdrop").hidden = false;
}

async function submitExamForm(e) {
  e.preventDefault();
  if (!currentScheduleId) return;

  // Charger le schedule courant (à jour)
  const token = getAuthToken();
  const r = await fetch(`/api/admin/schedules/${currentScheduleId}`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const current = await r.json();
  if (!r.ok) {
    handleAuthError(r.status, current.message);
    alert("Erreur: " + current.message);
    return;
  }

  let exams = [...(current.exams || [])];
  const sortedIndices = exams
    .map((e, i) => ({ i, d: new Date(e.date) }))
    .sort((a, b) => a.d - b.d)
    .map(x => x.i);

  const examData = {
    date: document.getElementById("exam-date").value,
    matiere: document.getElementById("exam-matiere").value.trim(),
    type: document.getElementById("exam-type").value,
    heureDebut: document.getElementById("exam-heureDebut").value,
    heureFin: document.getElementById("exam-heureFin").value,
    duree: document.getElementById("exam-duree").value.trim(),
    salle: document.getElementById("exam-salle").value.trim(),
    professeur: document.getElementById("exam-professeur").value.trim(),
    description: document.getElementById("exam-desc").value.trim()
  };

  if (!examData.date || !examData.matiere || !examData.heureDebut || !examData.heureFin) {
    alert("Veuillez remplir : Date, Matière, Heure début et Heure fin.");
    return;
  }

  if (editingExamIndex !== null && sortedIndices[editingExamIndex] !== undefined) {
    exams[sortedIndices[editingExamIndex]] = { ...exams[sortedIndices[editingExamIndex]], ...examData };
  } else {
    exams.push(examData);
  }

  await saveExamsOnly(exams);
  document.getElementById("exam-modal-backdrop").hidden = true;
  editingExamIndex = null;
}

// ======================================================
// HELPERS
// ======================================================
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
