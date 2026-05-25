import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkRole, checkAuthenticated } from "../middleware/auth.js";
import { rateLimitSearch } from "../middleware/rateLimit.js";
import { getChatManager } from "../utils/websocket.js";
import { recordPostChatFeedback, getPostChatFeedbackMetrics } from "../utils/realtimeNotifications.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CHAT_FILE = path.join(__dirname, "..", "chatbox_data.json");
const VALID_CHAT_TYPES = ["issue", "feedback", "question"];

function normalizeAttachment(input) {
  if (!input || typeof input !== "object") return null;
  const name = String(input.name || "").trim();
  const mimeType = String(input.mimeType || "").trim().toLowerCase();
  const url = String(input.url || "").trim();
  const size = Number(input.size);

  if (!name || name.length > 200) return { error: "Invalid attachment name" };
  if (!mimeType || mimeType.length > 100) return { error: "Invalid attachment mimeType" };
  if (!Number.isFinite(size) || size < 0 || size > 50 * 1024 * 1024) return { error: "Invalid attachment size" };

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { error: "Invalid attachment url" };
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return { error: "Invalid attachment url" };
  }

  return {
    attachment: {
      name,
      mimeType,
      size,
      url: parsedUrl.toString(),
    },
  };
}

const router = Router();

/**
 * @swagger
 * /api/chat/messages:
 *   get:
 *     summary: List chat messages
 *     description: Returns all chat messages (authenticated)
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: List of messages
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ChatMessage'
 *       401:
 *         description: Not authenticated
 *   post:
 *     summary: Create chat message
 *     description: Create a new chat message (rate limited)
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *                 maxLength: 2000
 *               type:
 *                 type: string
 *                 enum: [issue, feedback, question]
 *     responses:
 *       200:
 *         description: Message created
 *       400:
 *         description: Text is required
 *       401:
 *         description: Not authenticated
 */

// List chat messages (authenticated, paginated)
router.get("/api/chat/messages", checkAuthenticated, (req, res) => {
  try {
    let messages = [];
    if (fs.existsSync(CHAT_FILE)) {
      messages = JSON.parse(fs.readFileSync(CHAT_FILE, "utf8"));
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const statusFilter = req.query.status;
    const keyword = typeof req.query.keyword === "string" ? req.query.keyword.trim().toLowerCase() : "";
    const sender = typeof req.query.sender === "string" ? req.query.sender.trim().toLowerCase() : "";
    const from = typeof req.query.from === "string" ? Date.parse(req.query.from) : NaN;
    const to = typeof req.query.to === "string" ? Date.parse(req.query.to) : NaN;

    if (statusFilter && ["open", "resolved"].includes(statusFilter)) {
      messages = messages.filter((m) => m.status === statusFilter);
    }

    if (keyword) {
      messages = messages.filter((m) => String(m.text || "").toLowerCase().includes(keyword));
    }

    if (sender) {
      messages = messages.filter((m) => String(m.sender || "").toLowerCase() === sender);
    }

    if (Number.isFinite(from)) {
      messages = messages.filter((m) => Date.parse(m.timestamp) >= from);
    }

    if (Number.isFinite(to)) {
      messages = messages.filter((m) => Date.parse(m.timestamp) <= to);
    }

    // Sort newest first
    messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const total = messages.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paged = messages.slice(offset, offset + limit);

    res.json({
      messages: paged,
      total,
      page,
      limit,
      totalPages,
      hasMore: page < totalPages,
    });
  } catch (e) {
    console.error("Error reading chat messages:", e.message);
    res.status(500).json({ error: "Failed to read messages" });
  }
});

// Create chat message (rate limited)
router.post("/api/chat/messages", checkRole("admin", "user"), rateLimitSearch, (req, res) => {
  try {
    const text = (req.body.text || "").toString().trim().slice(0, 2000);
    const type = VALID_CHAT_TYPES.includes(req.body.type) ? req.body.type : "issue";
    const attachmentInput = req.body.attachment;
    let attachment = null;
    if (attachmentInput !== undefined) {
      const normalized = normalizeAttachment(attachmentInput);
      if (normalized?.error) {
        return res.status(400).json({ success: false, error: normalized.error });
      }
      attachment = normalized.attachment;
    }
    if (!text) {
      return res.status(400).json({ success: false, error: "Message text is required" });
    }

    let messages = [];
    if (fs.existsSync(CHAT_FILE)) {
      messages = JSON.parse(fs.readFileSync(CHAT_FILE, "utf8"));
    }
    const newMessage = {
      id: Date.now(),
      text,
      type,
      sender: req.session.user?.username || "unknown",
      senderId: req.session.user?.id || null,
      attachment: attachment || null,
      timestamp: new Date().toISOString(),
      status: "open",
    };
    messages.push(newMessage);
    fs.writeFileSync(CHAT_FILE, JSON.stringify(messages, null, 2), "utf8");
    res.json({ success: true, message: newMessage });
  } catch (e) {
    console.error("Error creating chat message:", e.message);
    res.status(500).json({ success: false, error: "Failed to create message" });
  }
});

/**
 * @swagger
 * /api/chat/messages/{id}/resolve:
 *   post:
 *     summary: Resolve chat message
 *     description: Mark a chat message as resolved (admin only)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Message resolved
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 *       404:
 *         description: Message not found
 */

// Resolve chat message
router.post("/api/chat/messages/:id/resolve", checkRole("admin"), (req, res) => {
  try {
    let messages = [];
    if (fs.existsSync(CHAT_FILE)) {
      messages = JSON.parse(fs.readFileSync(CHAT_FILE, "utf8"));
    }
    const id = Number(req.params.id);
    const msg = messages.find((m) => m.id === id);
    if (msg) {
      msg.status = "resolved";
      msg.resolvedAt = new Date().toISOString();
      fs.writeFileSync(CHAT_FILE, JSON.stringify(messages, null, 2), "utf8");
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: "Not found" });
    }
  } catch (e) {
    console.error("Error resolving chat message:", e.message);
    res.status(500).json({ success: false, error: "Failed to resolve message" });
  }
});

