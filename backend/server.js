// backend/server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";

import connectDB from "./config/db.js";
import User from "./models/User.js";
import Conversation from "./models/Conversation.js";
import Message from "./models/Message.js";
import mongoose from "mongoose";

import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import meRoutes from "./routes/me.js";
import feedRoutes from "./routes/feed.js";
import chatbotRoutes from "./routes/chatbot.js";
import coursesRoutes from "./routes/courses.js";
import assignmentsRoutes from "./routes/assignments.js";
import notificationsRoutes from "./routes/notifications.js";
import chatRoutes from "./routes/chat.js";
import teacherRoutes from "./routes/teacher.js";
import iotRoutes from "./routes/iot.js";
import smartclassRoutes from "./routes/smartclass.js";
import avatarProxyRoutes from "./routes/avatar-proxy.js";

// ==========================================================
// 🛡️ HANDLERS GLOBAUX ANTI-CRASH
// ==========================================================
process.on("uncaughtException", (err) => {
  console.error("💥 UNCAUGHT EXCEPTION (process non tué) :", err.message);
  console.error("Stack:", err.stack?.split("\n").slice(0, 5).join("\n"));
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("⚠️ UNHANDLED REJECTION :", reason?.message || reason);
  if (reason?.stack) {
    console.error("Stack:", reason.stack.split("\n").slice(0, 4).join("\n"));
  }
  console.error("Promise:", promise?.constructor?.name);
});

const app = express();
const server = http.createServer(app);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

const allowedOrigins = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5501",
  "http://localhost:5501",
  "http://localhost:4000",
];

