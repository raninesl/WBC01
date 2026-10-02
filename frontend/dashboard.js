// dashboard.js

// API_URL is defined in utils.js
// const API_URL = "http://localhost:4000"; 

// Récup user + token
const token = localStorage.getItem("wbc_token");
const currentUser = JSON.parse(localStorage.getItem("wbc_user") || "null");

// Sécurité de base
if (!token || !currentUser) {
  window.location.href = "index.html";
}

// Redirection si pas ADMIN
if (String(currentUser.role || "").toUpperCase() !== "ADMIN") {
  window.location.href = "avatar-setup.html";
}

const authHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
};

let users = []; // alimenté par l'API
let iotChart = null;
let iotDataPoints = [];
const MAX_DATA_POINTS = 20;

// Elements
const navItems = document.querySelectorAll(".nav-item");
const sections = document.querySelectorAll(".section");
const logoutBtn = document.getElementById("logout-btn");

const kpiTotal = document.getElementById("kpi-total-users");
const kpiTeachers = document.getElementById("kpi-teachers");
const kpiStudents = document.getElementById("kpi-students");
const kpiIotActivity = document.getElementById("kpi-iot-activity"); // Nouvelle carte
const lastUsersBody = document.getElementById("last-users-body");
const teachersBody = document.getElementById("teachers-body");
const studentsBody = document.getElementById("students-body");

const adminGradesClass = document.getElementById("admin-grades-class");
const adminGradesRefresh = document.getElementById("admin-grades-refresh");
const adminGradesBody = document.getElementById("admin-grades-body");
const adminGradesStatus = document.getElementById("admin-grades-status");

const adminAbsencesClass = document.getElementById("admin-absences-class");
const adminAbsencesRefresh = document.getElementById("admin-absences-refresh");
const adminAbsencesBody = document.getElementById("admin-absences-body");
const adminAbsencesStatus = document.getElementById("admin-absences-status");

const CLASS_OPTIONS = ["BTS 1", "BTS 2", "B1", "B2", "B3", "M1", "M2"];

// Modal
const modalBackdrop = document.getElementById("user-modal-backdrop");
const modalClose = document.getElementById("modal-close");
const modalTitle = document.getElementById("modal-title");
const userRoleInput = document.getElementById("user-role");
const userClassInput = document.getElementById("user-class");
const studentClassGroup = document.getElementById("student-class-group");
const studentFormationGroup = document.getElementById("student-formation-group");
const userFormationInput = document.getElementById("user-formation");
const userTrackInput = document.getElementById("user-track");
const userForm = document.getElementById("user-form");

const nameInput = document.getElementById("user-name");
const emailInput = document.getElementById("user-email");
const passwordInput = document.getElementById("user-password");
const statusInput = document.getElementById("user-status");

// ---------------- Helpers ----------------

function getUserId(u) {
  return u?._id || u?.id || "";
}

function roleLabel(role) {
  if (role === "TEACHER") return "Professeur";
  if (role === "STUDENT") return "Étudiant";
  if (role === "ADMIN") return "Admin";
  return role || "";
}

// ---------------- Navigation entre sections ----------------

navItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    const href = btn.getAttribute("data-href");
    if (href) {
      window.location.href = href;
      return;
    }

    const target = btn.getAttribute("data-section");

    navItems.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    sections.forEach((sec) => {
      const id = sec.getAttribute("id");
      sec.classList.toggle("active", id === `section-${target}`);
    });

    if (target === "grades") {
      loadAdminGrades();
    }
    if (target === "absences") {
      loadAdminAbsences();
    }
  });
});

// Déconnexion
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("wbc_token");
    localStorage.removeItem("wbc_user");
    window.location.href = "index.html";
  });
}

// ---------------- API : Récupérer les utilisateurs ----------------

