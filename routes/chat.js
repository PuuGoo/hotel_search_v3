import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkRole, checkAuthenticated } from "../middleware/auth.js";
import { rateLimitSearch } from "../middleware/rateLimit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CHAT_FILE = path.join(__dirname, "..", "chatbox_data.json");
const VALID_CHAT_TYPES = ["issue", "feedback", "question"];

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

    if (statusFilter && ["open", "resolved"].includes(statusFilter)) {
      messages = messages.filter((m) => m.status === statusFilter);
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

export default router;