// ---- Socket.IO Initialization ----
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ✅ CORS (IMPORTANT)
app.use(
  cors({
    origin: (origin, cb) => {
      // autorise aussi les requêtes sans origin (Postman, curl)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "10mb" }));

// Middleware to expose io to routes
app.use((req, res, next) => {
    req.io = io;
    next();
});

// Middleware pour servir les fichiers compressés Unity correctement
app.get(/.*\.gz$/, function (req, res, next) {
  res.set('Content-Encoding', 'gzip');
  res.set('Content-Type', 'application/javascript'); // Par défaut JS, ajusté ensuite
  if (req.url.endsWith('.wasm.gz')) {
    res.set('Content-Type', 'application/wasm');
  } else if (req.url.endsWith('.data.gz')) {
    res.set('Content-Type', 'application/octet-stream');
  } else if (req.url.endsWith('.framework.js.gz')) {
    res.set('Content-Type', 'application/javascript');
  }
  next();
});

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "../frontend"))); // Servir le frontend

// Routes
app.get("/", (req, res) => res.send("WES'SUP Portal API 🔸"));
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/me", meRoutes);
app.use("/api/feed", feedRoutes);
app.use("/api/iot", iotRoutes); // Utiliser la nouvelle route
app.use("/api/smartclass", smartclassRoutes); // Utiliser les routes SmartClass
app.use("/api/avatar-proxy", avatarProxyRoutes); // Utiliser la route proxy
app.use("/api/chat", chatRoutes);
app.use("/api/teacher", teacherRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/courses", coursesRoutes);
app.use("/api/assignments", assignmentsRoutes);
app.use("/api/notifications", notificationsRoutes);
// app.use("/api/chat", chatRoutes); // Duplicate removed

app.get("/api/config/public", (req, res) => {
  res.json({
    avatarCreatorUrl: process.env.AVATAR_CREATOR_URL || "",
  });
});

// ---- Socket.IO Logic ----

const classAUsers = new Map();

function safeObjectId(id) {
  try {
    if (!id) return null;
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

const VALID_ROOMS = ["hall", "classA", "classB", "lobby"];

function isRoomVisible(role) {
  const r = String(role || "").toUpperCase();
  return r !== "TEACHER" && r !== "ADMIN";
}

function getPresenceSnapshot() {
  const byUserId = new Map();
  for (const [sid, userState] of classAUsers.entries()) {
    if (!isRoomVisible(userState.role)) continue;
    const uid = userState.id;
    if (!byUserId.has(uid)) {
      byUserId.set(uid, {
        id: uid,
        username: userState.username,
        fullName: userState.fullName || userState.username,
        role: userState.role,
        avatarUrl: userState.avatarUrl,
        sessions: [],
        rooms: new Set(),
        lastActive: 0,
      });
    }
    const entry = byUserId.get(uid);
    entry.sessions.push(userState.sessionId || sid);
    if (userState.room) entry.rooms.add(userState.room);
    entry.lastActive = Math.max(entry.lastActive, userState.lastActive || 0);
  }
  const list = [];
  for (const [uid, entry] of byUserId.entries()) {
    list.push({
      ...entry,
      rooms: Array.from(entry.rooms),
      roomsPrimary: entry.rooms.size > 0 ? Array.from(entry.rooms)[entry.rooms.size - 1] : "lobby",
      online: true,
    });
  }
  return list;
}

function broadcastPresenceUpdate(changedUser, options = {}) {
  const snapshot = options.snapshotOnly ? null : null;
  const payload = {
    updatedAt: Date.now(),
    ...(changedUser ? { changed: changedUser } : {}),
    snapshot: getPresenceSnapshot(),
  };
  io.emit("presence:update", payload);
  return payload;
}

async function ensureRoomConversation(roomId) {
  if (!VALID_ROOMS.includes(roomId)) return null;
  const conv = await Conversation.findOne({ type: "class", relatedClass: roomId }).lean();
  if (conv) return conv._id.toString();

  const names = { hall: "Hall WES'SUP", classA: "Classe A", classB: "Classe B", lobby: "Lobby" };
  const created = await Conversation.create({
    type: "class",
    relatedClass: roomId,
    name: names[roomId] || roomId,
    participants: [],
  });
  return created._id.toString();
}

async function loadRoomChatHistory(roomId, limit = 50) {
  const conv = await Conversation.findOne({ type: "class", relatedClass: roomId }).select("_id").lean();
  if (!conv) return [];
  const msgs = await Message.find({ conversationId: conv._id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("sender", "username email avatar3DUrl role fullName")
    .lean();
  return msgs.reverse();
}

function broadcastClassAUsers() {
  io.to("classA").emit("classA:users", Array.from(classAUsers.values()));
}

io.use(async (socket, next) => {
  try {
    let token = socket.handshake.auth?.token || socket.handshake.query?.token || "";
    if (!token) return next(new Error("No token"));

    token = String(token).replace(/^Bearer\s+/i, "").trim();
    const decoded = jwt.verify(token, JWT_SECRET);

    const userId =
      decoded.id || decoded._id || decoded.userId || (decoded.user && (decoded.user.id || decoded.user._id));

    if (!userId) return next(new Error("Invalid token payload"));

    const user = await User.findById(userId);
    if (!user) return next(new Error("User not found"));
    if (user.status === "inactive" || user.isActive === false) {
      return next(new Error("User inactive"));
    }

    socket.user = {
      id: user._id.toString(),
      username: user.username || user.email,
      fullName: user.fullName || user.username || user.email || "",
      email: user.email || "",
      role: user.role,
      studentClass: user.studentClass,
      academicStatus: user.academicStatus,
      avatar3DUrl: user.avatar3DUrl || ""
    };

    next();
  } catch (e) {
    console.error("Socket auth error:", e.message);
    next(new Error("Auth error"));
  }
});

io.on("connection", (socket) => {
  const u = socket.user;
  
  // Detect duplicate connections for the same user
  const existingSocketIds = Array.from(classAUsers.values())
    .filter((user) => user.id === u.id)
    .map((user) => user.sessionId);

  // Chat Rooms (Private/Group)
  socket.on("join_conversation", (conversationId) => {
      socket.join(`conversation:${conversationId}`);
      // console.log(`Socket ${socket.id} joined conversation:${conversationId}`);
  });

  socket.on("leave_conversation", (conversationId) => {
        socket.leave(`conversation:${conversationId}`);
    });

  socket.on('join_admin_dashboard', () => {
    // Only allow admins and teachers to join this room
    if (socket.user && (socket.user.role === 'admin' || socket.user.role === 'teacher')) {
      socket.join('admin_dashboard');
      console.log(`Socket ${socket.id} (${socket.user.username}) joined the admin_dashboard channel.`);
    }
  });
  
  if (existingSocketIds.length > 0) {
      console.warn(`⚠️ Attention : L'utilisateur ${u.username} est déjà connecté sur ${existingSocketIds.length} autre(s) onglet(s).`);
  }

  console.log("🔌 Socket connecté :", u?.username);
  
  // Join their own room for personal notifications
  socket.join(u.id);
  
  // Join Class Room for class notifications
  if (u.studentClass) {
      socket.join(`class:${u.studentClass}`);
  }

  // Default state (per socket session)
  const userState = {
    id: u.id,
    username: u.username,
    fullName: u.fullName || u.username,
    email: u.email,
    role: u.role,
    avatarUrl: u.avatar3DUrl || null,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    isSitting: false,
    seatId: null,
    room: "lobby",
    sessionId: socket.id,
    statusEmoji: u.academicStatus?.statusEmoji || "",
    activeEmojis: u.academicStatus?.activeEmojis || [],
    online: true,
    lastActive: Date.now(),
  };

  // Track user
  classAUsers.set(socket.id, userState);

  // ---- PRESENCE ----
  socket.emit("presence:snapshot", getPresenceSnapshot());
  broadcastPresenceUpdate({
    id: u.id,
    fullName: u.fullName || u.username,
    username: u.username,
    role: u.role,
    avatarUrl: u.avatar3DUrl || null,
    online: true,
    room: "lobby",
    action: "connect",
    sessionId: socket.id,
  });

  socket.on("presence:get", () => {
    socket.emit("presence:snapshot", getPresenceSnapshot());
  });

  socket.on("joinRoom", async (room) => {
    if (!VALID_ROOMS.includes(room)) {
      console.warn(`Tentative de joinRoom invalide : ${room} (user: ${u.username})`);
      return;
    }
    socket.leave(userState.room);
    socket.join(room);
    userState.room = room;
    userState.lastActive = Date.now();
    
    if (room === "classA" || room === "classB") {
        // Check occupied seats in the specific room
        const occupiedSeats = new Set();
        Array.from(classAUsers.values())
             .filter(u => u.room === room && u.seatId !== null && u.sessionId !== socket.id)
             .forEach(u => occupiedSeats.add(u.seatId));

        if (String(u.role).toUpperCase() === "TEACHER") {
             userState.seatId = "teacher-seat";
             userState.isSitting = false; 
        } else {
             // Find first free seat (0..8)
             let assignedSeat = -1;
             // We have 3x3 = 9 seats generated in frontend
             for (let i = 0; i < 9; i++) {
                 if (!occupiedSeats.has(i)) {
                     assignedSeat = i;
                     break;
                 }
             }
             
             if (assignedSeat !== -1) {
                 userState.seatId = assignedSeat;
                 userState.isSitting = true;
             } else {
                 // No seats available, stand at back
                 userState.seatId = null;
                 userState.isSitting = false;
                 userState.position.x = 0;
                 userState.position.z = 6;
             }
        }
    } else {
        // Generic room logic (Hall and others)
        userState.seatId = null;
        userState.isSitting = false;
        
        const others = Array.from(classAUsers.values())
            .filter(u => u.room === room && u.sessionId !== socket.id);
        const index = others.length;

        if (room === "hall") {
            // Fixed slots so that up to 3 avatars are nicely spaced in front of portals
            const slots = [
                { x: -3.5, z: 3.5 },
                { x: 0,    z: 3.5 },
                { x: 3.5,  z: 3.5 },
            ];
            const slot = slots[index] || { x: 0, z: 3.5 + 3 * (index - 2) };
            userState.position.x = slot.x;
            userState.position.z = slot.z;
            userState.position.y = 0;
        } else {
            // Fallback grid for other generic rooms
            const cols = 4;
            const spacingX = 3.5;
            const spacingZ = 3.0;
            const row = Math.floor(index / cols);
            const col = index % cols;
            
            const startX = -((cols - 1) * spacingX) / 2;
            userState.position.x = startX + col * spacingX;
            userState.position.z = 4 + row * spacingZ;
            userState.position.y = 0;
        }
    }
    
    classAUsers.set(socket.id, userState);
    
    // Notify others in this room
    const roomUsers = Array.from(classAUsers.values()).filter(u => u.room === room);
    io.to(room).emit("room:users", roomUsers);

    // Broadcast presence change cross-room
    broadcastPresenceUpdate({
      id: u.id,
      fullName: u.fullName || u.username,
      username: u.username,
      role: u.role,
      avatarUrl: userState.avatarUrl,
      online: true,
      room: room,
      action: "join_room",
      sessionId: socket.id,
    });

    // Ensure chat room conversation exists + send history to joiner
    try {
      const convId = await ensureRoomConversation(room);
      if (convId) {
        socket.join(`conversation:${convId}`);
        socket.emit("room:chat_ready", {
          roomId: room,
          conversationId: convId,
        });
      }
      const history = await loadRoomChatHistory(room, 50);
      socket.emit("room:chat_history", { roomId: room, messages: history });
    } catch (err) {
      console.error("[Socket] Error loading room chat history:", err.message);
    }

    console.log(`${u.username} joined ${room}, assigned seat: ${userState.seatId}`);
  });

  socket.on("teacher_update_emoji", async (data) => {
    try {
        const student = await User.findById(data.studentId);
        if (student) {
            const activeEmojis = student.academicStatus?.activeEmojis || [];
            const statusEmoji = student.academicStatus?.statusEmoji || "";
            const remarks = student.academicStatus?.remarks || "";

            // Notify the student
            io.to(data.studentId).emit('evaluation:updated', {
                 statusEmoji: statusEmoji,
                 activeEmojis: activeEmojis,
                 remarks: remarks
            });
            
            // Update in-memory state for any active sessions of this student
            for (const [sid, userState] of classAUsers.entries()) {
                 if (userState.id === data.studentId) {
                      userState.activeEmojis = activeEmojis;
                      userState.statusEmoji = statusEmoji;
                      classAUsers.set(sid, userState);
                 }
            }
        }
    } catch (err) {
        console.error("Error in teacher_update_emoji:", err);
    }
  });

  socket.on("player:update", (data) => {
    if (!classAUsers.has(socket.id)) return;
    const currentUser = classAUsers.get(socket.id);
    const updatedUser = { ...currentUser, ...data, lastActive: Date.now() };
    classAUsers.set(socket.id, updatedUser);
    socket.to(currentUser.room).emit("player:updated", {
      id: u.id,
      sessionId: socket.id,
      ...updatedUser,
    });
  });

  // ---- CHAT HISTORY (ON DEMAND) ----
  socket.on("room:chat_history", async (roomId) => {
    if (!VALID_ROOMS.includes(roomId)) return;
    if (!socket.rooms.has(roomId)) return;
    try {
      const messages = await loadRoomChatHistory(roomId, 100);
      socket.emit("room:chat_history", { roomId, messages });
    } catch (err) {
      console.error("[Socket] room:chat_history error:", err.message);
    }
  });

  // ---- CHAT DE SALLE GÉNÉRIQUE ----
  socket.on("room:message", async (payload) => {
    try {
      const roomId = String(payload?.roomId || "").trim();
      const text = String(payload?.text || "").trim();
      const attachmentUrl = payload?.attachmentUrl || null;
      const fileName = payload?.fileName || null;
      const type = payload?.type || (attachmentUrl ? "file" : "text");

      if (!VALID_ROOMS.includes(roomId)) {
        console.warn(`[ROOM MSG] room invalide: ${roomId}`);
        return;
      }
      // Guard moins strict : si la socket n'est pas encore dans la room (race), la rejoindre
      if (!socket.rooms.has(roomId)) {
        console.warn(`[ROOM MSG] socket ${socket.id} pas dans room ${roomId} — join auto`);
        socket.join(roomId);
      }
      if (!text && !attachmentUrl) return;

      const conversationId = await ensureRoomConversation(roomId);
      if (!conversationId) return;

      const convOid = safeObjectId(conversationId);
      if (!convOid) return;

      const senderOid = safeObjectId(u.id);
      if (!senderOid) return;

      const message = await Message.create({
        conversationId: convOid,
        sender: senderOid,
        content: text,
        type,
        attachmentUrl,
        fileName,
        readBy: [senderOid],
      });

      await Conversation.updateOne(
        { _id: convOid },
        { lastMessage: message._id, updatedAt: new Date() }
      );

      const populated = await Message.findById(message._id)
        .populate("sender", "username email avatar3DUrl role fullName")
        .lean();

      // Broadcast generic + specific room events (compat)
      const broadMsg = {
        roomId,
        conversationId,
        id: message._id.toString(),
        senderId: u.id,
        senderName: u.fullName || u.username,
        fullName: u.fullName || u.username,
        role: u.role,
        avatarUrl: (populated && populated.sender ? populated.sender.avatar3DUrl : null) || u.avatar3DUrl || null,
        sender: populated ? populated.sender : null,
        text,
        content: text,
        fileUrl: attachmentUrl,
        attachmentUrl,
        fileName,
        type,
        createdAt: new Date().toISOString(),
      };

      io.to(roomId).emit("room:message", broadMsg);
      io.to(`conversation:${conversationId}`).emit("new_message", populated);

      // Compat with legacy events
      if (roomId === "classA") io.to("classA").emit("classA:message", broadMsg);
      if (roomId === "classB") io.to("classB").emit("classB:message", broadMsg);
      if (roomId === "hall") io.to("hall").emit("hall:message", broadMsg);

      // Cross-room notification
      io.to(`class:${roomId}`).emit("chat_notification", {
        conversationId,
        roomId,
        lastMessage: populated,
      });

      const roomUserCount = io.sockets.adapter.rooms.get(roomId)?.size || 0;
      console.log(`[ROOM CHAT] ${u.username} → ${roomId} (users:${roomUserCount}): ${text.substring(0, 80)}${text.length > 80 ? "…" : ""}`);
    } catch (err) {
      console.error("[Socket] room:message error:", err.message, err.stack);
    }
  });

  // ---- COMPAT LEGACY ----
  socket.on("classA:message", (payload) => {
    const msg = Object.assign({}, payload || {}, { roomId: "classA" });
    socket.emit("room:message", msg);
  });
  socket.on("classB:message", (payload) => {
    const msg = Object.assign({}, payload || {}, { roomId: "classB" });
    socket.emit("room:message", msg);
  });
  socket.on("hall:message", (payload) => {
    const msg = Object.assign({}, payload || {}, { roomId: "hall" });
    socket.emit("room:message", msg);
  });

  // ---- CHAT PRIVÉ : CRÉATION/GET CONVERSATION 1v1 ----
  socket.on("request:private_chat", async (targetUserId) => {
    try {
      const senderOid = safeObjectId(u.id);
      const targetOid = safeObjectId(targetUserId);
      if (!senderOid || !targetOid) return;
      if (senderOid.toString() === targetOid.toString()) return;

      const target = await User.findById(targetOid).select("username fullName avatar3DUrl role").lean();
      if (!target) {
        socket.emit("error:private_chat", { error: "Utilisateur introuvable" });
        return;
      }

      let conversation = await Conversation.findOne({
        type: "private",
        participants: { $all: [senderOid, targetOid] },
      }).populate("participants", "username email avatar3DUrl role fullName");

      if (!conversation) {
        conversation = await Conversation.create({
          type: "private",
          participants: [senderOid, targetOid],
        });
        conversation = await conversation.populate("participants", "username email avatar3DUrl role fullName");
      }

      const convId = conversation._id.toString();
      socket.join(`conversation:${convId}`);
      socket.emit("conversation:opened", {
        conversation,
        conversationId: convId,
        targetUser: target,
      });

      // Notify target user
      io.to(targetOid.toString()).emit("notification:private_chat", {
        fromUserId: u.id,
        fromUserName: u.fullName || u.username,
        conversationId: convId,
        conversation,
      });

      console.log(`[PRIVATE CHAT] ${u.username} ⇄ ${target.username || target.fullName} (conv ${convId.substring(0, 8)})`);
    } catch (err) {
      console.error("[Socket] request:private_chat error:", err.message);
      socket.emit("error:private_chat", { error: "Erreur interne" });
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket déconnecté :", u?.username);
    const state = classAUsers.get(socket.id);
    const room = state?.room;
    const sessId = socket.id;
    classAUsers.delete(socket.id);
    if (room) {
      const roomUsers = Array.from(classAUsers.values()).filter(
        (usr) => usr.room === room
      );
      io.to(room).emit("room:users", roomUsers);
      io.to(room).emit("player:left", sessId);
    }
    broadcastPresenceUpdate({
      id: u.id,
      fullName: u.fullName || u.username,
      username: u.username,
      role: u.role,
      online: false,
      room: null,
      action: "disconnect",
      sessionId: sessId,
    });
  });
});

// ==========================================================
// 🛡️ MIDDLEWARE D'ERREUR EXPRESS GLOBAL (4 arguments)
// ==========================================================
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`🧨 Express Error [${req.method} ${req.originalUrl}] :`, err.message);
  if (err.stack) console.error("Stack:", err.stack.split("\n").slice(0, 3).join("\n"));
  if (res.headersSent) return;
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    message: status === 500 ? "Erreur serveur interne" : err.message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack?.split("\n").slice(0, 3) })
  });
});

// 404 fallback
app.use((req, res) => {
  if (res.headersSent) return;
  res.status(404).json({ message: `Route introuvable: ${req.method} ${req.originalUrl}` });
});

connectDB()
  .then(() => {
    server.listen(PORT, () => console.log(`🚀 API + WebSockets sur http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("❌ Impossible de démarrer le serveur :", err.message);
    process.exit(1);
  });