async function fetchUsers() {
  try {
    const res = await fetch(`${API_URL}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json().catch(() => []);

    if (!res.ok) {
      console.error("Erreur fetch users", res.status, data);
      alert("Erreur lors du chargement des utilisateurs: " + (data.message || res.statusText));
      return;
    }

    users = Array.isArray(data) ? data : [];
    if (users.length === 0) {
      console.warn("Aucun utilisateur trouvé en base.");
    }
    refreshAll();
  } catch (err) {
    console.error("Erreur réseau fetch users", err);
    alert("Impossible de contacter le serveur. Vérifiez que le backend tourne sur " + API_URL);
  }
}

async function createUser(body) {
  const res = await fetch(`${API_URL}/api/admin/users`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    alert(payload.message || "Erreur lors de la création");
    return null;
  }

  return payload;
}

async function inviteTeacher(body) {
  const res = await fetch(`${API_URL}/api/admin/teachers/invite`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    alert(payload.message || "Erreur lors de la création de l’invitation");
    return null;
  }

  return payload;
}

function updateKpis() {
  const total = users.length;
  const teachers = users.filter((u) => u.role === "TEACHER").length;
  const students = users.filter((u) => u.role === "STUDENT").length;

  if (kpiTotal) kpiTotal.textContent = total;
  if (kpiTeachers) kpiTeachers.textContent = teachers;
  if (kpiStudents) kpiStudents.textContent = students;
}

function updateLastUsers() {
  if (!lastUsersBody) return;
  lastUsersBody.innerHTML = "";

  if (users.length === 0) {
    lastUsersBody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding: 20px;'>Aucun utilisateur trouvé</td></tr>";
    return;
  }

  const last = [...users].slice(0, 5);

  last.forEach((u) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.fullName || ""}</td>
      <td>${roleLabel(u.role)}</td>
      <td>${u.email || ""}</td>
      <td><span class="badge ${u.status || "active"}">${u.status || "active"}</span></td>
    `;
    lastUsersBody.appendChild(tr);
  });
}

function updateTeachers() {
  if (!teachersBody) return;
  teachersBody.innerHTML = "";

  const teachers = users.filter((u) => u.role === "TEACHER");

  if (teachers.length === 0) {
    teachersBody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding: 20px;'>Aucun professeur trouvé</td></tr>";
    return;
  }

  teachers.forEach((u) => {
      const tr = document.createElement("tr");

      const status = u.status || "active";
      const canValidate = status === "inactive";

      tr.innerHTML = `
        <td>${u.fullName || ""}</td>
        <td>${u.email || ""}</td>
        <td>${u.username || ""}</td>
        <td><span class="badge ${status}">${status}</span></td>
        <td class="actions">
          <button class="btn-icon" data-edit-id="${getUserId(u)}" title="Modifier"><i class="fas fa-edit"></i></button>
          ${canValidate ? `<button class="btn-icon" data-validate-id="${getUserId(u)}" title="Valider"><i class="fas fa-check"></i></button>` : ""}
          <button class="btn-icon" data-delete-id="${getUserId(u)}" title="Supprimer"><i class="fas fa-trash"></i></button>
        </td>
      `;

      teachersBody.appendChild(tr);
    });

  attachEditButtons();
  attachValidationButtons();
  attachDeleteButtons();
}

function updateStudents() {
  if (!studentsBody) return;
  studentsBody.innerHTML = "";

  const students = users.filter((u) => u.role === "STUDENT");

  if (students.length === 0) {
    studentsBody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding: 20px;'>Aucun étudiant trouvé</td></tr>";
    return;
  }

  students.forEach((u) => {
      const tr = document.createElement("tr");

      const status = u.status || "active";

      tr.innerHTML = `
        <td><div style="display:flex;align-items:center;">${createAvatarHtml(u)}<span>${u.fullName || ""}</span></div></td>
        <td>${u.email || ""}</td>
        <td>${u.username || ""}</td>
        <td><span class="badge ${status}">${status}</span></td>
        <td class="actions">
          <button class="btn-icon" data-edit-id="${getUserId(u)}" title="Modifier"><i class="fas fa-edit"></i></button>
          <button class="btn-icon" data-delete-id="${getUserId(u)}" title="Supprimer"><i class="fas fa-trash"></i></button>
        </td>
      `;

      studentsBody.appendChild(tr);
    });

  attachEditButtons();
  attachDeleteButtons();
}

function attachEditButtons() {
  document.querySelectorAll("[data-edit-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit-id");
      const u = users.find(user => getUserId(user) === id);
      if (!u) return;

      if (modalTitle) modalTitle.textContent = "Modifier l'utilisateur";
      if (nameInput) nameInput.value = u.fullName || "";
      if (emailInput) emailInput.value = u.email || "";
      if (passwordInput) {
        passwordInput.value = "";
        passwordInput.required = false;
      }
      if (userRoleInput) {
        userRoleInput.value = (u.role || "STUDENT").toLowerCase();
      }
      if (statusInput) {
        statusInput.value = u.status || "active";
      }
      
      if (userClassInput) userClassInput.value = u.studentClass || "BTS 1";
      if (userFormationInput) userFormationInput.value = u.formation || "";
      if (userTrackInput) userTrackInput.value = u.track || "";

      // Gérer l'affichage des groupes
      const isStudent = (u.role === "STUDENT");
      if (studentClassGroup) studentClassGroup.style.display = isStudent ? "block" : "none";
      if (studentFormationGroup) studentFormationGroup.style.display = isStudent ? "block" : "none";

      // Ajouter l'ID à l'élément form pour savoir qu'on modifie
      userForm.setAttribute("data-edit-user-id", id);
      
      if (modalBackdrop) modalBackdrop.hidden = false;
    });
  });
}

