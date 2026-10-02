// frontend/hall.js

import { initHallScene, updatePlayerEmoji } from './hall-scene.js';

const API_URL = window.API_URL || "http://localhost:4000";

const token = localStorage.getItem("wbc_token");
let currentUser = JSON.parse(localStorage.getItem("wbc_user") || "null");
let myRole = currentUser ? currentUser.role : "STUDENT";

// Sécurité : si pas connecté -> retour login
if (!token || !currentUser) {
  window.location.href = "index.html";
}

// Empêcher ChatWidget de s'auto-initialiser (on l'instanciera avec la socket partagée)
window.WBC_DISABLE_AUTO_CHAT_INIT = true;

// Socket
let socket = null;

function ensureChatWidget() {
  if (!window.io || !socket) return;
  if (window.wbcChatWidget && window.wbcChatWidget.socket === socket) {
    return window.wbcChatWidget;
  }
  // Instanciation avec socket partagée (gardes idempotentes dans chat-widget.js)
  if (typeof window.WBCChatWidget === 'function') {
    window.wbcChatWidget = new window.WBCChatWidget({ socket, currentUser, token });
  } else if (window.wbcChatWidget && socket) {
    window.wbcChatWidget.connectSocket(socket);
  }
  return window.wbcChatWidget;
}

function connectSocket() {
  if (typeof window.io === 'undefined') {
      console.error("Socket.io library not loaded!");
      alert("Erreur: Impossible de se connecter au serveur (Socket.io manquant).");
      return;
  }
  socket = window.io(API_URL, {
    auth: { token },
  });

  socket.on("connect", () => {
    console.log("✅ Socket connecté (Hall) :", socket.id);
    // Init scène 3D
    initHallScene(socket, currentUser, 'hall-scene-container', avatar3DUrl);
    // Init ChatWidget avec socket partagée (après initHallScene pour window.openPrivateChatWithAvatar disponible)
    ensureChatWidget();
    // Hook callback pour clic avatar → chat privé
    if (typeof window.openPrivateChatWithAvatar === 'function') {
      window.openPrivateChatWithAvatar((userId, userName) => {
        const w = ensureChatWidget();
        if (w && typeof w.openPrivateChat === 'function') {
          if (!w.isOpen) w.toggleWidget();
          w.openPrivateChat(userId, userName);
        }
      });
    }
    // Rejoindre le hall
    socket.emit("joinRoom", "hall");
  });
  
  socket.on("connect_error", (err) => {
      console.error("Erreur connexion socket:", err);
  });

  // Listen for evaluation updates from teacher
  socket.on("evaluation:updated", (data) => {
      console.log("Evaluation updated:", data);
      
      if (currentUser.academicStatus) {
           if (data.activeEmojis) currentUser.academicStatus.activeEmojis = data.activeEmojis;
           if (data.statusEmoji) currentUser.academicStatus.statusEmoji = data.statusEmoji;
           if (data.remarks) currentUser.academicStatus.remarks = data.remarks;
      }
      
      const updateData = {};
      if (data.statusEmoji !== undefined) updateData.statusEmoji = data.statusEmoji;
      if (data.activeEmojis !== undefined) updateData.activeEmojis = data.activeEmojis;
      
      socket.emit("player:update", updateData);
      
      if (socket && socket.id) {
          updatePlayerEmoji(socket.id, data.activeEmojis || data.statusEmoji);
      }
  });
}

// --- Éléments DOM ---
const hallUserInfo = document.getElementById("hall-user-info"); // Old selector (unused now in HTML but might be refd)
const hudUsername = document.getElementById("hud-username");
const hudRole = document.getElementById("hud-role");
const hudAvatar = document.getElementById("hud-avatar-preview");
const btnLogout = document.getElementById("logout-btn");
const btnEditAvatar = document.getElementById("btn-edit-avatar");
const btnOpenHallChat = document.getElementById("btn-open-hall-chat");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const hallInstructionBtn = document.getElementById("hall-instruction-btn");
const helpModal = document.getElementById("help-modal");
const closeHelpBtn = document.getElementById("close-help-btn");

