// frontend/class-a.js

import { initClassScene, updatePlayerEmoji } from './class-scene.js';

const API_URL = window.API_URL || "http://localhost:4000";

const token = localStorage.getItem("wbc_token");
let currentUser = JSON.parse(localStorage.getItem("wbc_user") || "null");

// Sécurité : si pas connecté -> retour login
if (!token || !currentUser) {
  window.location.href = "index.html";
}

// Empêcher ChatWidget de s'auto-initialiser (on l'instanciera avec la socket partagée)
window.WBC_DISABLE_AUTO_CHAT_INIT = true;

// Refresh User Profile logic is handled by loadProfile() below


const authHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
};

// DOM
const userInfoEl = document.getElementById("class-user-info");
const backHallBtn = document.getElementById("btn-back-hall");
const logoutBtn = document.getElementById("btn-logout");

const studentsUl = document.getElementById("students-ul");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("btn-send"); 
const btnAttach = document.getElementById("btn-attach");
const btnEmoji = document.getElementById("btn-emoji");
const emojiPicker = document.getElementById("emoji-picker");
const fileInput = document.getElementById("chat-file-input");
const statusEl = document.getElementById("class-status");

// Common Emojis
const EMOJIS = ["😀","😂","😍","😎","🤔","👍","👎","👋","🔥","🎉","❤️","✨","🎓","📚","💻","🚀","💡","⭐","❗","❓"];

// Init Emoji Picker
if (emojiPicker) {
    EMOJIS.forEach(emoji => {
        const span = document.createElement("div");
        span.className = "emoji-item";
        span.textContent = emoji;
        span.onclick = () => {
            chatInput.value += emoji;
            chatInput.focus();
        };
        emojiPicker.appendChild(span);
    });
}

function ensureChatWidget() {
  if (!window.io || !socket) return;
  if (window.wbcChatWidget && window.wbcChatWidget.socket === socket) {
    return window.wbcChatWidget;
  }
  if (typeof window.WBCChatWidget === 'function') {
    window.wbcChatWidget = new window.WBCChatWidget({ socket, currentUser, token });
  } else if (window.wbcChatWidget && socket) {
    window.wbcChatWidget.connectSocket(socket);
  }
  return window.wbcChatWidget;
}

// --------- Socket.IO ---------
let socket = null;
let avatar3DUrl = null;
let classConversationId = null;
const CLASS_ROOM_ID = "classA";
const CLASS_ROOM_NAME = "📚 Classe A";