function attachDeleteButtons() {
  document.querySelectorAll("[data-delete-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-delete-id");
      if (!id) return;
      if (!confirm("Supprimer cet utilisateur ?")) return;

      try {
        const res = await fetch(`${API_URL}/api/admin/users/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          alert(payload.message || "Erreur suppression");
          return;
        }

        users = users.filter((u) => getUserId(u) !== id);
        refreshAll();
      } catch (err) {
        console.error("Erreur réseau suppression", err);
        alert("Erreur réseau suppression");
      }
    });
  });
}

function attachValidationButtons() {
  document.querySelectorAll("[data-validate-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-validate-id");
      if (!id) return;
      if (!confirm("Valider ce compte professeur ?")) return;

      try {
        const res = await fetch(`${API_URL}/api/admin/users/${id}/status`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({ status: "active" }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          alert(payload.message || "Erreur validation");
          return;
        }

        users = users.map((u) =>
          getUserId(u) === id ? { ...u, status: "active", isActive: true } : u
        );
        refreshAll();
      } catch (err) {
        console.error("Erreur réseau validation", err);
        alert("Erreur réseau validation");
      }
    });
  });
}

if (userRoleInput) {
  userRoleInput.addEventListener("change", () => {
     const isStudent = (userRoleInput.value === "student");
     if (studentClassGroup) studentClassGroup.style.display = isStudent ? "block" : "none";
     if (studentFormationGroup) studentFormationGroup.style.display = isStudent ? "block" : "none";
  });
}

document.querySelectorAll("[data-open-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const roleKey = btn.getAttribute("data-open-modal");

    if (userRoleInput) {
        userRoleInput.value = roleKey;
        const isStudent = (roleKey === "student");
        if (studentClassGroup) studentClassGroup.style.display = isStudent ? "block" : "none";
        if (studentFormationGroup) studentFormationGroup.style.display = isStudent ? "block" : "none";
    }

    if (modalTitle) {
      modalTitle.textContent =
        roleKey === "teacher" ? "Créer un professeur" : "Créer un étudiant";
    }

    if (nameInput) nameInput.value = "";
    if (emailInput) emailInput.value = "";
    if (passwordInput) {
      passwordInput.value = "";
      passwordInput.disabled = false;
      passwordInput.required = (roleKey !== "teacher");
    }
    
    if (userFormationInput) userFormationInput.value = "";
    if (userTrackInput) userTrackInput.value = "";

    userForm.removeAttribute("data-edit-user-id");

    if (roleKey === "teacher") {
      if (passwordInput) {
        passwordInput.disabled = true;
        passwordInput.required = false;
      }
      if (statusInput) {
        statusInput.value = "inactif";
        statusInput.disabled = true;
      }
    } else {
      if (passwordInput) {
        passwordInput.disabled = false;
        passwordInput.required = true;
      }
      if (statusInput) {
        statusInput.disabled = false;
      }
    }

    if (modalBackdrop) modalBackdrop.hidden = false;
  });
});

if (modalClose) {
  modalClose.addEventListener("click", () => {
    if (modalBackdrop) modalBackdrop.hidden = true;
  });
}
if (modalBackdrop) {
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) {
      modalBackdrop.hidden = true;
    }
  });
}

if (userForm) {
  userForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = (nameInput?.value || "").trim();
    const email = (emailInput?.value || "").trim();
    const rawRole = (userRoleInput?.value || "").trim();
    const password = (passwordInput?.value || "").trim();

    if (!fullName || !email || !rawRole) {
      alert("Merci de remplir au moins le nom, l’email et le rôle.");
      return;
    }

    let role = "STUDENT";
    if (rawRole === "admin") role = "ADMIN";
    if (rawRole === "teacher") role = "TEACHER";
    if (rawRole === "student") role = "STUDENT";

    if (role === "TEACHER" && !userForm.getAttribute("data-edit-user-id")) {
      const invited = await inviteTeacher({
        fullName,
        email,
      });

      if (!invited) return;

      if (modalBackdrop) modalBackdrop.hidden = true;
      userForm.reset();

      await fetchUsers();

      if (invited.activationUrl) {
        alert(
          `Invitation créée pour ${email}.\n\nLien d’activation à envoyer au professeur :\n${invited.activationUrl}`
        );
      } else {
        alert("Invitation créée pour le professeur.");
      }

      return;
    }
    const studentClass = userClassInput ? userClassInput.value : "BTS 1";
    const formation = userFormationInput ? userFormationInput.value : "";
    const track = userTrackInput ? userTrackInput.value : "";
    const status = statusInput ? statusInput.value : "active";

    const payload = {
      fullName,
      email,
      role,
      studentClass,
      formation,
      track,
      status,
    };

    if (password) payload.password = password;

    const editId = userForm.getAttribute("data-edit-user-id");

    if (editId) {
      // MODE EDITION
      try {
        const res = await fetch(`${API_URL}/api/admin/users/${editId}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Erreur modification");
        alert("Utilisateur mis à jour ✅");
      } catch (err) {
        alert(err.message);
        return;
      }
    } else {
      // MODE CREATION
      payload.username = generateUsername(fullName, role);
      const created = await createUser(payload);
      if (!created) return;
      alert("Utilisateur créé ✅");
    }

    if (modalBackdrop) modalBackdrop.hidden = true;
    userForm.reset();
    await fetchUsers();
  });
}

