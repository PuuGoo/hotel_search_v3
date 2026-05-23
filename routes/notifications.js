import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";
import { getSSEManager } from "../middleware/sse.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "notifications.json");

const router = Router();

function readNotifications() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading notifications:", e.message);
  }
  return [];
}

function writeNotifications(notifications) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(notifications, null, 2));
}

// Get all notifications for current user
router.get("/api/notifications", checkAuthenticated, (req, res) => {
  const notifications = readNotifications();
  const userNotifications = notifications
    .filter((n) => n.userId === req.session.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const unread = userNotifications.filter((n) => !n.read).length;
  res.json({ notifications: userNotifications, unread, total: userNotifications.length });
});

// Create a notification (system use or admin)
router.post("/api/notifications", checkAuthenticated, (req, res) => {
  const { userId, title, message, type, link } = req.body;

  if (!title || !message) {
    return res.status(400).json({ error: "title and message are required" });
  }

  const notifications = readNotifications();
  const notification = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: userId || req.session.user.id,
    title: title.trim(),
    message: message.trim(),
    type: type || "info", // info, success, warning, error
    link: (link || "").trim(),
    read: false,
    createdAt: new Date().toISOString(),
  };

  notifications.push(notification);
  writeNotifications(notifications);

  // Push real-time SSE event to the target user
  try {
    getSSEManager().sendToUser(notification.userId, {
      type: "notification",
      data: notification,
    });
  } catch {
    // SSE not critical — notification persisted to file
  }

  res.status(201).json(notification);
});

// Mark a notification as read
router.put("/api/notifications/:id/read", checkAuthenticated, (req, res) => {
  const notifications = readNotifications();
  const idx = notifications.findIndex((n) => n.id === req.params.id && n.userId === req.session.user.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Notification not found" });
  }
  notifications[idx].read = true;
  writeNotifications(notifications);
  res.json(notifications[idx]);
});

// Mark all notifications as read
router.put("/api/notifications/read-all", checkAuthenticated, (req, res) => {
  const notifications = readNotifications();
  let count = 0;
  for (const n of notifications) {
    if (n.userId === req.session.user.id && !n.read) {
      n.read = true;
      count++;
    }
  }
  writeNotifications(notifications);
  res.json({ success: true, marked: count });
});

// Delete all read notifications (must be before :id route)
router.delete("/api/notifications/clear-read", checkAuthenticated, (req, res) => {
  const notifications = readNotifications();
  const before = notifications.length;
  const remaining = notifications.filter(
    (n) => !(n.userId === req.session.user.id && n.read)
  );
  writeNotifications(remaining);
  res.json({ success: true, deleted: before - remaining.length });
});

// Delete a notification
router.delete("/api/notifications/:id", checkAuthenticated, (req, res) => {
  const notifications = readNotifications();
  const idx = notifications.findIndex((n) => n.id === req.params.id && n.userId === req.session.user.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Notification not found" });
  }
  notifications.splice(idx, 1);
  writeNotifications(notifications);
  res.json({ success: true });
});

// Unread count (lightweight endpoint for polling)
router.get("/api/notifications/unread-count", checkAuthenticated, (req, res) => {
  const notifications = readNotifications();
  const count = notifications.filter((n) => n.userId === req.session.user.id && !n.read).length;
  res.json({ count });
});

export default router;