function connectSocket() {
  socket = io(API_URL, {
    auth: { token },
  });

  socket.on("connect", () => {
    console.log("✅ Socket connecté (Classe A) :", socket.id);
    if (statusEl) statusEl.textContent = "Connecté au chat temps réel.";
    
    // Init 3D Scene first to ensure listeners are ready
    initClassScene(socket, currentUser, 'class-3d-zone', avatar3DUrl, { title: "BIENVENUE - CLASSE A" });

    // Ensure ChatWidget after scene init (so window.openPrivateChatWithAvatar exists)
    ensureChatWidget();

    // Hook clic avatar → chat privé
    if (typeof window.openPrivateChatWithAvatar === 'function') {
      window.openPrivateChatWithAvatar((userId, userName) => {
        const w = ensureChatWidget();
        if (w && typeof w.openPrivateChat === 'function') {
          if (!w.isOpen) w.toggleWidget();
          w.openPrivateChat(userId, userName);
        }
      });
    }

    // Join ClassA Room (for 3D)
    socket.emit("joinRoom", CLASS_ROOM_ID);
    
    // Send initial avatar URL if available
    if (avatar3DUrl) {
        socket.emit("player:update", { avatarUrl: avatar3DUrl });
    }

    // Init Persistent Chat
    initClassChat();
  });

  socket.on("connect_error", (err) => {
    console.error("Socket connect_error:", err);
    if (statusEl)
      statusEl.textContent = "Erreur de connexion au chat temps réel.";
  });

  // liste des participants
  socket.on("room:users", (users) => {
    if (!studentsUl) return;
    studentsUl.innerHTML = "";
    users.forEach((u) => {
      const li = document.createElement("li");
      const isMe = currentUser && (u.id === currentUser._id || u.id === currentUser.id || u.username === currentUser.username);
      const you = isMe ? " (toi)" : "";
      
      let avatarHtml = "";
      if (typeof window.createAvatarHtml === 'function') {
          avatarHtml = window.createAvatarHtml(u, "30px");
          avatarHtml = avatarHtml.replace('style="', 'style="margin-right:8px;');
      } else {
         avatarHtml = `<div style="width:24px;height:24px;border-radius:50%;background:#00ff88;display:inline-block;margin-right:8px;"></div>`;
      }
      
      li.innerHTML = `${avatarHtml}<span>${u.username}${you}</span>`;
      li.style.display = "flex";
      li.style.alignItems = "center";
      studentsUl.appendChild(li);
    });
  });

  // messages de chat (New Message Event via REST conversation room)
  socket.on("new_message", (msg) => {
    if (!chatMessages) return;
    const convMatch = String(msg.conversationId || msg.conversation?._id || "") === String(classConversationId);
    console.log(`[classA] ⚡ new_message reçu convMatch=${convMatch} classConvId=${classConversationId}`, msg);
    if (convMatch) appendMessage(msg);
  });

  // Fallback direct : écoute room:message / classA:message pour être SÛR de recevoir en temps réel
  const handleRoomMsgClass = (msg) => {
    if (!chatMessages) return;
    if (msg.roomId !== CLASS_ROOM_ID) return;
    console.log(`[classA] ⚡ room:message reçu (fallback)`, msg);
    const mapped = {
      ...msg,
      sender: msg.sender || {
        _id: msg.senderId,
        username: msg.senderName,
        fullName: msg.fullName,
        role: msg.role,
        avatar3DUrl: msg.avatarUrl,
      },
      content: msg.content || msg.text,
      attachmentUrl: msg.attachmentUrl || msg.fileUrl,
    };
    appendMessage(mapped);
  };
  socket.on("room:message", handleRoomMsgClass);
  socket.on("classA:message", handleRoomMsgClass);

  // Evaluation Update (Emoji)
  socket.on("evaluation:updated", (data) => {
    console.log("Evaluation updated:", data);
    
    // Update local currentUser
    if (!currentUser.academicStatus) currentUser.academicStatus = {};
    
    if (data.statusEmoji !== undefined) currentUser.academicStatus.statusEmoji = data.statusEmoji;
    if (data.activeEmojis !== undefined) currentUser.academicStatus.activeEmojis = data.activeEmojis;
    
    localStorage.setItem("wbc_user", JSON.stringify(currentUser));
    
    // Determine what to display/send
    const emojisToDisplay = (data.activeEmojis && data.activeEmojis.length > 0) 
        ? data.activeEmojis 
        : (data.statusEmoji || []);

    // Emit update to server to broadcast to everyone
    socket.emit("player:update", {
        statusEmoji: data.statusEmoji,
        activeEmojis: data.activeEmojis
    });

    // Update local scene immediately
    updatePlayerEmoji(socket.id, emojisToDisplay);
  });
}

async function initClassChat() {
    try {
        // 1. Use explicit CLASS_ROOM_ID ("classA") rather than depending on currentUser.studentClass
        // (Class A page always opens classA room chat regardless of user's own class)
        const res = await fetch(`${API_URL}/api/chat/conversations`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const raw = await res.json();
        const conversations = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);

        const classChat = conversations.find(c =>
            c && c.type === "class" && c.relatedClass === CLASS_ROOM_ID
        );

        if (classChat) {
            classConversationId = classChat._id;
            console.log("Found Class A Chat ID:", classConversationId);
            socket.emit("join_conversation", classConversationId);
            loadClassMessages();
        } else {
            console.warn("No class chat found for CLASS_ROOM_ID=" + CLASS_ROOM_ID + " (will be auto-created on first room:message)");
        }

    } catch (e) {
        console.error("Init class chat error:", e);
    }
}