// List chat rooms (personalized: DM rooms show the other person's name)
router.get("/api/chat/rooms", checkAuthenticated, (req, res) => {
  try {
    const manager = getChatManager();
    const userId = req.session.user.id;
    res.json({ rooms: manager.getRoomListForUser(userId) });
  } catch (e) {
    res.status(500).json({ error: "Failed to list rooms" });
  }
});

// Create a new room
router.post("/api/chat/rooms", checkAuthenticated, (req, res) => {
  try {
    const { id, name, type } = req.body;
    if (!id || !name) {
      return res.status(400).json({ error: "id and name are required" });
    }
    const safeId = id.toString().trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 50);
    const safeName = name.toString().trim().slice(0, 100);
    if (!safeId) {
      return res.status(400).json({ error: "Invalid room id" });
    }
    const manager = getChatManager();
    const room = manager.createRoom(safeId, safeName, type || "group");
    if (!room) {
      return res.status(500).json({ error: "Failed to create room" });
    }
    // For DM rooms, auto-join the other user and notify them
    if (type === "dm" && safeId.includes("_")) {
      const parts = safeId.split("_");
      const otherUserId = parts[0] === String(req.session.user.id) ? Number(parts[1]) : Number(parts[0]);
      // Auto-join the other user's sockets to this room so they receive messages
      manager.joinUserToRoom(otherUserId, safeId);
      // Send a targeted notification so the client shows a toast
      manager.sendToUser(otherUserId, {
        type: "dm_invite",
        roomId: safeId,
        from: req.session.user.username,
      });
    }
    res.json({ success: true, room: { id: room.id, name: room.name, type: room.type } });
  } catch (e) {
    res.status(500).json({ error: "Failed to create room" });
  }
});

// Get message history for a room
router.get("/api/chat/rooms/:roomId/messages", checkAuthenticated, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const manager = getChatManager();
    let messages = manager.getMessages(req.params.roomId, Math.max(limit, 500));

    const keyword = typeof req.query.keyword === "string" ? req.query.keyword.trim().toLowerCase() : "";
    const sender = typeof req.query.sender === "string" ? req.query.sender.trim().toLowerCase() : "";
    const from = typeof req.query.from === "string" ? Date.parse(req.query.from) : NaN;
    const to = typeof req.query.to === "string" ? Date.parse(req.query.to) : NaN;

    if (keyword) {
      messages = messages.filter((m) => String(m.text || "").toLowerCase().includes(keyword));
    }
    if (sender) {
      messages = messages.filter((m) => String(m.from?.username || "").toLowerCase() === sender);
    }
    if (Number.isFinite(from)) {
      messages = messages.filter((m) => Date.parse(m.timestamp) >= from);
    }
    if (Number.isFinite(to)) {
      messages = messages.filter((m) => Date.parse(m.timestamp) <= to);
    }

    messages = messages.slice(-limit);
    res.json({ roomId: req.params.roomId, messages });
  } catch (e) {
    res.status(500).json({ error: "Failed to get messages" });
  }
});

