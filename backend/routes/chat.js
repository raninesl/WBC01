import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { auth } from "../middleware/auth.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import User from "../models/User.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_CLASS_ROOMS = ["hall", "classA", "classB"];

function mapClassToRoom(studentClass) {
    if (!studentClass) return null;
    const lower = String(studentClass).trim().toLowerCase();
    if (VALID_CLASS_ROOMS.includes(lower)) return lower;
    if (lower === "a") return "classA";
    if (lower === "b") return "classB";
    if (lower.startsWith("class")) { // "class a" / "classe a" etc
        if (lower.includes("a")) return "classA";
        if (lower.includes("b")) return "classB";
    }
    return null;
}

// Configure storage
const uploadDir = path.join(__dirname, "..", "uploads");
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`),
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// --- ROUTES ---

// 1. Get all conversations for current user
router.get("/conversations", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });

        const userRoom = mapClassToRoom(user.studentClass);

        // Ensure Class Chat exists if user has a class
        if (userRoom && userRoom !== "hall") {
            const classChat = await Conversation.findOne({ 
                type: "class", 
                relatedClass: userRoom
            });
            
            if (!classChat) {
                await Conversation.create({
                    type: "class",
                    relatedClass: userRoom,
                    name: userRoom === "classA" ? "📚 Classe A" : (userRoom === "classB" ? "📚 Classe B" : "Classe"),
                    participants: []
                });
            }
        }

        // Ensure Hall Chat exists for EVERY user
        let hallChat = await Conversation.findOne({ type: "class", relatedClass: "hall" });
        if (!hallChat) {
            hallChat = await Conversation.create({
                type: "class",
                relatedClass: "hall",
                name: "🏛️ Hall WES'SUP",
                participants: []
            });
        }

        // Fetch conversations:
        // 1. Where user is explicit participant
        // 2. OR where type is 'class' and relatedClass is user's ROOM (classA/classB)
        // 3. OR Hall Chat (accessible to all users)
        const orCriterias = [
            { participants: req.user.id },
            { type: "class", relatedClass: "hall" }
        ];
        if (userRoom) orCriterias.push({ type: "class", relatedClass: userRoom });

        const conversations = await Conversation.find({ $or: orCriterias })
        .populate("participants", "username email avatar3DUrl avatarUrl role fullName")
        .populate("lastMessage")
        .sort({ updatedAt: -1 });

        res.json(conversations);
    } catch (e) {
        console.error("Get conversations error:", e);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

// 2. Create/Get Private Conversation
router.post("/conversation/private", auth, async (req, res) => {
    try {
        const { recipientId } = req.body;
        if (!recipientId) return res.status(400).json({ message: "Destinataire manquant" });

        // Check if exists
        let conversation = await Conversation.findOne({
            type: "private",
            participants: { $all: [req.user.id, recipientId] }
        }).populate("participants", "username email avatar3DUrl avatarUrl role");

        if (!conversation) {
            conversation = await Conversation.create({
                type: "private",
                participants: [req.user.id, recipientId]
            });
            conversation = await conversation.populate("participants", "username email avatar3DUrl avatarUrl role");
        }

        res.json(conversation);
    } catch (e) {
        console.error("Create private conversation error:", e);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

// 3. Create Group Conversation
router.post("/conversation/group", auth, async (req, res) => {
    try {
        const { name, participantIds } = req.body;
        if (!name || !participantIds || participantIds.length === 0) {
            return res.status(400).json({ message: "Nom et participants requis" });
        }

        const allParticipants = [...new Set([req.user.id, ...participantIds])];

        let conversation = await Conversation.create({
            type: "group",
            name,
            participants: allParticipants,
            admins: [req.user.id]
        });

        conversation = await conversation.populate("participants", "username email avatar3DUrl avatarUrl role");
        res.json(conversation);
    } catch (e) {
        console.error("Create group conversation error:", e);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

// 4. Get Messages for a Conversation
router.get("/conversation/:id/messages", auth, async (req, res) => {
    try {
        const conversationId = req.params.id;
        
        // Check access
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return res.status(404).json({ message: "Conversation introuvable" });

        const user = await User.findById(req.user.id);
        const userRoom = mapClassToRoom(user.studentClass);
        const isParticipant = conversation.participants.includes(req.user.id);
        const isHallChat = conversation.type === "class" && conversation.relatedClass === "hall";
        const isClassRoomChat = conversation.type === "class" && userRoom && conversation.relatedClass === userRoom;
        const isClassRelatedMatch = conversation.type === "class" && VALID_CLASS_ROOMS.includes(conversation.relatedClass) && conversation.relatedClass === userRoom;

        const hasAccess = isParticipant || isHallChat || isClassRoomChat || isClassRelatedMatch;
        if (!hasAccess) {
            console.warn(`[Chat 403] user=${user.username} studentClass=${user.studentClass} conv=${conversation._id} type=${conversation.type} related=${conversation.relatedClass}`);
            return res.status(403).json({ message: "Accès refusé" });
        }

        const messages = await Message.find({ conversationId })
            .populate("sender", "username email avatar3DUrl avatarUrl role fullName")
            .sort({ createdAt: 1 });

        res.json(messages);
    } catch (e) {
        console.error("Get messages error:", e);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

// 5. Send Message (Text or File)
router.post("/conversation/:id/messages", auth, upload.single("attachment"), async (req, res) => {
    try {
        const conversationId = req.params.id;
        const { content, type } = req.body; // type can be 'text', 'file', etc.
        
        // Check access
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return res.status(404).json({ message: "Conversation introuvable" });

        const user = await User.findById(req.user.id);
        const userRoom = mapClassToRoom(user.studentClass);
        const isParticipant = conversation.participants.includes(req.user.id);
        const isHallChat = conversation.type === "class" && conversation.relatedClass === "hall";
        const isClassRoomChat = conversation.type === "class" && userRoom && conversation.relatedClass === userRoom;
        const isClassRelatedMatch = conversation.type === "class" && VALID_CLASS_ROOMS.includes(conversation.relatedClass) && conversation.relatedClass === userRoom;

        const hasAccess = isParticipant || isHallChat || isClassRoomChat || isClassRelatedMatch;
        if (!hasAccess) {
            console.warn(`[Chat POST 403] user=${user.username} studentClass=${user.studentClass} conv=${conversation._id} type=${conversation.type} related=${conversation.relatedClass}`);
            return res.status(403).json({ message: "Accès refusé" });
        }

        let attachmentUrl = null;
        let fileName = null;
        let msgType = type || "text";

        if (req.file) {
            attachmentUrl = `/uploads/${req.file.filename}`;
            fileName = req.file.originalname;
            msgType = req.file.mimetype.startsWith("image/") ? "image" : "file";
        }

        const message = await Message.create({
            conversationId,
            sender: req.user.id,
            content: content || "",
            type: msgType,
            attachmentUrl,
            fileName
        });

        const populatedMessage = await Message.findById(message._id)
            .populate("sender", "username email avatar3DUrl avatarUrl role");

        // Update conversation lastMessage
        conversation.lastMessage = message._id;
        conversation.updatedAt = new Date();
        await conversation.save();

        // Socket.io emit
        if (req.io) {
            // Emit to the conversation room (for live updates in chat window)
            req.io.to(`conversation:${conversationId}`).emit("new_message", populatedMessage);

            // Notify participants (for badges/lists)
            if (conversation.type === "class" && conversation.relatedClass) {
                // Notify all users in the class room
                req.io.to(`class:${conversation.relatedClass}`).emit("chat_notification", {
                    conversationId,
                    lastMessage: populatedMessage
                });
            } else {
                // Private/Group: Notify specific participants
                conversation.participants.forEach(pId => {
                    const pIdStr = pId.toString();
                    req.io.to(pIdStr).emit("chat_notification", { 
                        conversationId, 
                        lastMessage: populatedMessage 
                    });
                });
            }
        }

        res.json(populatedMessage);
    } catch (e) {
        console.error("Send message error:", e);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

// 6. Search Users
router.get("/users/search", auth, async (req, res) => {
    try {
        const q = req.query.q || "";
        // if (q.length < 2) return res.json([]); // Requirement removed

        let query = {
                    _id: { $ne: req.user.id } // Exclude self
                };

        if (q.trim()) {
            query.$or = [
                { username: { $regex: q, $options: "i" } },
                { email: { $regex: q, $options: "i" } },
                { fullName: { $regex: q, $options: "i" } }
            ];
        }

        const users = await User.find(query)
            .select("username email avatar3DUrl avatarUrl role")
            .limit(100); // Increased limit to show more users

        res.json(users);
    } catch (e) {
        console.error("Search users error:", e);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

// 7. Upload endpoint
router.post("/upload", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Aucun fichier fourni" });

    const isImage = req.file.mimetype.startsWith("image/");
    const type = isImage ? "image" : "file";
    
    const fileUrl = `/uploads/${req.file.filename}`;

    res.json({ 
        ok: true, 
        fileUrl, 
        type, 
        originalName: req.file.originalname,
        mimeType: req.file.mimetype
    });

  } catch (e) {
    console.error("Chat upload error:", e);
    res.status(500).json({ message: "Erreur lors de l'upload" });
  }
});

export default router;
