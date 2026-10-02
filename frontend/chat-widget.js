// chat-widget.js
const API_BASE_URL = window.API_URL || "http://localhost:4000";
const CHAT_API_URL = `${API_BASE_URL}/api/chat`;

class ChatWidget {
    constructor(options = {}) {
        this.socket = options.socket || null;
        this.currentUser = options.currentUser || JSON.parse(localStorage.getItem("wbc_user") || "null");
        this.token = options.token || localStorage.getItem("wbc_token");
        this.isOpen = false;
        this.currentConversationId = null;
        this.activeView = "list"; // list, room, search, group-create
        this.selectedUsersForGroup = new Set();
        this.unreadCount = 0;

        this.onlineUserIds = new Set();
        this.onlineUsersMap = new Map(); // userId -> { fullName, roomsPrimary, online }
        this.roomConversationIds = new Map(); // roomId -> conversationId
        this.roomMessages = { hall: [], classA: [], classB: [], lobby: [] };
        this.currentRoomChatId = null; // when chatting in a ROOM not a conversationId
        this.currentRoomChatName = null;
        this._presenceBound = false;

        this.emojis = ["😀", "😂", "🥰", "😎", "🤔", "😭", "👍", "👎", "🔥", "❤️", "🎉", "👀", "🚀", "💯", "👋", "🙏", "✅", "❌", "✨", "🤢", "🤮", "🤡", "👻", "💀"];

        this.notifications = []; // { id, title, body, from, conversationId, roomId, timestamp, read }
        this._onNotificationCallbacks = [];

        if (!this.currentUser || !this.token) {
            console.warn("[ChatWidget] Aucun utilisateur/token — widget désactivé.");
            return;
        }

        this.requestNotificationPermission();
        this.initUI();
        this.connectSocket(options.socket);
        this.loadConversations();

        window.wbcChatWidget = this;

        // Request browser notification permission at FIRST USER GESTURE (Chrome 110+ requirement)
        const _self = this;
        const _grantPerm = function () {
            try { _self.requestNotificationPermission(); } catch {}
            try { document.removeEventListener("click", _grantPerm, true); } catch {}
            try { document.removeEventListener("keydown", _grantPerm, true); } catch {}
            try { document.removeEventListener("touchstart", _grantPerm, true); } catch {}
        };
        try { document.addEventListener("click", _grantPerm, true); } catch {}
        try { document.addEventListener("keydown", _grantPerm, true); } catch {}
        try { document.addEventListener("touchstart", _grantPerm, true); } catch {}
    }

    // ---------- NOTIFICATIONS ----------
    requestNotificationPermission() {
        if (typeof Notification === "undefined") return false;
        if (Notification.permission === "granted") return true;
        if (Notification.permission === "denied") return false;
        try {
            Notification.requestPermission().then(perm => {
                console.log("[ChatWidget] Notification permission:", perm);
            }).catch(() => {});
        } catch {}
        return Notification.permission === "granted";
    }

    _meId() {
        const u = this.currentUser || {};
        return String(u.id || u._id || "");
    }