function generateUsername(fullName, role) {
  let clean = String(fullName)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");

  if (role === "TEACHER") return "prof." + clean;
  if (role === "STUDENT") return "etu." + clean;
  if (role === "ADMIN") return "admin." + clean;

  return clean;
}

function populateClassSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  CLASS_OPTIONS.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    selectEl.appendChild(opt);
  });
  if (!selectEl.value) selectEl.value = CLASS_OPTIONS[0];
}

function fmtGrade(avg) {
  if (avg === null || avg === undefined) return "-";
  const n = Number(avg);
  if (!Number.isFinite(n)) return "-";
  return `${n.toFixed(2)}/20`;
}

function fmtDate(d) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

async function loadAdminGrades() {
  if (!adminGradesBody || !adminGradesClass) return;
  const studentClass = String(adminGradesClass.value || "").trim();
  if (!studentClass) return;

  if (adminGradesStatus) adminGradesStatus.textContent = "Chargement...";
  adminGradesBody.innerHTML = "";

  try {
    const res = await fetch(`${API_URL}/api/admin/grades?studentClass=${encodeURIComponent(studentClass)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Erreur chargement");

    const rows = Array.isArray(data.students) ? data.students : [];
    if (adminGradesStatus) adminGradesStatus.textContent = `${rows.length} étudiant(s) — ${studentClass}`;

    if (rows.length === 0) {
      adminGradesBody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding: 20px; opacity:0.7;'>Aucun étudiant trouvé.</td></tr>";
      return;
    }

    rows.forEach((r) => {
      const s = r.student || {};
      const sid = s._id || s.id || "";
      const name = s.fullName || s.username || s.email || "Étudiant";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${name}</td>
        <td>${fmtGrade(r.average)}</td>
        <td>${Number(r.gradedCount || 0)}</td>
        <td>${Number(r.pendingCount || 0)}</td>
        <td class="actions">
          <button class="btn-icon" data-admin-grade-toggle="${sid}" title="Détails"><i class="fas fa-eye"></i></button>
        </td>
      `;

      const detailsTr = document.createElement("tr");
      detailsTr.setAttribute("data-admin-grade-details", sid);
      detailsTr.style.display = "none";
      const details = Array.isArray(r.details) ? r.details : [];
      const itemsHtml = details.length
        ? details
            .map((d) => {
              const line = [
                d.courseTitle ? `<strong>${d.courseTitle}</strong>` : "",
                d.assignmentTitle ? `— ${d.assignmentTitle}` : "",
                d.grade !== undefined ? `: <strong>${d.grade}/20</strong>` : "",
                d.submittedAt ? `(${fmtDate(d.submittedAt)})` : ""
              ]
                .filter(Boolean)
                .join(" ");
              const fb = String(d.feedback || "").trim();
              return `<div style="padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                        <div style="color: rgba(255,255,255,0.9); font-size: 0.95rem;">${line}</div>
                        ${fb ? `<div style="margin-top: 4px; color: rgba(255,255,255,0.65); font-size: 0.9rem;">${fb}</div>` : ""}
                      </div>`;
            })
            .join("")
        : `<div style="opacity:0.7;">Aucune note trouvée.</div>`;

      detailsTr.innerHTML = `
        <td colspan="5" style="padding: 0 0 16px 0;">
          <div style="margin: 0 18px 12px 18px; padding: 14px; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; background: rgba(255,255,255,0.03);">
            ${itemsHtml}
          </div>
        </td>
      `;

      adminGradesBody.appendChild(tr);
      adminGradesBody.appendChild(detailsTr);
    });

    adminGradesBody.querySelectorAll("[data-admin-grade-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sid = btn.getAttribute("data-admin-grade-toggle");
        const tr = adminGradesBody.querySelector(`[data-admin-grade-details="${sid}"]`);
        if (!tr) return;
        tr.style.display = tr.style.display === "none" ? "" : "none";
      });
    });
  } catch (err) {
    if (adminGradesStatus) adminGradesStatus.textContent = `Erreur: ${err.message}`;
    adminGradesBody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding: 20px; color:#ff3366;'>Erreur chargement.</td></tr>";
  }
}