console.log("[HallJS] DOM refs chargés :", {
  btnOpenHallChat: !!btnOpenHallChat,
  btnLogout: !!btnLogout,
  btnEditAvatar: !!btnEditAvatar,
  fullscreenBtn: !!fullscreenBtn,
  hallInstructionBtn: !!hallInstructionBtn,
});

if (btnOpenHallChat) {
  btnOpenHallChat.addEventListener("click", () => {
    console.log("[HallJS] 👉 Clic bouton Chat Hall détecté");
    // 1) Lazy init socket if not connected yet
    if (!socket) connectSocket();

    // 2) Try now + retry up to 10x (2s) to wait for widget init
    let tries = 0;
    const tryOpen = () => {
      console.log(`[HallJS] tryOpen Chat Hall, tries=${tries}, io=${typeof window.io}, socket=${socket?.id || 'null'}, wbcChatWidget=${window.wbcChatWidget ? 'ok' : 'null'}, openRoomChat=${typeof (window.wbcChatWidget && window.wbcChatWidget.openRoomChat)}`);
      const w = ensureChatWidget();
      if (w && typeof w.openRoomChat === 'function') {
        if (!w.isOpen) w.toggleWidget();
        w.openRoomChat("hall", "🏛️ Hall WES'SUP");
      } else if (tries < 10) {
        tries++;
        setTimeout(tryOpen, 200);
      } else {
        console.warn("[Chat Hall] Impossible d'initialiser le ChatWidget après 2s.");
        // Direct fallback: open widget UI anyway via launcher click
        const launcher = document.getElementById("chat-launcher");
        if (launcher) launcher.click();
      }
    };
    tryOpen();
  });
  console.log("[HallJS] ✅ Listener btn Chat Hall ATTACHÉ");
} else {
  console.error("[HallJS] ❌ bouton #btn-open-hall-chat INTROUVABLE dans le DOM");
}

let avatar3DUrl = null;

// --------- Charger le profil + l'avatar depuis le backend ---------