// Toggle reaction for a message (REST fallback)
router.post("/api/chat/rooms/:roomId/messages/:messageId/reactions", checkAuthenticated, (req, res) => {
  try {
    const emoji = typeof req.body.emoji === "string" ? req.body.emoji.trim() : "";
    if (!emoji) {
      return res.status(400).json({ error: "emoji is required" });
    }
    const manager = getChatManager();
    const reaction = manager.toggleMessageReaction(
      req.params.roomId,
      req.params.messageId,
      req.session.user.id,
      req.session.user.displayName || req.session.user.username || req.session.user.id,
      emoji,
    );
    if (!reaction) {
      return res.status(404).json({ error: "Message not found" });
    }
    if (manager.io) {
      manager.io.to(req.params.roomId).emit("chat:message:reaction", reaction);
    }
    res.json({ success: true, reaction });
  } catch (e) {
    res.status(500).json({ error: "Failed to toggle reaction" });
  }
});

// Get room suggestions for admin
router.get("/api/chat/rooms/:roomId/suggestions", checkRole("admin"), (req, res) => {
  try {
    const manager = getChatManager();
    const suggestions = manager.getSuggestedReplies(req.params.roomId, {
      userId: req.session.user?.id,
      role: req.session.user?.role,
      username: req.session.user?.username,
    });
    res.json({ roomId: req.params.roomId, suggestions });
  } catch {
    res.status(500).json({ error: "Failed to get suggestions" });
  }
});

// Get online users
router.get("/api/chat/users/online", checkAuthenticated, (req, res) => {
  try {
    const manager = getChatManager();
    res.json({ users: manager.getOnlineUsers() });
  } catch (e) {
    res.status(500).json({ error: "Failed to get online users" });
  }
});

// Get current user's language preference
router.get("/api/chat/preferences/language", checkAuthenticated, (req, res) => {
  try {
    const manager = getChatManager();
    const language = manager.getUserLanguagePreference(req.session.user.id);
    res.json({ language });
  } catch {
    res.status(500).json({ error: "Failed to get language preference" });
  }
});

// Save current user's language preference
router.put("/api/chat/preferences/language", checkAuthenticated, (req, res) => {
  try {
    const language = typeof req.body.language === "string" ? req.body.language : "en";
    const manager = getChatManager();
    const saved = manager.setUserLanguagePreference(req.session.user.id, language);
    res.json({ success: true, language: saved });
  } catch {
    res.status(500).json({ success: false, error: "Failed to save language preference" });
  }
});

router.post("/api/chat/support/intake", checkAuthenticated, (req, res) => {
  try {
    const topic = typeof req.body.topic === "string" ? req.body.topic.trim().toLowerCase() : "general";
    const priority = typeof req.body.priority === "string" ? req.body.priority.trim().toLowerCase() : "normal";
    const manager = getChatManager();
    const result = manager.createSupportRoomWithRouting({
      requesterUserId: req.session.user.id,
      requesterUsername: req.session.user.username,
      topic,
      priority,
    });
    if (!result) {
      return res.status(500).json({ success: false, error: "Failed to create support room" });
    }

    if (result.routing.assignedAdminId !== null) {
      manager.sendToUser(result.routing.assignedAdminId, {
        type: "support:routing:assigned",
        roomId: result.routing.roomId,
        topic: result.routing.topic,
        priority: result.routing.priority,
      });
    }

    res.json({
      success: true,
      room: { id: result.room.id, name: result.room.name, type: result.room.type },
      routing: result.routing,
    });
  } catch {
    res.status(500).json({ success: false, error: "Failed support intake routing" });
  }
});