async function loadAdminAbsences() {
  if (!adminAbsencesBody || !adminAbsencesClass) return;
  const studentClass = String(adminAbsencesClass.value || "").trim();
  if (!studentClass) return;

  if (adminAbsencesStatus) adminAbsencesStatus.textContent = "Chargement...";
  adminAbsencesBody.innerHTML = "";

  try {
    const res = await fetch(`${API_URL}/api/admin/absences?studentClass=${encodeURIComponent(studentClass)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Erreur chargement");

    const rows = Array.isArray(data.students) ? data.students : [];
    if (adminAbsencesStatus) adminAbsencesStatus.textContent = `${rows.length} étudiant(s) — ${studentClass}`;

    if (rows.length === 0) {
      adminAbsencesBody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding: 20px; opacity:0.7;'>Aucun étudiant trouvé.</td></tr>";
      return;
    }

    rows.forEach((r) => {
      const s = r.student || {};
      const sid = s._id || s.id || "";
      const name = s.fullName || s.username || s.email || "Étudiant";
      const total = Number(r.totalAbsences || 0);
      const bySubject = Array.isArray(r.bySubject) ? r.bySubject : [];
      const summary = bySubject
        .slice(0, 4)
        .map((x) => `${x.subject || "Matière"}: ${Number(x.absences || 0)}`)
        .join(" • ");

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${name}</td>
        <td><strong>${total}</strong></td>
        <td style="opacity:0.8;">${summary || "-"}</td>
        <td class="actions">
          <button class="btn-icon" data-admin-abs-toggle="${sid}" title="Détails"><i class="fas fa-eye"></i></button>
        </td>
      `;

      const detailsTr = document.createElement("tr");
      detailsTr.setAttribute("data-admin-abs-details", sid);
      detailsTr.style.display = "none";

      const detailsHtml = bySubject.length
        ? bySubject
            .map((x) => {
              const det = Array.isArray(x.details) ? x.details : [];
              const detLines = det.length
                ? det
                    .slice(0, 30)
                    .map((d) => {
                      const when = fmtDate(d.date);
                      const reason = String(d.reason || "").trim();
                      return `<div style="opacity:0.85;">- ${when}${reason ? ` — ${reason}` : ""}</div>`;
                    })
                    .join("")
                : `<div style="opacity:0.7;">Aucun détail.</div>`;

              return `<div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                        <div style="color: rgba(255,255,255,0.9); font-size: 0.95rem;">
                          <strong>${x.subject || "Matière"}</strong> — ${Number(x.absences || 0)} absence(s)
                        </div>
                        <div style="margin-top: 6px; color: rgba(255,255,255,0.65); font-size: 0.9rem;">
                          ${detLines}
                        </div>
                      </div>`;
            })
            .join("")
        : `<div style="opacity:0.7;">Aucune absence enregistrée.</div>`;

      detailsTr.innerHTML = `
        <td colspan="4" style="padding: 0 0 16px 0;">
          <div style="margin: 0 18px 12px 18px; padding: 14px; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; background: rgba(255,255,255,0.03);">
            ${detailsHtml}
          </div>
        </td>
      `;

      adminAbsencesBody.appendChild(tr);
      adminAbsencesBody.appendChild(detailsTr);
    });

    adminAbsencesBody.querySelectorAll("[data-admin-abs-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sid = btn.getAttribute("data-admin-abs-toggle");
        const tr = adminAbsencesBody.querySelector(`[data-admin-abs-details="${sid}"]`);
        if (!tr) return;
        tr.style.display = tr.style.display === "none" ? "" : "none";
      });
    });
  } catch (err) {
    if (adminAbsencesStatus) adminAbsencesStatus.textContent = `Erreur: ${err.message}`;
    adminAbsencesBody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding: 20px; color:#ff3366;'>Erreur chargement.</td></tr>";
  }
}

