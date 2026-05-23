// Real-time notification delivery — push notifications to connected clients instantly
// Manages notification queue and delivery via WebSocket/SSE connections

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "realtime_notifications.json");
const MAX_NOTIFICATIONS = 10000;
const MAX_PER_USER = 500;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { notifications: [], config: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data));
  } catch { /* ignore */ }
}

// In-memory notification queue for immediate delivery
const pendingNotifications = new Map(); // userId -> [notification]

/**
 * Send a notification to a user.
 */
export function sendNotification(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.notifications) data.notifications = [];

  const notification = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: options.userId,
    type: options.type || "info", // info, warning, alert, success
    title: options.title || "",
    message: options.message || "",
    data: options.data || null,
    read: false,
    timestamp: Date.now(),
  };

  // Store in file
  data.notifications.unshift(notification);
  if (data.notifications.length > MAX_NOTIFICATIONS) {
    data.notifications.length = MAX_NOTIFICATIONS;
  }
  writeJSON(DATA_FILE, data);

  // Queue for immediate delivery
  if (!pendingNotifications.has(notification.userId)) {
    pendingNotifications.set(notification.userId, []);
  }
  const userQueue = pendingNotifications.get(notification.userId);
  userQueue.unshift(notification);
  if (userQueue.length > MAX_PER_USER) userQueue.length = MAX_PER_USER;

  return notification;
}

/**
 * Send notification to multiple users.
 */
export function broadcastNotification(options = {}) {
  const userIds = options.userIds || [];
  const results = [];

  for (const userId of userIds) {
    results.push(sendNotification({ ...options, userId }));
  }

  return results;
}

/**
 * Get notifications for a user.
 */
export function getNotifications(userId, options = {}) {
  const { unreadOnly = false, limit = 50, offset = 0 } = options;
  const data = readJSON(DATA_FILE);
  let notifications = (data.notifications || []).filter((n) => n.userId === userId);

  if (unreadOnly) {
    notifications = notifications.filter((n) => !n.read);
  }

  return {
    notifications: notifications.slice(offset, offset + limit),
    total: notifications.length,
    unread: notifications.filter((n) => !n.read).length,
  };
}

/**
 * Get pending (undelivered) notifications for a user.
 */
export function getPendingNotifications(userId) {
  const pending = pendingNotifications.get(userId) || [];
  pendingNotifications.set(userId, []);
  return pending;
}

/**
 * Mark notification as read.
 */
export function markAsRead(notificationId, userId) {
  const data = readJSON(DATA_FILE);
  const notification = (data.notifications || []).find(
    (n) => n.id === notificationId && n.userId === userId
  );

  if (!notification) return false;

  notification.read = true;
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Mark all notifications as read for a user.
 */
export function markAllAsRead(userId) {
  const data = readJSON(DATA_FILE);
  let count = 0;

  for (const notification of data.notifications || []) {
    if (notification.userId === userId && !notification.read) {
      notification.read = true;
      count++;
    }
  }

  writeJSON(DATA_FILE, data);
  return count;
}

/**
 * Delete a notification.
 */
export function deleteNotification(notificationId, userId) {
  const data = readJSON(DATA_FILE);
  const index = (data.notifications || []).findIndex(
    (n) => n.id === notificationId && n.userId === userId
  );

  if (index === -1) return false;

  data.notifications.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Get notification statistics for a user.
 */
export function getNotificationStats(userId) {
  const data = readJSON(DATA_FILE);
  const notifications = (data.notifications || []).filter((n) => n.userId === userId);

  const typeCounts = {};
  for (const n of notifications) {
    typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
  }

  return {
    total: notifications.length,
    unread: notifications.filter((n) => !n.read).length,
    byType: typeCounts,
    pendingDelivery: (pendingNotifications.get(userId) || []).length,
  };
}

/**
 * Clear notifications for a user.
 */
export function clearNotifications(userId) {
  const data = readJSON(DATA_FILE);
  data.notifications = (data.notifications || []).filter((n) => n.userId !== userId);
  writeJSON(DATA_FILE, data);
  pendingNotifications.delete(userId);
}

/**
 * Clear all notification data.
 */
export function clearAllNotificationData() {
  pendingNotifications.clear();
  writeJSON(DATA_FILE, { notifications: [], config: {} });
}