async function loadMe() {
  try {
    // 1) Profil
    const resMe = await fetch(`${API_URL}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (resMe.status === 401) {
      localStorage.removeItem("wbc_token");
      localStorage.removeItem("wbc_user");
      window.location.href = "index.html";
      return;
    }

    if (!resMe.ok) {
        console.error("Erreur chargement profil");
        return;
    }

    const me = await resMe.json();
    
    // UPDATE CURRENT USER
    currentUser = me;
    localStorage.setItem("wbc_user", JSON.stringify(currentUser));
    
    // 2) Avatar — UTILISER createAvatarHtml (fallback 5-niveaux) + refresh auto sur snapshot prêt
    if (me.avatar3DUrl) avatar3DUrl = me.avatar3DUrl;
    if (hudAvatar && typeof window.createAvatarHtml === "function") {
      hudAvatar.style.padding = "0";
      hudAvatar.style.background = "transparent";
      hudAvatar.style.display = "flex";
      hudAvatar.style.alignItems = "center";
      hudAvatar.style.justifyContent = "center";
      hudAvatar.innerHTML = window.createAvatarHtml(me, "40px");
    }

    (function bindHallHudAvatarRefresh() {
      if (!hudAvatar || bindHallHudAvatarRefresh.done) return;
      bindHallHudAvatarRefresh.done = true;

      function refresh() {
        if (typeof window.createAvatarHtml !== "function" || !currentUser) return;
        hudAvatar.style.padding = "0";
        hudAvatar.style.background = "transparent";
        hudAvatar.innerHTML = window.createAvatarHtml(currentUser, "40px");
      }

      try { window.addEventListener("wbc:avatarThumbReady", refresh); } catch {}
      let lastHash = "";
      setInterval(() => {
        try {
          const uid = String(currentUser?.id || currentUser?._id || "").trim();
          if (!uid) return;
          const raw = localStorage.getItem("wbc_avatar_thumb:" + uid) || "";
          const hash = raw.slice(-16);
          if (hash !== lastHash) { lastHash = hash; refresh(); }
        } catch {}
      }, 2000);
    })();

    // Update HUD
  if (hudUsername) hudUsername.textContent = me.username || me.fullName || me.email || "Inconnu";
  if (hudRole) hudRole.textContent = me.role || "VISITOR";
  myRole = me.role || "STUDENT";
  
  // Hide edit avatar button for teachers/admins!
  if (btnEditAvatar) {
    if (me.role === "TEACHER" || me.role === "ADMIN") {
      btnEditAvatar.style.display = "none";
    } else {
      btnEditAvatar.style.display = "";
    }
  }

    // 3) Connecter le socket (après avoir le user)
    connectSocket();

  } catch (err) {
    console.error("Erreur loadMe:", err);
  }
}

// --------- Boutons ---------

// Déconnexion
if (btnLogout) {
  btnLogout.addEventListener("click", () => {
    localStorage.removeItem("wbc_token");
    localStorage.removeItem("wbc_user");
    // Rediriger la fenêtre principale (top) pour sortir de l'iframe platform.html
    window.top.location.href = "index.html";
  });
}

// Modifier Avatar — attacher D'ABORD un listener, puis visibilité selon role
if (btnEditAvatar) {
  btnEditAvatar.addEventListener("click", () => {
    window.location.href = "avatar-setup.html";
  });
}

// Fullscreen
if (fullscreenBtn) {
  fullscreenBtn.addEventListener("click", () => {
    const doc = document;
    const target = doc.documentElement;
    if (!doc.fullscreenElement) {
      (target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen)?.call(target);
    } else {
      (doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen)?.call(doc);
    }
  });
}

// Aide (bouton "?" bas-gauche)
if (hallInstructionBtn) {
  hallInstructionBtn.addEventListener("click", () => {
    if (helpModal) helpModal.style.display = "flex";
  });
}
if (closeHelpBtn) {
  closeHelpBtn.addEventListener("click", () => {
    if (helpModal) helpModal.style.display = "none";
  });
}
if (helpModal) {
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) helpModal.style.display = "none";
  });
}

// Ouvre le menu des portails (Classes A / B) — appelé depuis hall-scene.js
window.openPortalMenu = function () {
  const menu = document.getElementById('portal-menu');
  if (menu) menu.classList.add('active');
};
window.closePortalMenu = function () {
  const menu = document.getElementById('portal-menu');
  if (menu) menu.classList.remove('active');
};

// --------- Init ---------
loadMe();

// ----- Notifications & Assignments Logic -----
const btnNotifications = document.getElementById("btn-notifications");
const notificationsModal = document.getElementById("notifications-modal");
const closeNotificationsBtn = document.getElementById("close-notifications-btn");
const notificationsList = document.getElementById("notifications-list");
const notificationBadge = document.getElementById("notification-badge");
const viewAssignmentsBtn = document.getElementById("view-assignments-btn");

const assignmentsModal = document.getElementById("assignments-modal");
const closeAssignmentsBtn = document.getElementById("close-assignments-btn");
const assignmentsList = document.getElementById("assignments-list");

const submitModal = document.getElementById("submit-modal");
const closeSubmitBtn = document.getElementById("close-submit-btn");
const submitForm = document.getElementById("submit-form");
const submitContentInput = document.getElementById("submit-content");
const submitFileInput = document.getElementById("submit-file");
const submitAssignmentIdInput = document.getElementById("submit-assignment-id");

// Notifications Listeners
if (btnNotifications) {
    btnNotifications.addEventListener("click", () => {
        // Request browser notification permission at first user gesture (safe)
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "default") {
            Notification.requestPermission().then(p => console.log("[Hall] Nav Notification perm:", p));
          }
        } catch {}
        openNotificationsModal();
    });
}

if (closeNotificationsBtn) {
    closeNotificationsBtn.addEventListener("click", () => {
        notificationsModal.style.display = "none";
    });
}

if (viewAssignmentsBtn) {
    viewAssignmentsBtn.addEventListener("click", () => {
        notificationsModal.style.display = "none"; // Close notifications
        openAssignmentsModal(); // Open assignments
    });
}

// Assignments Listeners
if (closeAssignmentsBtn) {
    closeAssignmentsBtn.addEventListener("click", () => {
        assignmentsModal.style.display = "none";
    });
}

if (closeSubmitBtn) {
    closeSubmitBtn.addEventListener("click", () => {
        submitModal.style.display = "none";
    });
}

// --- Notifications Functions ---

async function loadNotifications() {
    try {
        const res = await fetch(`${API_URL}/api/notifications`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
            const notifications = await res.json();
            updateNotificationBadge(notifications);
        }
    } catch (err) {
        console.error("Error loading notifications:", err);
    }
}

function updateNotificationBadge(notifications) {
    const unreadCount = notifications.filter(n => !n.read).length;
    if (notificationBadge) {
        if (unreadCount > 0) {
            notificationBadge.textContent = unreadCount;
            notificationBadge.style.display = "inline-flex";
        } else {
            notificationBadge.style.display = "none";
        }
    }
}

async function openNotificationsModal() {
    notificationsModal.style.display = "flex";
    notificationsList.innerHTML = `<p style="text-align:center; opacity:0.7;">Chargement...</p>`;

    let restNotifs = [];
    try {
        const res = await fetch(`${API_URL}/api/notifications`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
            restNotifs = await res.json();
            if (!Array.isArray(restNotifs)) restNotifs = [];
        }
    } catch (err) {
        console.error("REST notif load:", err);
    }

    // Chat push notifications (in-memory from widget)
    let chatNotifs = [];
    try {
        const w = window.wbcChatWidget;
        if (w && typeof w.getNotifications === "function") {
            const list = w.getNotifications() || [];
            chatNotifs = list.map(n => ({
                id: n.id,
                type: n.roomId ? "ROOM_MESSAGE" : "PRIVATE_MESSAGE",
                title: n.title || "Nouveau message",
                message: n.body || "",
                createdAt: n.timestamp,
                read: !!n.read,
                source: "chat",
                _conversationId: n.conversationId,
                _roomId: n.roomId,
                _fromUserId: n.from,
                _fromUserName: n.fromName,
            }));
            if (w && typeof w.markAllNotificationsRead === "function") {
                try { w.markAllNotificationsRead(); } catch {}
            }
        }
    } catch (e) { console.warn("chat notifs merge warn:", e); }

    // Merge + sort newest first
    const merged = [
      ...restNotifs.map(n => ({ ...n, source: n.source || "rest" })),
      ...chatNotifs
    ].sort((a,b) => new Date(b.createdAt || b.timestamp) - new Date(a.createdAt || a.timestamp));

    renderNotifications(merged);

    try { markAllNotificationsRead(); } catch {}
}

async function markAllNotificationsRead() {
    try {
        await fetch(`${API_URL}/api/notifications/read-all`, {
            method: "PUT",
            headers: { "Authorization": `Bearer ${token}` }
        });
    } catch (err) {
        console.error("Error marking read:", err);
    }
    if (notificationBadge) notificationBadge.style.display = "none";
    try {
      const w = window.wbcChatWidget;
      if (w && typeof w.markAllNotificationsRead === "function") w.markAllNotificationsRead();
    } catch {}
}

function renderNotifications(notifications) {
    notificationsList.innerHTML = "";

    if (!Array.isArray(notifications) || notifications.length === 0) {
        notificationsList.innerHTML = `<p style="text-align:center; opacity:0.7;">Aucune notification.</p>`;
        return;
    }

    notifications.forEach(n => {
        const item = document.createElement("div");
        item.style.background = n.read ? "rgba(255,255,255,0.05)" : "rgba(0, 242, 255, 0.1)";
        item.style.border = "1px solid rgba(255,255,255,0.1)";
        if (!n.read) item.style.borderColor = "rgba(0, 242, 255, 0.3)";
        item.style.borderRadius = "8px";
        item.style.padding = "12px";
        item.style.marginBottom = "10px";
        item.style.cursor = "pointer";
        item.style.transition = "background 0.2s";

        item.addEventListener("mouseenter", () => {
            item.style.background = "rgba(255,255,255,0.1)";
        });
        item.addEventListener("mouseleave", () => {
            item.style.background = n.read ? "rgba(255,255,255,0.05)" : "rgba(0, 242, 255, 0.1)";
        });

        item.addEventListener("click", () => {
             // Handle action based on type
             if (n.type === "ASSIGNMENT_NEW" || n.type === "GRADE_NEW") {
                 notificationsModal.style.display = "none";
                 openAssignmentsModal();
             } else if (n.type === "SUBMISSION_NEW") {
                 if (myRole === "TEACHER" || myRole === "ADMIN") {
                     window.location.href = "teacher-dashboard.html";
                 }
             } else if (n.type === "FEED_NEW") {
                 window.location.href = "feed.html";
             } else if (n.type === "ROOM_MESSAGE" || n.type === "PRIVATE_MESSAGE") {
                 // Open chat widget on matching target
                 notificationsModal.style.display = "none";
                 const w = ensureChatWidget();
                 if (!w) return;
                 if (!w.isOpen) w.toggleWidget();
                 if (n.type === "ROOM_MESSAGE" && n._roomId) {
                     const roomMap = { hall: "🏛️ Hall WES'SUP", classA: "📚 Classe A", classB: "📚 Classe B" };
                     w.openRoomChat(n._roomId, roomMap[n._roomId] || n._roomId);
                 } else if (n.type === "PRIVATE_MESSAGE") {
                     if (typeof w.openPrivateChat === "function") {
                         w.openPrivateChat(n._fromUserId, n._fromUserName);
                     } else if (n._conversationId) {
                         w.openConversation(n._conversationId);
                     }
                 }
             }
        });

        const time = new Date(n.createdAt || n.timestamp).toLocaleString();

        let icon = '<i class="fa-solid fa-info-circle"></i>';
        if (n.type === "ASSIGNMENT_NEW") icon = '<i class="fa-solid fa-book" style="color:#00f2ff;"></i>';
        if (n.type === "SUBMISSION_NEW") icon = '<i class="fa-solid fa-file-import" style="color:#00ff88;"></i>';
        if (n.type === "GRADE_NEW") icon = '<i class="fa-solid fa-star" style="color:#ffcc00;"></i>';
        if (n.type === "FEED_NEW") icon = '<i class="fa-solid fa-rss" style="color:#e91e63;"></i>';
        if (n.type === "PRIVATE_MESSAGE") icon = '<i class="fa-solid fa-comment" style="color:#ec4899;"></i>';
        if (n.type === "ROOM_MESSAGE") icon = '<i class="fa-solid fa-comments" style="color:#00f2ff;"></i>';

        item.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px;">
                <div style="font-size:1.2rem;">${icon}</div>
                <div style="flex:1;">
                    <div style="font-weight:bold; color:white; font-size:0.95rem;">${n.title || "Notification"}</div>
                    <div style="font-size:0.85rem; color:#ccc;">${n.message || ""}</div>
                    <div style="font-size:0.7rem; color:#888; margin-top:4px;">${time}</div>
                </div>
                ${!n.read ? '<div style="width:8px; height:8px; background:#00f2ff; border-radius:50%;"></div>' : ''}
            </div>
        `;

        notificationsList.appendChild(item);
    });
}