    _pushNotification(data) {
        const entry = {
            id: data.id || ("ntf_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8)),
            title: data.title || "Message",
            body: data.body || "",
            from: data.from || null,
            fromName: data.fromName || data.senderName || "WES'SUP",
            conversationId: data.conversationId || null,
            roomId: data.roomId || null,
            timestamp: new Date().toISOString(),
            read: false,
        };
        this.notifications.unshift(entry);
        if (this.notifications.length > 200) this.notifications.pop();
        this._updateBellBadge();
        this._onNotificationCallbacks.forEach(fn => { try { fn(entry); } catch {} });
        return entry;
    }

    onNewNotification(fn) {
        if (typeof fn !== "function") return;
        this._onNotificationCallbacks.push(fn);
    }

    getUnreadNotificationCount() {
        return this.notifications.filter(n => !n.read).length;
    }

    getNotifications() {
        return this.notifications.slice(0, 50);
    }

    markAllNotificationsRead() {
        this.notifications.forEach(n => n.read = true);
        this._updateBellBadge();
    }

    _updateBellBadge() {
        const count = this.getUnreadNotificationCount();
        try {
            const badge = document.getElementById("notification-badge");
            if (badge) {
                badge.textContent = String(count);
                badge.style.display = count > 0 ? "flex" : "none";
            }
        } catch {}
        try {
            if (typeof window.updateBellBadge === "function") window.updateBellBadge(count);
        } catch {}
    }

    showNativeNotification(title, body, opts = {}) {
        try {
            if (typeof Notification === "undefined") return null;
            if (Notification.permission !== "granted") {
                this.requestNotificationPermission();
                return null;
            }
            const me = this._meId();
            const fromId = String(opts.fromId || opts.senderId || "");
            if (fromId && fromId === me) return null;
            const icon = opts.icon || "/logo wess.png";
            const notif = new Notification(title, { body: body.substring(0, 180), icon, silent: !!opts.silent });
            const convId = opts.conversationId;
            const roomId = opts.roomId;
            const openPrivateWith = opts.openPrivateWithUserId || null;
            const openPrivateWithName = opts.openPrivateWithUserName || null;
            const self = this;
            notif.onclick = function (ev) {
                ev.preventDefault();
                try { window.focus(); } catch {}
                if (!self.isOpen) self.toggleWidget();
                if (openPrivateWith && typeof self.openPrivateChat === "function") {
                    self.openPrivateChat(openPrivateWith, openPrivateWithName);
                } else if (roomId && typeof self.openRoomChat === "function") {
                    self.openRoomChat(roomId, opts.roomName || roomId);
                } else if (convId) {
                    self.openConversation(convId);
                }
                try { notif.close(); } catch {}
            };
            setTimeout(() => { try { notif.close(); } catch {} }, 8000);
            return notif;
        } catch (e) {
            console.warn("[ChatWidget] Native notif error:", e);
            return null;
        }
    }

    _notifyPrivate(senderId, senderName, text, conversationId, attachment) {
        const me = this._meId();
        if (senderId && senderId === me) return;
        const name = senderName || "Nouveau message privé";
        const title = `💬 ${name}`;
        const body = attachment ? `📎 ${attachment}` : (text || "Nouveau message");
        const inView = this.currentConversationId && String(this.currentConversationId) === String(conversationId) && this.isOpen;
        if (!inView) {
            this.showNativeNotification(title, body, {
                fromId: senderId,
                conversationId,
                openPrivateWithUserId: senderId,
                openPrivateWithUserName: senderName,
            });
            this._pushNotification({
                title, body, from: senderId, fromName: senderName,
                conversationId,
            });
        }
    }

    _notifyRoom(roomId, roomName, senderId, senderName, text, conversationId, attachment) {
        const me = this._meId();
        if (senderId && senderId === me) return;
        const inView = (this.currentRoomChatId === roomId && this.isOpen) ||
                       (this.currentConversationId && String(this.currentConversationId) === String(conversationId) && this.isOpen);
        if (inView) return;

        const rname = roomName || roomId || "";
        const title = `🏛️ ${rname} · ${senderName || "Anonyme"}`;
        const body = attachment ? `📎 ${attachment}` : (text || "Nouveau message");
        this.showNativeNotification(title, body, {
            fromId: senderId,
            roomId,
            roomName: rname,
            conversationId,
        });
        this._pushNotification({
            title, body, from: senderId, fromName: senderName,
            roomId, conversationId,
        });
    }

    initUI() {
        // Create styles link if not exists
        if (!document.querySelector("link[href='chat-widget.css']")) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = "chat-widget.css";
            document.head.appendChild(link);
        }

        // Inject online-dot + chat room badge + emoji picker styles dynamically
        if (!document.getElementById("chat-widget-extra-styles")) {
            const style = document.createElement("style");
            style.id = "chat-widget-extra-styles";
            style.textContent = `
                .online-dot{position:absolute;right:-2px;bottom:-2px;width:12px;height:12px;border-radius:50%;border:2px solid #0f0f1e;z-index:3;}
                .online-dot.online{background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,.7);}
                .online-dot.offline{background:#64748b;}
                .user-result, .chat-item{position:relative;}
                .user-result .online-dot{right:8px;bottom:8px;}
                .chat-room-unread{position:absolute;right:10px;top:50%;transform:translateY(-50%);min-width:18px;height:18px;border-radius:9px;background:#ec4899;color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center;padding:0 5px;font-weight:700;}
                .chat-picker{display:none;position:absolute;left:12px;right:12px;bottom:64px;max-height:180px;overflow-y:auto;padding:10px;background:#0b1220;border:1px solid rgba(0,242,255,.25);border-radius:10px;grid-template-columns:repeat(9,1fr);gap:4px;z-index:2;box-shadow:0 8px 24px rgba(0,0,0,.5);}
                .chat-picker.active{display:grid;}
                .chat-picker::-webkit-scrollbar{width:6px;}
                .chat-picker::-webkit-scrollbar-thumb{background:rgba(0,242,255,.3);border-radius:3px;}
                .emoji-item{padding:6px 0;font-size:20px;border-radius:6px;text-align:center;cursor:pointer;transition:background .15s;user-select:none;}
                .emoji-item:hover{background:rgba(0,242,255,.15);transform:scale(1.15);}
            `;
            document.head.appendChild(style);
        }

        // Ensure Font Awesome is loaded
        if (!document.querySelector("link[href*='font-awesome']")) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css";
            document.head.appendChild(link);
        }