router.get("/api/chat/support/rooms/:roomId/assignment-suggestion", checkRole("admin"), (req, res) => {
  try {
    const topic = typeof req.query.topic === "string" ? req.query.topic.trim().toLowerCase() : "general";
    const priority = typeof req.query.priority === "string" ? req.query.priority.trim().toLowerCase() : "normal";
    const manager = getChatManager();
    const suggestion = manager.suggestSupportAssignment(req.params.roomId, topic, priority);
    if (!suggestion) return res.status(404).json({ error: "Support room not found or no admin candidates" });
    res.json({ suggestion });
  } catch {
    res.status(500).json({ error: "Failed to get assignment suggestion" });
  }
});

router.post("/api/chat/support/rooms/:roomId/assignment-decision", checkRole("admin"), (req, res) => {
  try {
    const decision = typeof req.body?.decision === "string" ? req.body.decision : "";
    const topic = typeof req.body?.topic === "string" ? req.body.topic.trim().toLowerCase() : undefined;
    const priority = typeof req.body?.priority === "string" ? req.body.priority.trim().toLowerCase() : undefined;
    const manager = getChatManager();
    const result = manager.decideSupportAssignment(
      req.params.roomId,
      { userId: req.session.user?.id, role: req.session.user?.role },
      decision,
      { topic, priority },
    );
    if (!result) return res.status(400).json({ success: false, error: "Invalid assignment decision or room" });
    res.json({ success: true, assignment: result });
  } catch {
    res.status(500).json({ success: false, error: "Failed to apply assignment decision" });
  }
});


// Get room summary
router.get("/api/chat/rooms/:roomId/summary", checkAuthenticated, (req, res) => {
  try {
    const manager = getChatManager();
    const summary = manager.generateRoomSummary(req.params.roomId);
    if (!summary) {
      return res.status(404).json({ error: "Room not found" });
    }
    res.json(summary);
  } catch {
    res.status(500).json({ error: "Failed to generate room summary" });
  }
});

// Save handoff note
router.post("/api/chat/rooms/:roomId/handoff-notes", checkAuthenticated, (req, res) => {
  try {
    const note = typeof req.body.note === "string" ? req.body.note.trim() : "";
    if (!note) {
      return res.status(400).json({ success: false, error: "note is required" });
    }
    const manager = getChatManager();
    const saved = manager.saveHandoffNote(req.params.roomId, {
      authorId: req.session.user.id,
      authorName: req.session.user.displayName || req.session.user.username || String(req.session.user.id),
      note,
    });
    if (!saved) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }
    if (manager.io) {
      manager.io.to(req.params.roomId).emit("chat:handoff:note", { roomId: req.params.roomId, note: saved });
    }
    res.json({ success: true, note: saved });
  } catch {
    res.status(500).json({ success: false, error: "Failed to save handoff note" });
  }
});

// List handoff notes
router.get("/api/chat/rooms/:roomId/handoff-notes", checkAuthenticated, (req, res) => {
  try {
    const manager = getChatManager();
    const notes = manager.getHandoffNotes(req.params.roomId);
    if (!notes) {
      return res.status(404).json({ error: "Room not found" });
    }
    res.json({ roomId: req.params.roomId, notes });
  } catch {
    res.status(500).json({ error: "Failed to get handoff notes" });
  }
});

router.post("/api/chat/rooms/:roomId/feedback", checkAuthenticated, (req, res) => {
  try {
    const rating = Number(req.body?.rating);
    const comment = typeof req.body?.comment === "string" ? req.body.comment : "";
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: "rating must be between 1 and 5" });
    }
    const entry = recordPostChatFeedback({
      roomId: req.params.roomId,
      userId: req.session.user?.id,
      rating,
      comment,
    });
    if (!entry) return res.status(400).json({ success: false, error: "invalid feedback payload" });
    const metrics = getPostChatFeedbackMetrics();
    res.json({ success: true, feedback: entry, metrics });
  } catch {
    res.status(500).json({ success: false, error: "Failed to submit feedback" });
  }
});

router.get("/api/chat/feedback/metrics", checkRole("admin"), (_req, res) => {
  try {
    res.json(getPostChatFeedbackMetrics());
  } catch {
    res.status(500).json({ error: "Failed to load feedback metrics" });
  }
});

export default router;