// --- Assignments Functions ---

async function openAssignmentsModal() {
    assignmentsModal.style.display = "flex";
    assignmentsList.innerHTML = `<p style="text-align:center; opacity:0.7;">Chargement...</p>`;

    if (myRole === 'TEACHER' || myRole === 'ADMIN') {
        // --- VUE ENSEIGNANT ---
        try {
            const res = await fetch(`${API_URL}/api/assignments/teacher`, {
                headers: { "Authorization": `Bearer ${token}` }
            });

            if (res.ok) {
                const assignments = await res.json();
                renderTeacherAssignments(assignments);
            } else {
                assignmentsList.innerHTML = `<p style="color:#ff3366; text-align:center;">Erreur chargement (Prof).</p>`;
            }
        } catch (err) {
            console.error(err);
            assignmentsList.innerHTML = `<p style="color:#ff3366; text-align:center;">Erreur réseau.</p>`;
        }
    } else {
        // --- VUE ÉTUDIANT ---
        try {
            const res = await fetch(`${API_URL}/api/assignments/student`, {
                headers: { "Authorization": `Bearer ${token}` }
            });

            if (res.ok) {
                const assignments = await res.json();
                renderAssignments(assignments);
            } else {
                assignmentsList.innerHTML = `<p style="color:#ff3366; text-align:center;">Erreur lors du chargement des devoirs.</p>`;
            }
        } catch (err) {
            console.error(err);
            assignmentsList.innerHTML = `<p style="color:#ff3366; text-align:center;">Erreur réseau.</p>`;
        }
    }
}

