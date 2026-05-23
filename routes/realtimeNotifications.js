// Real-time notification routes — manage push notifications

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  sendNotification,
  broadcastNotification,
  getNotifications,
  getPendingNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getNotificationStats,
  clearNotifications,
  clearAllNotificationData,
} from "../utils/realtimeNotifications.js";

const router = Router();

/**
 * POST /api/realtime-notifications/send
 * Send a notification to a user (admin only).
 * Body: { userId, type, title, message, data }
 */
router.post("/api/realtime-notifications/send", checkAuthenticated, checkRole("admin"), (req, res) => {
  const notification = sendNotification(req.body);
  res.status(201).json(notification);
});

/**
 * POST /api/realtime-notifications/broadcast
 * Send notification to multiple users (admin only).
 * Body: { userIds, type, title, message, data }
 */
router.post("/api/realtime-notifications/broadcast", checkAuthenticated, checkRole("admin"), (req, res) => {
  const results = broadcastNotification(req.body);
  res.status(201).json({ notifications: results, count: results.length });
});

/**
 * GET /api/realtime-notifications
 * Get notifications for current user.
 * Query: unreadOnly, limit, offset
 */
router.get("/api/realtime-notifications", checkAuthenticated, (req, res) => {
  const unreadOnly = req.query.unreadOnly === "true";
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const result = getNotifications(req.session.user?.id, { unreadOnly, limit, offset });
  res.json(result);
});

/**
 * GET /api/realtime-notifications/pending
 * Get pending notifications for current user.
 */
router.get("/api/realtime-notifications/pending", checkAuthenticated, (req, res) => {
  const pending = getPendingNotifications(req.session.user?.id);
  res.json({ notifications: pending, count: pending.length });
});

/**
 * GET /api/realtime-notifications/stats
 * Get notification statistics for current user.
 */
router.get("/api/realtime-notifications/stats", checkAuthenticated, (req, res) => {
  const stats = getNotificationStats(req.session.user?.id);
  res.json(stats);
});

/**
 * PUT /api/realtime-notifications/read-all
 * Mark all notifications as read.
 */
router.put("/api/realtime-notifications/read-all", checkAuthenticated, (req, res) => {
  const count = markAllAsRead(req.session.user?.id);
  res.json({ message: `Marked ${count} notifications as read`, count });
});

/**
 * PUT /api/realtime-notifications/:id/read
 * Mark a notification as read.
 */
router.put("/api/realtime-notifications/:id/read", checkAuthenticated, (req, res) => {
  const marked = markAsRead(req.params.id, req.session.user?.id);
  if (!marked) {
    return res.status(404).json({ error: "Notification not found", code: 404 });
  }
  res.json({ message: "Marked as read" });
});

/**
 * DELETE /api/realtime-notifications/clear
 * Clear all notifications for current user.
 */
router.delete("/api/realtime-notifications/clear", checkAuthenticated, (req, res) => {
  clearNotifications(req.session.user?.id);
  res.json({ message: "Notifications cleared" });
});

/**
 * DELETE /api/realtime-notifications/clear-all
 * Clear all notification data (admin only).
 */
router.delete("/api/realtime-notifications/clear-all", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearAllNotificationData();
  res.json({ message: "All notification data cleared" });
});

/**
 * DELETE /api/realtime-notifications/:id
 * Delete a notification.
 */
router.delete("/api/realtime-notifications/:id", checkAuthenticated, (req, res) => {
  const deleted = deleteNotification(req.params.id, req.session.user?.id);
  if (!deleted) {
    return res.status(404).json({ error: "Notification not found", code: 404 });
  }
  res.json({ message: "Notification deleted" });
});

export default router;
