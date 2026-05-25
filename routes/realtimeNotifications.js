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
  retryPendingNotifications,
  forceResendNotification,
  getNotificationDeliveryHealth,
  getNotificationRetrySchedulerConfig,
  updateNotificationRetrySchedulerInterval,
  getPendingNotificationDetails,
  getDeadLetterNotifications,
  requeueDeadLetterNotification,
  clearDeadLetterNotifications,
  setDeliveryStatusBroadcastEnabled,
  setOpsStatusThrottleMs,
  getDeliveryStatusBroadcastConfig,
  getConversationQualitySignals,
  evaluateSupportRoomSlaPrediction,
  getSlaPredictionAlerts,
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
 * POST /api/realtime-notifications/retry
 * Retry pending notification delivery (admin only).
 * Body: { userId? }
 */
router.post("/api/realtime-notifications/retry", checkAuthenticated, checkRole("admin"), (req, res) => {
  const count = retryPendingNotifications(req.body?.userId || null);
  res.json({ message: `Retried ${count} pending notifications`, count });
});

/**
 * POST /api/realtime-notifications/resend/:notificationId
 * Force resend one pending notification by id (admin only).
 */
router.post("/api/realtime-notifications/resend/:notificationId", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = forceResendNotification(req.params.notificationId);
  if (!result.resent) {
    return res.status(404).json({ error: "Pending notification not found", code: 404 });
  }
  res.json(result);
});

/**
 * GET /api/realtime-notifications/delivery-health
 * Get delivery scheduler and queue health (admin only).
 */
router.get("/api/realtime-notifications/delivery-health", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.json(getNotificationDeliveryHealth());
});

/**
 * GET /api/realtime-notifications/retry-scheduler-config
 * Get retry scheduler config (admin only).
 */
router.get("/api/realtime-notifications/retry-scheduler-config", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.json(getNotificationRetrySchedulerConfig());
});

/**
 * PUT /api/realtime-notifications/retry-scheduler-config
 * Update retry scheduler interval (admin only).
 * Body: { intervalMs: number }
 */
router.put("/api/realtime-notifications/retry-scheduler-config", checkAuthenticated, checkRole("admin"), (req, res) => {
  const cfg = updateNotificationRetrySchedulerInterval(req.body?.intervalMs);
  res.json(cfg);
});

/**
 * GET /api/realtime-notifications/pending-details
 * Get detailed pending delivery items (admin only).
 */
router.get("/api/realtime-notifications/pending-details", checkAuthenticated, checkRole("admin"), (req, res) => {
  const details = getPendingNotificationDetails(req.query.userId || null);
  res.json({ pending: details, count: details.length });
});

/**
 * GET /api/realtime-notifications/dead-letter
 * Get dead-letter notifications (admin only).
 */
router.get("/api/realtime-notifications/dead-letter", checkAuthenticated, checkRole("admin"), (req, res) => {
  const items = getDeadLetterNotifications(req.query.limit || 100);
  res.json({ deadLetter: items, count: items.length });
});

/**
 * POST /api/realtime-notifications/dead-letter/requeue/:notificationId
 * Requeue one dead-letter notification for delivery retry (admin only).
 */
router.post("/api/realtime-notifications/dead-letter/requeue/:notificationId", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = requeueDeadLetterNotification(req.params.notificationId);
  if (!result.requeued) {
    return res.status(404).json({ error: "Dead-letter notification not found", code: 404 });
  }
  res.json(result);
});

/**
 * DELETE /api/realtime-notifications/dead-letter/clear
 * Clear dead-letter queue (admin only).
 */
router.delete("/api/realtime-notifications/dead-letter/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const count = clearDeadLetterNotifications();
  res.json({ message: `Cleared ${count} dead-letter notifications`, count });
});

/**
 * GET /api/realtime-notifications/delivery-status-config
 * Get delivery status broadcast config (admin only).
 */
router.get("/api/realtime-notifications/delivery-status-config", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.json(getDeliveryStatusBroadcastConfig());
});

/**
 * PUT /api/realtime-notifications/delivery-status-config
 * Toggle delivery status broadcast (admin only).
 * Body: { enabled: boolean }
 */
router.put("/api/realtime-notifications/delivery-status-config", checkAuthenticated, checkRole("admin"), (req, res) => {
  const enabled = setDeliveryStatusBroadcastEnabled(req.body?.enabled);
  const opsThrottleMs = req.body && Object.prototype.hasOwnProperty.call(req.body, "opsThrottleMs")
    ? setOpsStatusThrottleMs(req.body.opsThrottleMs)
    : getDeliveryStatusBroadcastConfig().opsThrottleMs;
  res.json({ enabled, opsThrottleMs });
});

router.get("/api/realtime-notifications/sla-predictions", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.json({ predictions: getSlaPredictionAlerts() });
});

router.get("/api/realtime-notifications/quality-signals", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const metrics = getConversationQualitySignals([]);
  res.json(metrics);
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