// ---------------- API : Récupérer l'activité IoT ----------------

function initIotChart() {
  const ctx = document.getElementById('iot-activity-chart');
  if (!ctx) return;

  iotChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array(MAX_DATA_POINTS).fill(''),
      datasets: [{
        label: 'Activité (%)',
        data: Array(MAX_DATA_POINTS).fill(0),
        borderColor: '#ff3366',
        backgroundColor: 'rgba(255, 51, 102, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { 
          min: 0, 
          max: 100,
          ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

async function updateIotActivity() {
  if (!kpiIotActivity) return;

  try {
    const res = await fetch(`${API_URL}/api/iot/activity/CLASS_A`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (res.ok && data.length > 0) {
      const latest = data[0].movementPercentage;
      kpiIotActivity.textContent = `${Math.round(latest)}%`;
      
      // Mettre à jour le graphique avec l'historique
      if (iotChart) {
        const historicalData = data.slice(0, MAX_DATA_POINTS).reverse().map(d => d.movementPercentage);
        iotChart.data.datasets[0].data = historicalData;
        iotChart.update('none');
      }
    } else {
      kpiIotActivity.textContent = "N/A";
    }
  } catch (err) {
    console.error("Erreur fetch IoT data", err);
    kpiIotActivity.textContent = "Erreur";
  }
}

// ---------------- Socket.IO ----------------

const socket = io(API_URL, {
    auth: { token },
});

socket.on("connect", () => {
    console.log("Socket.IO connecté au dashboard admin");
    socket.emit('join_admin_dashboard'); // Rejoindre un canal pour les admins
});

socket.on('iot:new_activity', (activity) => {
    console.log("Nouvelle activité IoT reçue:", activity);
    if (kpiIotActivity && activity.classroomId === 'CLASS_A') {
        kpiIotActivity.textContent = `${Math.round(activity.movementPercentage)}%`;
        
        // Mise à jour temps réel du graphique
        if (iotChart) {
            iotChart.data.datasets[0].data.push(activity.movementPercentage);
            iotChart.data.datasets[0].data.shift();
            iotChart.update();
        }
    }
});


function refreshAll() {
  updateKpis();
  updateLastUsers();
  updateTeachers();
  updateStudents();
  updateIotActivity(); // Mettre à jour la carte IoT
}

// Init
document.addEventListener("DOMContentLoaded", async () => {
  console.log("Dashboard initializing...");
  
  initIotChart(); // Initialiser le graphique

  populateClassSelect(adminGradesClass);
  populateClassSelect(adminAbsencesClass);

  adminGradesRefresh?.addEventListener("click", loadAdminGrades);
  adminAbsencesRefresh?.addEventListener("click", loadAdminAbsences);

  adminGradesClass?.addEventListener("change", loadAdminGrades);
  adminAbsencesClass?.addEventListener("change", loadAdminAbsences);
  
  // Verify dependencies
  if (typeof API_URL === "undefined") {
    console.error("API_URL is missing. Checking window.API_URL...");
    if (window.API_URL) {
      window.API_URL = window.API_URL;
    } else {
      console.error("Critical: API_URL not found!");
      alert("Erreur de configuration: API_URL manquant.");
      return;
    }
  }

  if (typeof createAvatarHtml === "undefined") {
    console.error("createAvatarHtml is missing. Ensure utils.js is loaded.");
  }

  // Update Admin Avatar
  const avatarEl = document.getElementById("admin-profile-avatar");
  if (avatarEl && currentUser) {
      const container = document.getElementById("admin-profile-avatar-container");
      if (container && typeof createAvatarHtml === 'function') {
           const avatarHtml = createAvatarHtml(currentUser, "40px");
           container.innerHTML = avatarHtml + '<div class="status-dot"></div>';
      }
  }

  // Initial fetch
  // Premier chargement
  await fetchUsers();

  // Lancer les mises à jour périodiques
  setInterval(fetchUsers, 60000); // Mettre à jour les utilisateurs toutes les minutes
  setInterval(updateIotActivity, 15000); // Mettre à jour l'activité IoT toutes les 15 secondes
});