function renderTeacherAssignments(assignments) {
    assignmentsList.innerHTML = "";
    
    const header = document.createElement("div");
    header.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px;">
            <p style="color:#aaa; font-size:0.9rem; margin:0;">Vos devoirs créés</p>
            <button onclick="window.location.href='teacher-dashboard.html'" style="background:rgba(0, 242, 255, 0.2); border:1px solid #00f2ff; color:#00f2ff; padding:5px 10px; border-radius:6px; cursor:pointer; font-size:0.8rem;">
                <i class="fa-solid fa-chart-line"></i> Dashboard
            </button>
        </div>
    `;
    assignmentsList.appendChild(header);

    if (assignments.length === 0) {
        assignmentsList.innerHTML += `<p style="text-align:center; opacity:0.7;">Aucun devoir créé.</p>`;
        return;
    }

    assignments.forEach(a => {
        const card = document.createElement("div");
        card.style.background = "rgba(255,255,255,0.05)";
        card.style.border = "1px solid rgba(255,255,255,0.1)";
        card.style.borderRadius = "12px";
        card.style.padding = "15px";
        card.style.marginBottom = "15px";
        card.style.display = "flex";
        card.style.justifyContent = "space-between";
        card.style.alignItems = "center";
        
        const subCount = a.submissions ? a.submissions.length : 0;

        card.innerHTML = `
            <div>
                <h3 style="margin:0 0 5px 0; color:white;">${a.title}</h3>
                <div style="font-size:0.85rem; color:#ccc;">${a.course ? a.course.title : "Cours inconnu"} • Pour le ${new Date(a.dueDate).toLocaleDateString()}</div>
            </div>
            <div style="text-align:right;">
                <span style="display:block; font-size:1.2rem; font-weight:bold; color:${subCount > 0 ? '#00ff88' : '#aaa'};">${subCount}</span>
                <span style="font-size:0.7rem; color:#aaa; text-transform:uppercase;">Rendus</span>
            </div>
        `;
        assignmentsList.appendChild(card);
    });
}

function renderAssignments(assignments) {
    assignmentsList.innerHTML = "";

    if (assignments.length === 0) {
        assignmentsList.innerHTML = `<p style="text-align:center; opacity:0.7;">Aucun devoir à faire.</p>`;
        return;
    }

    // Grouper par cours
    const grouped = {};
    assignments.forEach(a => {
        const courseTitle = a.course ? a.course.title : "Autres";
        if (!grouped[courseTitle]) {
            grouped[courseTitle] = [];
        }
        grouped[courseTitle].push(a);
    });

    // Afficher par groupe
    Object.keys(grouped).forEach(courseTitle => {
        const groupHeader = document.createElement("div");
        groupHeader.innerHTML = `<h3 style="color:#00f2ff; margin: 20px 0 10px 0; border-bottom: 1px solid rgba(0, 242, 255, 0.3); padding-bottom: 5px; font-family: 'Orbitron', sans-serif;">${courseTitle}</h3>`;
        assignmentsList.appendChild(groupHeader);

        grouped[courseTitle].forEach(a => {
            const card = document.createElement("div");
            card.style.background = "rgba(255,255,255,0.05)";
            card.style.border = "1px solid rgba(255,255,255,0.1)";
            card.style.borderRadius = "12px";
            card.style.padding = "15px";
            card.style.marginBottom = "15px";
            card.style.display = "flex";
            card.style.justifyContent = "space-between";
            card.style.alignItems = "center";
            card.style.flexWrap = "wrap";
            card.style.gap = "10px";

            let statusBadge = "";
            let actionBtn = "";

            if (a.status === "Graded") {
                statusBadge = `<span style="background:rgba(0, 255, 136, 0.2); color:#00ff88; padding:4px 8px; border-radius:4px; font-size:0.8rem; border:1px solid rgba(0, 255, 136, 0.4);">Noté : ${a.mySubmission.grade}/20</span>`;
                actionBtn = `<button onclick="alert('Feedback: ${a.mySubmission.feedback || 'Aucun feedback'}')" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; padding:8px 12px; border-radius:8px; cursor:pointer;">Voir Feedback</button>`;
            } else if (a.status === "Submitted") {
                statusBadge = `<span style="background:rgba(0, 168, 255, 0.2); color:#00a8ff; padding:4px 8px; border-radius:4px; font-size:0.8rem; border:1px solid rgba(0, 168, 255, 0.4);">Rendu</span>`;
                actionBtn = `<button class="submit-btn" data-id="${a._id}" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; padding:8px 12px; border-radius:8px; cursor:pointer;">Modifier</button>`;
            } else {
                statusBadge = `<span style="background:rgba(255, 204, 0, 0.2); color:#ffcc00; padding:4px 8px; border-radius:4px; font-size:0.8rem; border:1px solid rgba(255, 204, 0, 0.4);">À faire</span>`;
                actionBtn = `<button class="submit-btn" data-id="${a._id}" style="background:linear-gradient(90deg, #00f2ff, #00a8ff); border:none; color:black; font-weight:bold; padding:8px 16px; border-radius:8px; cursor:pointer; box-shadow:0 0 10px rgba(0, 242, 255, 0.3);">Rendre</button>`;
            }

            card.innerHTML = `
                <div style="flex:1; min-width:200px;">
                    <h3 style="margin:0 0 5px 0; color:white;">${a.title}</h3>
                    <div style="font-size:0.85rem; color:#ccc; margin-bottom:5px;">Pour le ${new Date(a.dueDate).toLocaleDateString()}</div>
                    <div style="font-size:0.9rem; color:#aaa;">${a.description || "Pas de description."}</div>
                    ${a.attachmentUrl ? `<div style="margin-top:8px;"><a href="${API_URL}${a.attachmentUrl}" target="_blank" style="display:inline-flex; align-items:center; gap:5px; background:rgba(0,242,255,0.1); border:1px solid rgba(0,242,255,0.3); color:#00f2ff; padding:5px 10px; border-radius:6px; text-decoration:none; font-size:0.8rem;"><i class="fa-solid fa-file-arrow-down"></i> Télécharger le sujet</a></div>` : ""}
                </div>
                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
                    ${statusBadge}
                    ${actionBtn}
                </div>
            `;

            assignmentsList.appendChild(card);
        });
    });

    // Add listeners to submit buttons
    document.querySelectorAll(".submit-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.id;
            openSubmitModal(id);
        });
    });
}