async function loadClassMessages() {
    if (!classConversationId) return;
    try {
        const res = await fetch(`${API_URL}/api/chat/conversation/${classConversationId}/messages`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const messages = await res.json();
        
        chatMessages.innerHTML = ""; // Clear existing
        messages.forEach(msg => appendMessage(msg));
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
    } catch (e) {
        console.error("Load messages error:", e);
    }
}

function appendMessage(msg) {
    const senderIdRaw = (msg && msg.sender) ? (msg.sender._id || msg.sender.id || msg.sender) : (msg.senderId || msg.fromUserId);
    const myId = currentUser._id || currentUser.id;
    const isMe = String(senderIdRaw) === String(myId);

    // Normalize sender object (can be ObjectId string or populated object)
    let senderObj = msg.sender || {};
    if (typeof senderObj === "string" || typeof senderObj === "number") senderObj = { _id: senderObj };
    const senderName = senderObj.fullName || senderObj.username || msg.senderName || msg.fullName || "Inconnu";
    const senderAvatarUrl = senderObj.avatar3DUrl || senderObj.avatarUrl || msg.avatarUrl || null;

    const msgRow = document.createElement("div");
    msgRow.className = `chat-msg-row ${isMe ? "me" : "other"}`;
    
    // Avatar
    let avatarImg;
    if (typeof window.createAvatarHtml === 'function') {
        const sender = { username: senderName, avatarUrl: senderAvatarUrl };
        const avatarHtml = window.createAvatarHtml(sender, "32px");
        const temp = document.createElement("div");
        temp.innerHTML = avatarHtml;
        avatarImg = temp.firstChild;
        avatarImg.className = "chat-avatar";
        avatarImg.style.border = "1px solid var(--accent-cyan)";
        avatarImg.style.flexShrink = "0";
    } else {
        avatarImg = document.createElement("div");
        avatarImg.className = "chat-avatar";
        avatarImg.style.cssText = `width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--accent-cyan); flex-shrink: 0; background-color: #333;`;
    }
    
    // Message Bubble
    const bubble = document.createElement("div");
    bubble.className = `chat-msg ${isMe ? "me" : ""}`;
    
    const senderSpan = document.createElement("span");
    senderSpan.className = "sender";
    const time = new Date(msg.createdAt).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    senderSpan.textContent = `${senderName} • ${time}`;
    
    const textP = document.createElement("p");
    textP.textContent = msg.content || msg.text || "";
    textP.style.margin = "0";
    
    bubble.appendChild(senderSpan);
    bubble.appendChild(textP);

    // File support
    if (msg.attachmentUrl) {
        const fullUrl = `${API_URL}${msg.attachmentUrl}`;
        if (msg.type === "image" || msg.type === "gif") {
            const img = document.createElement("img");
            img.src = fullUrl;
            img.className = "chat-file-preview";
            img.onclick = () => window.open(fullUrl, "_blank");
            bubble.appendChild(img);
        } else {
            const link = document.createElement("a");
            link.href = fullUrl;
            link.target = "_blank";
            link.className = "chat-file-link";
            link.textContent = `📎 ${msg.fileName || "Fichier joint"}`;
            bubble.appendChild(link);
        }
    }
    
    // Order based on sender
    if (isMe) {
        msgRow.appendChild(bubble);
        msgRow.appendChild(avatarImg);
    } else {
        msgRow.appendChild(avatarImg);
        msgRow.appendChild(bubble);
    }
    
    chatMessages.appendChild(msgRow);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// --------- Charger profil basic ---------
async function loadProfile() {
  try {
    const res = await fetch(`${API_URL}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      localStorage.removeItem("wbc_token");
      localStorage.removeItem("wbc_user");
      window.location.href = "index.html";
      return;
    }

    if (!res.ok) {
      if (statusEl) statusEl.textContent = "Erreur chargement profil.";
      return;
    }
    const me = await res.json();
    if (userInfoEl) {
      userInfoEl.innerHTML = `<strong>${me.username || me.email}</strong>`;
    }
    
    // Fetch Avatar
    const resAvatar = await fetch(`${API_URL}/api/me/avatar`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (resAvatar.ok) {
        const data = await resAvatar.json();
        if (data.avatar3DUrl) {
            avatar3DUrl = data.avatar3DUrl;
        }
    }

    // Update local currentUser with full profile (including studentClass)
    Object.assign(currentUser, me);
    localStorage.setItem("wbc_user", JSON.stringify(currentUser));

    connectSocket();

  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.textContent = "Erreur serveur.";
  }
}

// Events
if (backHallBtn) {
  backHallBtn.addEventListener("click", () => {
    window.location.href = "hall.html";
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("wbc_token");
    localStorage.removeItem("wbc_user");
    window.location.href = "index.html";
  });
}

// Bouton Chat Classe → ouvre ChatWidget en mode salle
const btnOpenClassChat = document.getElementById("btn-open-class-chat");
if (btnOpenClassChat) {
  btnOpenClassChat.addEventListener("click", () => {
    const w = ensureChatWidget();
    if (w && typeof w.openRoomChat === 'function') {
      if (!w.isOpen) w.toggleWidget();
      w.openRoomChat(CLASS_ROOM_ID, CLASS_ROOM_NAME);
    }
  });
}
const btnOpenChatWidget = document.getElementById("btn-open-chat-widget");
if (btnOpenChatWidget) {
  btnOpenChatWidget.addEventListener("click", () => {
    const w = ensureChatWidget();
    if (w && !w.isOpen) w.toggleWidget();
  });
}

// Chat events
if (chatSendBtn) {
  chatSendBtn.addEventListener("click", () => sendMessage());
}
if (chatInput) {
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
}

// Emoji & File Events
if (btnEmoji) {
    btnEmoji.addEventListener("click", (e) => {
        e.stopPropagation();
        emojiPicker.classList.toggle("open");
    });
}
// Close emoji picker on click outside
document.addEventListener("click", (e) => {
    if (emojiPicker && !emojiPicker.contains(e.target) && e.target !== btnEmoji) {
        emojiPicker.classList.remove("open");
    }
});

if (btnAttach && fileInput) {
    btnAttach.addEventListener("click", () => fileInput.click());
    
    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        if (file) sendMessage(true);
    });
}

async function sendMessage(hasFile = false) {
  if (!classConversationId) {
      alert("Erreur: Chat non initialisé (pas de classe trouvée).");
      return;
  }
  
  const text = chatInput.value;
  const file = fileInput.files[0];

  if (!hasFile && !text.trim()) return;

  const formData = new FormData();
  formData.append("content", text);
  
  if (hasFile && file) {
      formData.append("attachment", file);
      // Determine type based on mime
      const type = file.type.startsWith("image/") ? "image" : "file";
      formData.append("type", type);
  } else {
      formData.append("type", "text");
  }

  // Optimistic UI (optional, skipped for simplicity/safety)

  try {
      const res = await fetch(`${API_URL}/api/chat/conversation/${classConversationId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }, // Content-Type is auto-set for FormData
          body: formData
      });

      if (res.ok) {
          const msg = await res.json();
          // Message will be appended via socket event 'new_message'
          chatInput.value = "";
          if (hasFile) fileInput.value = "";
      } else {
          console.error("Send message failed");
      }
  } catch (e) {
      console.error("Send message error:", e);
  }
}

// Init
loadProfile();