        // Create Widget HTML
        const container = document.createElement("div");
        container.innerHTML = `
            <div class="chat-widget-launcher" id="chat-launcher">
                <i class="fas fa-comments"></i>
                <div class="chat-unread-badge" id="chat-badge">0</div>
            </div>

            <div class="chat-widget-container" id="chat-widget-root">
                <!-- LIST VIEW -->
                <div class="chat-view active" id="view-list">
                    <div class="chat-header">
                        <div class="chat-title"><i class="fas fa-comments"></i> Messages</div>
                        <button class="chat-close-btn" id="chat-minimize"><i class="fas fa-minus"></i></button>
                    </div>
                    <div class="chat-list" id="chat-list-body">
                        <!-- Items -->
                    </div>
                    <div class="chat-view-actions">
                         <button class="btn-new-chat" id="btn-new-chat-view"><i class="fas fa-plus"></i></button>
                    </div>
                </div>

                <!-- ROOM VIEW -->
                <div class="chat-view" id="view-room">
                    <div class="chat-header">
                        <div class="chat-title">
                            <button class="chat-back-btn" id="btn-back-list"><i class="fas fa-arrow-left"></i></button>
                            <span id="chat-room-name">Chat</span>
                        </div>
                    </div>
                    
                    <div class="chat-messages" id="chat-messages-body"></div>
                    
                    <!-- Emoji Picker -->
                    <div class="chat-picker" id="emoji-picker"></div>

                    <div class="chat-input-area">
                        <label for="chat-file-input" class="chat-btn-icon" title="Envoyer un fichier"><i class="fas fa-paperclip"></i></label>
                        <input type="file" id="chat-file-input" hidden>
                        
                        <button class="chat-btn-icon" id="btn-emoji-toggle" title="Emojis"><i class="far fa-smile"></i></button>
                        
                        <input type="text" class="chat-input" id="chat-input-text" placeholder="Message...">
                        <button class="chat-btn-icon" id="chat-send-btn"><i class="fas fa-paper-plane"></i></button>
                    </div>
                </div>

                <!-- SEARCH VIEW (Private) -->
                <div class="chat-view" id="view-search">
                    <div class="chat-header">
                        <div class="chat-title">
                            <button class="chat-back-btn" id="btn-back-list-2"><i class="fas fa-arrow-left"></i></button>
                            Nouvelle discussion
                        </div>
                    </div>
                    <div class="search-input-container">
                        <input type="text" class="chat-input" id="user-search-input" placeholder="Rechercher un utilisateur...">
                        <div style="margin-top:10px; text-align:center;">
                            <button class="btn-small btn-secondary" id="btn-goto-group-create"><i class="fas fa-users"></i> Créer un groupe</button>
                        </div>
                    </div>
                    <div class="search-results" id="search-results-body"></div>
                </div>

                <!-- GROUP CREATE VIEW -->
                <div class="chat-view" id="view-group-create">
                    <div class="chat-header">
                        <div class="chat-title">
                            <button class="chat-back-btn" id="btn-back-search"><i class="fas fa-arrow-left"></i></button>
                            Créer un groupe
                        </div>
                        <button class="btn-small btn-primary" id="btn-create-group-submit"><i class="fas fa-check"></i> Créer</button>
                    </div>
                    <div class="search-input-container">
                        <input type="text" class="chat-input" id="group-name-input" placeholder="Nom du groupe" style="margin-bottom:10px;">
                        <input type="text" class="chat-input" id="group-user-search-input" placeholder="Ajouter des participants...">
                    </div>
                    <div class="search-results" id="group-search-results-body"></div>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        // Populate Emojis
        const emojiPicker = document.getElementById("emoji-picker");
        this.emojis.forEach(emoji => {
            const span = document.createElement("span");
            span.className = "emoji-item";
            span.textContent = emoji;
            span.onclick = () => this.addEmoji(emoji);
            emojiPicker.appendChild(span);
        });

        // Event Listeners
        document.getElementById("chat-launcher").addEventListener("click", () => this.toggleWidget());
        document.getElementById("chat-minimize").addEventListener("click", () => this.toggleWidget());
        
        // Navigation
        document.getElementById("btn-new-chat-view").addEventListener("click", () => this.switchView("search"));
        document.getElementById("btn-back-list").addEventListener("click", () => this.switchView("list"));
        document.getElementById("btn-back-list-2").addEventListener("click", () => this.switchView("list"));
        document.getElementById("btn-goto-group-create").addEventListener("click", () => this.switchView("group-create"));
        document.getElementById("btn-back-search").addEventListener("click", () => this.switchView("search"));

        // Search
        document.getElementById("user-search-input").addEventListener("input", (e) => this.handleSearch(e.target.value, "private"));
        document.getElementById("group-user-search-input").addEventListener("input", (e) => this.handleSearch(e.target.value, "group"));

        // Messaging
        const onSend = (isFile) => {
            if (this.currentRoomChatId) {
                this.sendRoomMessage(isFile);
            } else if (this.currentConversationId) {
                this.sendMessage(isFile);
            }
        };
        document.getElementById("chat-send-btn").addEventListener("click", () => onSend(false));
        document.getElementById("chat-input-text").addEventListener("keypress", (e) => {
            if (e.key === "Enter") onSend(false);
        });
        document.getElementById("chat-file-input").addEventListener("change", () => onSend(true));
        
        // Emoji
        document.getElementById("btn-emoji-toggle").addEventListener("click", () => {
            document.getElementById("emoji-picker").classList.toggle("active");
        });

        // Group Create
        document.getElementById("btn-create-group-submit").addEventListener("click", () => this.createGroup());
    }

    connectSocket(externalSocket) {
        if (externalSocket) {
            this.socket = externalSocket;
            console.log("[ChatWidget] Socket partagée fournie:", this.socket.id);
        } else if (window.io) {
            this.socket = window.io(API_BASE_URL, {
                auth: { token: this.token }
            });
            console.log("[ChatWidget] Socket interne créée.");
        } else {
            console.error("[ChatWidget] Socket.io indisponible.");
            return;
        }

        if (this.socket._chatWidgetBound) return;
        this.socket._chatWidgetBound = true;

        this.socket.on("connect", () => {
            console.log("[ChatWidget] Socket connectée:", this.socket.id);
        });

        this.socket.on("connect_error", (err) => {
            console.error("[ChatWidget] Erreur connexion socket:", err.message);
        });

        this.socket.on("new_message", (msg) => {
            this.handleNewMessage(msg);
        });
        
        this.socket.on("chat_notification", (data) => {
            if (
                (this.activeView !== "room") ||
                (this.currentConversationId && this.currentConversationId !== data.conversationId) ||
                !this.isOpen
            ) {
                this.incrementBadge();
            }
        });

        this._bindPresenceListeners();
        this._bindRoomChatListeners();
        this._bindPrivateChatListeners();
    }

    _bindPresenceListeners() {
        if (this._presenceBound || !this.socket) return;
        this._presenceBound = true;

        const updatePresence = (presenceList) => {
            this.onlineUserIds.clear();
            this.onlineUsersMap.clear();
            for (const u of presenceList || []) {
                if (!u || !u.id) continue;
                this.onlineUserIds.add(u.id);
                this.onlineUsersMap.set(u.id, u);
            }
            if (this.isOpen && this.activeView === "list") {
                this.loadConversations();
            }
            if (this.isOpen && this.activeView === "search") {
                const input = document.getElementById("user-search-input");
                if (input) this.handleSearch(input.value, "private");
            }
        };

        this.socket.on("presence:snapshot", (list) => {
            updatePresence(list);
            console.log("[ChatWidget] Presence snapshot:", list.length, "users en ligne.");
        });

        this.socket.on("presence:update", (payload) => {
            updatePresence(payload.snapshot || []);
        });
    }

    _bindRoomChatListeners() {
        if (!this.socket) return;
        if (this.socket._chatRoomBound) return;
        this.socket._chatRoomBound = true;

        this.socket.on("room:chat_ready", ({ roomId, conversationId }) => {
            if (roomId && conversationId) {
                this.roomConversationIds.set(roomId, conversationId);
            }
        });

        this.socket.on("room:chat_history", ({ roomId, messages }) => {
            if (roomId && Array.isArray(messages)) {
                this.roomMessages[roomId] = messages;
                if (this.currentRoomChatId === roomId) {
                    this.renderMessages(messages);
                }
            }
        });

        const handleRoomMsg = (msg) => {
            const roomId = msg.roomId;
            console.log(`[ChatWidget] ⚡ reçu room:msg room=${roomId} vue=${this.activeView} currentRoom=${this.currentRoomChatId}`, msg);
            if (!roomId) return;
            if (!Array.isArray(this.roomMessages[roomId])) this.roomMessages[roomId] = [];
            this.roomMessages[roomId].push(msg);

            const senderId = msg.senderId || (msg.sender && (msg.sender._id || msg.sender.id));
            const senderName = msg.fullName || msg.senderName || (msg.sender && (msg.sender.fullName || msg.sender.username));
            const text = msg.content || msg.text || "";
            const conversationId = msg.conversationId;
            const attachment = msg.fileName || msg.attachmentUrl || msg.fileUrl || "";

            // Notification room
            const roomMap = { hall: "🏛️ Hall WES'SUP", classA: "📚 Classe A", classB: "📚 Classe B" };
            this._notifyRoom(roomId, roomMap[roomId] || roomId, senderId, senderName, text, conversationId, attachment);

            if (this.currentRoomChatId === roomId && this.activeView === "room") {
                const myId = this.currentUser.id || this.currentUser._id;
                if (!senderId || senderId !== myId) {
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
                        conversationId: msg.conversationId,
                    };
                    this.appendMessage(mapped);
                }
            } else {
                this.incrementBadge();
                if (typeof this.onRoomUnread === "function") {
                    this.onRoomUnread(roomId, msg);
                }
                // Avatar unread badges (global - called in both hall and class scenes)
                if (senderId && senderId !== (this.currentUser.id || this.currentUser._id)) {
                    try { if (typeof window.hallIncrementAvatarUnread === "function") window.hallIncrementAvatarUnread(senderId, 1); } catch {}
                    try { if (typeof window.classIncrementAvatarUnread === "function") window.classIncrementAvatarUnread(senderId, 1); } catch {}
                }
            }
        };

        this.socket.on("room:message", handleRoomMsg);
        this.socket.on("hall:message", handleRoomMsg);
        this.socket.on("classA:message", handleRoomMsg);
        this.socket.on("classB:message", handleRoomMsg);
        console.log("[ChatWidget] ✅ Listeners room:message/hall/classA/classB attachés sur socket", this.socket.id);
    }

    _bindPrivateChatListeners() {
        if (!this.socket) return;
        if (this.socket._chatPrivateBound) return;
        this.socket._chatPrivateBound = true;

        this.socket.on("conversation:opened", ({ conversation, conversationId, targetUser }) => {
            const name = (targetUser && (targetUser.fullName || targetUser.username)) ||
                (conversation && conversation.name) || "Chat privé";
            this.currentRoomChatId = null;
            this.currentRoomChatName = null;
            this.openConversation(conversationId, name, conversation);
        });

        this.socket.on("notification:private_chat", ({ fromUserId, fromUserName, conversationId, text }) => {
            this.incrementBadge();
            this._notifyPrivate(fromUserId, fromUserName, text || "Nouveau message", conversationId, null);
            if (typeof this.onPrivateChatRequest === "function") {
                this.onPrivateChatRequest({ fromUserId, fromUserName, conversationId, text });
            }
            if (fromUserId) {
                try { if (typeof window.hallIncrementAvatarUnread === "function") window.hallIncrementAvatarUnread(fromUserId, 1); } catch {}
                try { if (typeof window.classIncrementAvatarUnread === "function") window.classIncrementAvatarUnread(fromUserId, 1); } catch {}
            }
        });

        this.socket.on("error:private_chat", ({ error }) => {
            if (error) alert("Erreur: " + error);
        });
    }

    markOnlineUserIds(idsIterable) {
        this.onlineUserIds = new Set(Array.from(idsIterable || []));
        if (this.isOpen) this.loadConversations();
    }

    isOnline(userId) {
        return userId ? this.onlineUserIds.has(userId) : false;
    }

    getSocket() {
        return this.socket;
    }

    openPrivateChat(userId, userName) {
        if (!userId) return;
        if (userId === (this.currentUser.id || this.currentUser._id)) return;

        if (!this.isOpen) this.toggleWidget();

        // Clear unread badge on avatar when opening private chat
        try { if (typeof window.hallClearAvatarUnread === "function") window.hallClearAvatarUnread(userId); } catch {}
        try { if (typeof window.classClearAvatarUnread === "function") window.classClearAvatarUnread(userId); } catch {}

        if (this.socket) {
            this.socket.emit("request:private_chat", userId);
        } else {
            this.startPrivateChat(userId);
        }
    }

    async openRoomChat(roomId, roomName) {
        const validRooms = ["hall", "classA", "classB"];
        if (!validRooms.includes(roomId)) return;

        if (!this.isOpen) this.toggleWidget();

        if (this.currentConversationId && this.socket) {
            this.socket.emit("leave_conversation", this.currentConversationId);
        }
        this.currentConversationId = null;
        this.currentRoomChatId = roomId;
        this.currentRoomChatName = roomName || roomId;

        document.getElementById("chat-room-name").textContent = roomName || roomId;
        this.switchView("room");

        const msgs = this.roomMessages[roomId] || [];
        this.renderMessages(msgs.map(m => ({
            ...m,
            sender: m.sender || {
                _id: m.senderId,
                username: m.senderName || m.fullName,
                fullName: m.fullName || m.senderName,
                avatar3DUrl: m.avatarUrl,
                role: m.role,
            },
            content: m.content || m.text,
            attachmentUrl: m.attachmentUrl || m.fileUrl,
            fileName: m.fileName,
            type: m.type || "text",
        })));

        if (this.socket) this.socket.emit("room:chat_history", roomId);
    }

    sendRoomMessage() {
        if (!this.currentRoomChatId || !this.socket) return;
        const input = document.getElementById("chat-input-text");
        const fileInput = document.getElementById("chat-file-input");
        const text = String(input.value || "").trim();
        const file = fileInput.files && fileInput.files[0];

        if (!text && !file) return;

        const myId = this.currentUser.id || this.currentUser._id;
        const myName = this.currentUser.fullName || this.currentUser.username || "Moi";

        if (file) {
            const fd = new FormData();
            fd.append("content", text || "");
            fd.append("attachment", file);
            const roomConvId = this.roomConversationIds.get(this.currentRoomChatId);
            if (roomConvId) {
                fetch(`${CHAT_API_URL}/conversation/${roomConvId}/messages`, {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${this.token}` },
                    body: fd,
                }).catch(e => console.error(e));
            }
            input.value = "";
            fileInput.value = "";
            return;
        }

        // Optimistic
        this.appendMessage({
            sender: { _id: myId, username: myName, fullName: myName, avatar3DUrl: this.currentUser.avatar3DUrl },
            content: text,
            type: "text",
            createdAt: new Date().toISOString(),
        });
        input.value = "";

        this.socket.emit("room:message", {
            roomId: this.currentRoomChatId,
            text: text,
            type: "text",
        });
    }

    toggleWidget() {
        this.isOpen = !this.isOpen;
        const container = document.getElementById("chat-widget-root") || document.getElementById("chat-container");
        if (!container) return;
        if (this.isOpen) {
            container.classList.add("active");
            container.style.setProperty("display", "flex", "important");
            container.style.setProperty("z-index", "999999", "important");
            this.unreadCount = 0;
            this.updateBadge();
            this.loadConversations();
        } else {
            container.classList.remove("active");
            container.style.setProperty("display", "none", "important");
        }
    }

    switchView(viewName) {
        document.querySelectorAll(".chat-view").forEach(el => el.classList.remove("active"));
        document.getElementById(`view-${viewName}`).classList.add("active");
        this.activeView = viewName;
        
        // Reset specific view states
        if (viewName === "group-create") {
            this.selectedUsersForGroup.clear();
            document.getElementById("group-name-input").value = "";
            document.getElementById("group-user-search-input").value = "";
            document.getElementById("group-search-results-body").innerHTML = "";
            
            // Initial search to show all users
            this.handleSearch("", "group");
        }
        
        if (viewName === "search") {
             document.getElementById("user-search-input").value = "";
             // Initial search to show all users
             this.handleSearch("", "private");
        }
    }

    incrementBadge() {
        this.unreadCount++;
        this.updateBadge();
    }

    updateBadge() {
        const badge = document.getElementById("chat-badge");
        if (this.unreadCount > 0) {
            badge.textContent = this.unreadCount;
            badge.style.display = "flex";
        } else {
            badge.style.display = "none";
        }
    }

    _getAvatarStyle(_url, user = {}) {
        // ReadyPlayerMe SUPPRIMÉ — cette méthode ne sert que de fallback extrême si createAvatarHtml indisponible
        const gradient = "background:linear-gradient(135deg,#6366f1 0%,#ec4899 100%);";
        const initial = (user.fullName || user.username || user.email || "?").toString().trim().charAt(0).toUpperCase();
        return `${gradient} display:flex; align-items:center; justify-content:center; color:#fff; font-size:0.8rem; font-weight:700;`;
    }

    _avatarHtmlReliable(user = {}, size = "36px") {
        // ReadyPlayerMe SUPPRIMÉ. On utilise createAvatarHtml quand c'est possible, sinon DiceBear/initiales ici.
        if (typeof window.createAvatarHtml === 'function') {
            try { return window.createAvatarHtml(user, size); } catch {}
        }
        const initial = (user.fullName || user.username || user.email || "?").toString().trim().charAt(0).toUpperCase();
        const seed = (user.id || user._id || user.fullName || user.username || user.email || "user").toString().trim().replace(/[^a-zA-Z0-9_-]/g, "") || "wbcuser";
        const diceUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&backgroundColor=b6e3f4,c0aede,d1d4f9,ffdfbf,ffd5dc,cdf5ff,fdcfcf,ffd6e0`;
        const base = `width:${size};height:${size};border-radius:50%;border:1px solid #00ff88;display:inline-block;vertical-align:middle;`;
        const fallbackStyle = `display:none;align-items:center;justify-content:center;color:#fff;font-weight:bold;background:linear-gradient(135deg,#6366f1 0%,#ec4899 100%);`;
        return `<img src="${diceUrl}" alt="Avatar" style="${base}object-fit:cover;display:inline-block;"
            onerror="this.onerror=null;this.style.display='none';const fb=this.nextElementSibling;if(fb){fb.style.display='flex';fb.style.alignItems='center';fb.style.justifyContent='center';fb.style.background='linear-gradient(135deg,#6366f1 0%,#ec4899 100%)';fb.style.color='#fff';fb.style.fontWeight='bold';}"><div style="${base}${fallbackStyle}">${initial}</div>`;
    }

    addEmoji(emoji) {
        const input = document.getElementById("chat-input-text");
        input.value += emoji;
        input.focus();
        document.getElementById("emoji-picker").classList.remove("active");
    }

    async loadConversations() {
        try {
            const res = await fetch(`${CHAT_API_URL}/conversations`, {
                headers: { "Authorization": `Bearer ${this.token}` }
            });
            if (!res.ok) {
                this.renderConversations([]);
                return;
            }
            const conversations = await res.json();
            const safeConvs = Array.isArray(conversations) ? conversations : (Array.isArray(conversations?.data) ? conversations.data : []);
            this.renderConversations(safeConvs);
        } catch (err) {
            console.error(err);
            this.renderConversations([]);
        }
    }

    renderConversations(conversations) {
        const list = document.getElementById("chat-list-body");
        if (!list) return;
        list.innerHTML = "";

        const arr = Array.isArray(conversations) ? conversations : [];

        if (arr.length === 0) {
            list.innerHTML = `<div style="text-align:center; padding:20px; color:#aaa;">Aucune conversation.<br>Commencez une nouvelle discussion !</div>`;
            return;
        }

        arr.forEach(c => {
            const other = c.type === "private" 
                ? c.participants.find(p => (p._id || p.id) !== (this.currentUser.id || this.currentUser._id))
                : null;

            const name = (c.type === "group" || c.type === "class") ? c.name : (other ? (other.fullName || other.username || other.email) : "Moi");

            const otherId = other ? (other._id || other.id) : null;
            const online = otherId ? this.isOnline(otherId) : false;
            const onlineHtml = (other && otherId)
                ? `<span class="online-dot ${online ? "online" : "offline"}" title="${online ? "En ligne" : "Hors ligne"}"></span>`
                : "";

            let avatarHtml = "";
            if (c.type === "group" || c.type === "class") {
                const icon = c.type === "class" ? "fa-graduation-cap" : "fa-users";
                const color = c.relatedClass === "hall" ? "#9333ea" : (c.type === "class" ? "#ff8800" : "#00f2ff");
                avatarHtml = `<div class="chat-avatar" style="background: ${color}; display:flex; align-items:center; justify-content:center; color:#000; font-weight:bold; font-size:1.2rem; margin-right:10px; width:40px; height:40px; border-radius:50%;"><i class="fas ${icon}"></i></div>`;
            } else if (typeof window.createAvatarHtml === 'function') {
                avatarHtml = `<div style="margin-right:10px; position:relative;">${window.createAvatarHtml(other, "40px")}${onlineHtml}</div>`;
            } else {
                avatarHtml = `<div style="margin-right:10px; position:relative;">${this._avatarHtmlReliable(other, "40px")}${onlineHtml}</div>`;
            }

            const div = document.createElement("div");
            div.className = "chat-item";
            div.innerHTML = `
                ${avatarHtml}
                <div class="chat-info">
                    <div class="chat-name">${name}</div>
                    <div class="chat-last-msg">${c.lastMessage ? (c.lastMessage.content || (c.lastMessage.type === "file" ? "📎 Fichier" : "Message")) : "Aucun message"}</div>
                </div>
            `;
            div.onclick = () => this.openConversation(c._id, name);
            list.appendChild(div);
        });
    }

    async openConversation(id, name) {
        // Leave previous room if any
        if (this.currentConversationId && this.socket) {
            this.socket.emit("leave_conversation", this.currentConversationId);
        }

        this.currentConversationId = id;
        this.currentRoomChatId = null;
        this.currentRoomChatName = null;

        document.getElementById("chat-room-name").textContent = name || "Chat";
        this.switchView("room");
        
        // Join socket room
        if (this.socket) {
            this.socket.emit("join_conversation", id);
        }

        // Load messages
        try {
            const res = await fetch(`${CHAT_API_URL}/conversation/${id}/messages`, {
                headers: { "Authorization": `Bearer ${this.token}` }
            });
            if (!res.ok) {
                console.warn("[ChatWidget] Failed load messages conv", id, "status:", res.status);
                this.renderMessages([]);
                return;
            }
            const raw = await res.json();
            const messages = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
            this.renderMessages(messages);
        } catch (err) {
            console.error(err);
            this.renderMessages([]);
        }
    }

    renderMessages(messages) {
        const container = document.getElementById("chat-messages-body");
        if (!container) return;
        container.innerHTML = "";
        const arr = Array.isArray(messages) ? messages : [];
        arr.forEach(msg => this.appendMessage(msg));
        this.scrollToBottom();
    }

    appendMessage(msg) {
        const container = document.getElementById("chat-messages-body");
        if (!msg.sender) {
             console.warn("Message with no sender:", msg);
             msg.sender = { _id: "unknown", username: "Inconnu", role: "guest" };
        }
        const senderId = msg.sender._id || msg.sender;
        const myId = this.currentUser.id || this.currentUser._id;
        const isMe = senderId === myId;
        
        const wrapper = document.createElement("div");
        wrapper.className = `message-wrapper ${isMe ? "sent" : "received"}`;
        
        // Avatar logic
        let avatarHtml = "";
        if (!isMe) {
            try {
                avatarHtml = `<div class="message-avatar-wrapper" style="margin-right:8px;">${this._avatarHtmlReliable(msg.sender, "30px")}</div>`;
            } catch (e) {
                if (typeof createAvatarHtml === 'function') {
                    avatarHtml = `<div class="message-avatar-wrapper" style="margin-right:8px;">${createAvatarHtml(msg.sender, "30px")}</div>`;
                }
            }
            if (!avatarHtml) {
                 avatarHtml = `<div class="message-avatar-wrapper" style="margin-right:8px;"><div class="message-avatar" style="width:30px;height:30px;background:#333;border-radius:50%;"></div></div>`;
            }
        }

        let content = "";
        if (msg.type === "text" || msg.type === "emoji") {
            content = msg.content;
        } else if (msg.type === "file" || msg.type === "image" || msg.type === "gif") {
            const url = API_BASE_URL + msg.attachmentUrl;
            const isImage = msg.type === "image" || msg.type === "gif" || (msg.fileName && (msg.fileName.match(/\.(jpg|jpeg|png|gif)$/i)));
            
            if (isImage) {
                 content = `<div style="margin-bottom:5px;">${msg.content || ""}</div><img src="${url}" style="max-width:100%; border-radius:8px; cursor:pointer;" onclick="window.open('${url}', '_blank')">`;
            } else {
                 content = `${msg.content || ""} <a href="${url}" target="_blank" class="message-file" style="color:${isMe ? '#fff' : '#00f2ff'}; text-decoration:none;"><i class="fas fa-file-download"></i> ${msg.fileName || "Fichier"}</a>`;
            }
        }

        wrapper.innerHTML = `
            ${avatarHtml}
            <div class="message-content-col">
                ${!isMe ? `<div class="message-sender-name">${msg.sender.username || "User"}</div>` : ""}
                <div class="message-bubble ${isMe ? "sent" : "received"}">
                    ${content}
                </div>
                <div class="message-time">${new Date(msg.createdAt || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
            </div>
        `;
        container.appendChild(wrapper);
        this.scrollToBottom();
    }

    scrollToBottom() {
        const container = document.getElementById("chat-messages-body");
        container.scrollTop = container.scrollHeight;
    }

    async sendMessage(isFile = false) {
        if (!this.currentConversationId) return;

        const input = document.getElementById("chat-input-text");
        const fileInput = document.getElementById("chat-file-input");
        
        const text = input.value;
        const file = fileInput.files[0];

        if (!text && !file) return;

        const formData = new FormData();
        formData.append("content", text);
        if (file) {
            formData.append("attachment", file);
            formData.append("type", "file");
        } else {
            formData.append("type", "text");
        }

        // Optimistic UI update (for text only)
        if (!file) {
            this.appendMessage({
                sender: { _id: this.currentUser.id || this.currentUser._id, username: "Moi", avatarUrl: this.currentUser.avatarUrl },
                content: text,
                type: "text"
            });
            input.value = "";
        }

        try {
            const res = await fetch(`${CHAT_API_URL}/conversation/${this.currentConversationId}/messages`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${this.token}` },
                body: formData
            });

            if (res.ok) {
                if (file) {
                    const msg = await res.json();
                    this.appendMessage(msg);
                    fileInput.value = "";
                    input.value = "";
                }
            }
        } catch (err) {
            console.error(err);
        }
    }

    handleNewMessage(msg) {
        const convId = msg.conversationId || (msg.conversation && msg.conversation._id);
        const senderRaw = msg.sender || {};
        const senderId = typeof senderRaw === "string" ? senderRaw : (senderRaw._id || senderRaw.id || "");
        const senderName = typeof senderRaw === "string" ? null : (senderRaw.fullName || senderRaw.username || senderRaw.email || "");
        const content = msg.content || msg.text || "";
        const attachment = msg.fileName || msg.attachmentUrl || msg.fileUrl || "";

        // Notification privée
        this._notifyPrivate(senderId, senderName, content, convId, attachment);

        if (this.activeView === "room" && String(this.currentConversationId) === String(convId)) {
            const myId = this.currentUser.id || this.currentUser._id;
            const isMe = senderId === myId;
            if (!isMe) {
                this.appendMessage(msg);
            }
        } else {
            this.incrementBadge();
        }
    }

    async handleSearch(query, context) {
        const containerId = context === "group" ? "group-search-results-body" : "search-results-body";
        const container = document.getElementById(containerId);
        
        /*
        if (query.length < 2) {
            container.innerHTML = "";
            return;
        }
        */

        try {
            const res = await fetch(`${CHAT_API_URL}/users/search?q=${query}`, {
                headers: { "Authorization": `Bearer ${this.token}` }
            });
            const users = await res.json();
            
            container.innerHTML = "";
            users.forEach(u => {
                const div = document.createElement("div");
                div.className = context === "group" ? "user-select-item" : "user-result";
                div.style.position = "relative";

                const userId = u._id || u.id;
                const userName = u.fullName || u.username || u.email || "User";
                const online = this.isOnline(userId);
                const onlineDot = context !== "group"
                    ? `<span class="online-dot ${online ? "online" : "offline"}" title="${online ? "En ligne" : "Hors ligne"}"></span>`
                    : "";
                
                const avatarHtml = (() => {
                    try {
                        if (typeof this._avatarHtmlReliable === "function") return this._avatarHtmlReliable(u, "30px");
                    } catch {}
                    if (typeof createAvatarHtml === 'function') return createAvatarHtml(u, "30px");
                    return `<div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#6366f1 0%,#ec4899 100%);"></div>`;
                })();

                if (context === "group") {
                     // Checkbox for group
                     const isSelected = this.selectedUsersForGroup.has(userId);
                     div.innerHTML = `
                        <input type="checkbox" class="user-select-checkbox" ${isSelected ? "checked" : ""}>
                        <div style="margin-right:10px; position:relative;">${avatarHtml}</div>
                        <span>${userName}</span>
                     `;
                     div.onclick = (e) => {
                         if (e.target.type !== 'checkbox') {
                             const cb = div.querySelector('input');
                             cb.checked = !cb.checked;
                             this.toggleUserSelection(userId, cb.checked);
                         } else {
                             this.toggleUserSelection(userId, e.target.checked);
                         }
                     };
                } else {
                    // Direct click for private
                    div.innerHTML = `
                        <div style="margin-right:10px; position:relative;">${avatarHtml}${onlineDot}</div>
                        <div style="flex:1;">
                            <div style="font-weight:600;color:#fff;">${userName}</div>
                            <div style="font-size:0.75rem;color:#9ca3af;">${u.role || ""} ${u.email ? `· ${u.email}` : ""}</div>
                        </div>
                    `;
                    div.onclick = () => this.openPrivateChat(userId, userName);
                }
                
                container.appendChild(div);
            });
        } catch (err) {
            console.error(err);
        }
    }

    toggleUserSelection(userId, isSelected) {
        if (isSelected) {
            this.selectedUsersForGroup.add(userId);
        } else {
            this.selectedUsersForGroup.delete(userId);
        }
    }

    async createGroup() {
        const name = document.getElementById("group-name-input").value;
        if (!name || this.selectedUsersForGroup.size === 0) {
            alert("Veuillez entrer un nom et sélectionner au moins un participant.");
            return;
        }

        try {
            const res = await fetch(`${CHAT_API_URL}/conversation/group`, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.token}` 
                },
                body: JSON.stringify({
                    name: name,
                    participantIds: Array.from(this.selectedUsersForGroup)
                })
            });

            if (res.ok) {
                const conversation = await res.json();
                this.openConversation(conversation._id, conversation.name);
            }
        } catch (err) {
            console.error(err);
        }
    }

    async startPrivateChat(recipientId) {
        try {
            const res = await fetch(`${CHAT_API_URL}/conversation/private`, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.token}` 
                },
                body: JSON.stringify({ recipientId })
            });
            const conversation = await res.json();
            
            const otherUser = conversation.participants.find(p => (p._id || p) !== (this.currentUser.id || this.currentUser._id));
            const name = otherUser ? (otherUser.username || otherUser.email) : "Chat";

            this.openConversation(conversation._id, name);
        } catch (err) {
            console.error(err);
        }
    }
    
    static async startChatWith(userId, userName) {
        if (!window.wbcChatWidget) {
            // Auto-init lazy
            window.wbcChatWidget = new ChatWidget();
        }
        if (!window.wbcChatWidget.isOpen) window.wbcChatWidget.toggleWidget();
        window.wbcChatWidget.openPrivateChat(userId, userName);
    }
}

// Lazy/optional singleton
window.WBCChatWidget = ChatWidget;
document.addEventListener("DOMContentLoaded", () => {
    if (!window.wbcChatWidget && !window.WBC_DISABLE_AUTO_CHAT_INIT) {
        try {
            window.wbcChatWidget = new ChatWidget();
        } catch (e) {
            // Will be initialized later by hall.js/class-a.js with a shared socket.
        }
    }
});