function openSubmitModal(assignmentId) {
    submitAssignmentIdInput.value = assignmentId;
    submitContentInput.value = ""; // Clear previous
    if (submitFileInput) submitFileInput.value = ""; // Clear file
    submitModal.style.display = "flex";
}

if (submitForm) {
    submitForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const id = submitAssignmentIdInput.value;
        const content = submitContentInput.value;
        const file = submitFileInput ? submitFileInput.files[0] : null;
        const btn = submitForm.querySelector("button[type='submit']");
        
        if (!file) {
            alert("Veuillez sélectionner un fichier à rendre.");
            return;
        }

        btn.disabled = true;
        btn.textContent = "Envoi...";

        const formData = new FormData();
        formData.append("content", content);
        if (file) {
            formData.append("file", file);
        }

        try {
            const res = await fetch(`${API_URL}/api/assignments/${id}/submit`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`
                },
                body: formData
            });

            if (res.ok) {
                alert("Devoir rendu avec succès !");
                submitModal.style.display = "none";
                openAssignmentsModal(); // Refresh list
            } else {
                alert("Erreur lors de l'envoi.");
            }
        } catch (err) {
            console.error(err);
            alert("Erreur réseau.");
        } finally {
            btn.disabled = false;
            btn.textContent = "Envoyer";
        }
    });
}
