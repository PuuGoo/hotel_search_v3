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
const PENDING_TTL_MS = 5 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 3;
const MAX_ACK_LATENCY_SAMPLES = 500;

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
const pendingNotifications = new Map(); // userId -> [{ notification, attempt, firstQueuedAt, lastEmittedAt, expiresAt }]
const deadLetterQueue = [];
const MAX_DEAD_LETTER = 1000;
const deliveryStats = {
  emitted: 0,
  retries: 0,
  acknowledged: 0,
  expired: 0,
  deadLettered: 0,
  ackLatencyMsTotal: 0,
  ackLatencyCount: 0,
  ackLatencyMsMax: 0,
};
let notificationEmitter = null;
let notificationOpsEmitter = null;
let retryTimer = null;
let retryIntervalMs = 30000;
let deliveryStatusBroadcastEnabled = true;
let opsStatusThrottleMs = 0;
let lastOpsStatusEmitAt = new Map();
const ackLatencySamples = [];
const SLA_CONFIG = {
  staleAfterMs: 30 * 60 * 1000,
  warningAfterMs: 60 * 60 * 1000,
  criticalAfterMs: 2 * 60 * 60 * 1000,
  dedupeWindowMs: 60 * 60 * 1000,
};

const NUDGE_CONFIG = {
  firstNudgeAfterMs: 45 * 60 * 1000,
  secondNudgeAfterMs: 120 * 60 * 1000,
  dedupeWindowMs: 60 * 60 * 1000,
};

export function setNotificationEmitter(emitter) {
  notificationEmitter = typeof emitter === "function" ? emitter : null;
}

export function setNotificationOpsEmitter(emitter) {
  notificationOpsEmitter = typeof emitter === "function" ? emitter : null;
}

export function setDeliveryStatusBroadcastEnabled(enabled) {
  deliveryStatusBroadcastEnabled = !!enabled;
  return deliveryStatusBroadcastEnabled;
}

export function getDeliveryStatusBroadcastConfig() {
  return {
    enabled: deliveryStatusBroadcastEnabled,
    opsThrottleMs: opsStatusThrottleMs,
  };
}

export function setOpsStatusThrottleMs(value) {
  opsStatusThrottleMs = Math.max(0, Number(value) || 0);
  return opsStatusThrottleMs;
}

function emitOpsStatus(payload) {
  if (!notificationOpsEmitter) return;
  const key = `${payload.userId || "unknown"}:${payload.notificationId || "unknown"}:${payload.status || "unknown"}`;
  const now = Date.now();
  const last = lastOpsStatusEmitAt.get(key) || 0;
  if (opsStatusThrottleMs > 0 && now - last < opsStatusThrottleMs) return;
  lastOpsStatusEmitAt.set(key, now);
  notificationOpsEmitter(payload);
}

function getAckLatencyPercentiles() {
  if (!ackLatencySamples.length) {
    return { ackLatencyMsP50: 0, ackLatencyMsP95: 0 };
  }
  const sorted = [...ackLatencySamples].sort((a, b) => a - b);
  const at = (p) => {
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1))));
    return sorted[idx];
  };
  return {
    ackLatencyMsP50: at(50),
    ackLatencyMsP95: at(95),
  };
}

export function startNotificationRetryScheduler(intervalMs = 30000) {
  if (retryTimer) clearInterval(retryTimer);
  retryIntervalMs = Math.max(5000, Number(intervalMs) || 30000);
  retryTimer = setInterval(() => {
    retryPendingNotifications(null);
  }, retryIntervalMs);
  return retryIntervalMs;
}

export function getNotificationRetrySchedulerConfig() {
  return {
    active: !!retryTimer,
    intervalMs: retryIntervalMs,
  };
}

export function updateNotificationRetrySchedulerInterval(intervalMs) {
  const nextInterval = Math.max(5000, Number(intervalMs) || retryIntervalMs || 30000);
  retryIntervalMs = nextInterval;
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = setInterval(() => {
      retryPendingNotifications(null);
    }, retryIntervalMs);
  }
  return getNotificationRetrySchedulerConfig();
}

export function stopNotificationRetryScheduler() {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

export function getNotificationDeliveryHealth() {
  let pendingTotal = 0;
  for (const [, queue] of pendingNotifications) {
    pendingTotal += queue.length;
  }
  return {
    scheduler: {
      active: !!retryTimer,
      intervalMs: retryIntervalMs,
    },
    pendingTotal,
    deadLetterTotal: deadLetterQueue.length,
    delivery: {
      ...deliveryStats,
      ackLatencyMsAvg: deliveryStats.ackLatencyCount > 0
        ? Math.round(deliveryStats.ackLatencyMsTotal / deliveryStats.ackLatencyCount)
        : 0,
      ...getAckLatencyPercentiles(),
    },
  };
}

function pushDeadLetter(item, reason) {
  deadLetterQueue.unshift({
    reason,
    movedAt: Date.now(),
    userId: item.notification?.userId,
    notificationId: item.notification?.id,
    attempt: item.attempt,
    firstQueuedAt: item.firstQueuedAt,
    lastEmittedAt: item.lastEmittedAt,
    expiresAt: item.expiresAt,
    notification: item.notification,
  });
  if (deadLetterQueue.length > MAX_DEAD_LETTER) {
    deadLetterQueue.length = MAX_DEAD_LETTER;
  }
  deliveryStats.deadLettered++;
  if (deliveryStatusBroadcastEnabled && notificationEmitter && item.notification?.userId) {
    const statusPayload = {
      type: "notification:status",
      status: "dead_letter",
      reason,
      notificationId: item.notification.id,
      attempt: item.attempt,
      timestamp: Date.now(),
    };
    notificationEmitter(item.notification.userId, statusPayload);
    emitOpsStatus({
      ...statusPayload,
      userId: item.notification.userId,
    });
  }
}

function createPendingItem(notification) {
  const now = Date.now();
  return {
    notification,
    attempt: 1,
    firstQueuedAt: now,
    lastEmittedAt: now,
    expiresAt: now + PENDING_TTL_MS,
  };
}

function cleanupExpiredPendingForUser(userId) {
  const queue = pendingNotifications.get(userId) || [];
  if (!queue.length) return;
  const now = Date.now();
  const nextQueue = queue.filter((item) => {
    const alive = item.expiresAt > now;
    if (!alive) {
      deliveryStats.expired++;
      pushDeadLetter(item, "expired");
    }
    return alive;
  });
  pendingNotifications.set(userId, nextQueue);
}

export function getPendingNotificationDetails(userId = null) {
  const users = userId ? [String(userId)] : [...pendingNotifications.keys()];
  const pending = [];
  for (const uid of users) {
    cleanupExpiredPendingForUser(uid);
    const queue = pendingNotifications.get(uid) || [];
    for (const item of queue) {
      pending.push({
        userId: uid,
        notificationId: item.notification.id,
        attempt: item.attempt,
        firstQueuedAt: item.firstQueuedAt,
        lastEmittedAt: item.lastEmittedAt,
        expiresAt: item.expiresAt,
        notification: item.notification,
      });
    }
  }
  return pending;
}

export function getDeadLetterNotifications(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
  return deadLetterQueue.slice(0, safeLimit);
}

export function clearDeadLetterNotifications() {
  const count = deadLetterQueue.length;
  deadLetterQueue.length = 0;
  return count;
}

export function requeueDeadLetterNotification(notificationId) {
  if (!notificationId) return { requeued: false, reason: "missing_notification_id" };
  const index = deadLetterQueue.findIndex((item) => item.notificationId === notificationId);
  if (index === -1) return { requeued: false, reason: "dead_letter_not_found" };
  const item = deadLetterQueue.splice(index, 1)[0];
  const userId = String(item.userId || item.notification?.userId || "");
  if (!userId) return { requeued: false, reason: "missing_user_id" };

  if (!pendingNotifications.has(userId)) {
    pendingNotifications.set(userId, []);
  }
  cleanupExpiredPendingForUser(userId);
  const queue = pendingNotifications.get(userId);
  const pendingItem = createPendingItem({
    ...item.notification,
    userId,
  });
  queue.unshift(pendingItem);
  if (queue.length > MAX_PER_USER) queue.length = MAX_PER_USER;

  if (notificationEmitter) {
    deliveryStats.emitted++;
    notificationEmitter(userId, {
      type: "notification:new",
      notification: pendingItem.notification,
      requeued: true,
    });
  }

  return {
    requeued: true,
    notificationId,
    userId,
  };
}

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
  cleanupExpiredPendingForUser(notification.userId);
  const userQueue = pendingNotifications.get(notification.userId);
  userQueue.unshift(createPendingItem(notification));
  if (userQueue.length > MAX_PER_USER) userQueue.length = MAX_PER_USER;

  // Push immediately to online sockets; pending queue is fallback for offline users.
  if (notificationEmitter) {
    deliveryStats.emitted++;
    notificationEmitter(notification.userId, {
      type: "notification:new",
      notification,
    });
  }

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
  cleanupExpiredPendingForUser(userId);
  const queue = pendingNotifications.get(userId) || [];
  const pending = queue.map((item) => item.notification);
  pendingNotifications.set(userId, []);
  return pending;
}

/**
 * Acknowledge delivery of a notification pushed over socket.
 */
export function acknowledgePendingNotification(notificationId, userId) {
  const queue = pendingNotifications.get(userId) || [];
  const ackedItem = queue.find((item) => item.notification.id === notificationId);
  const nextQueue = queue.filter((item) => item.notification.id !== notificationId);
  pendingNotifications.set(userId, nextQueue);
  const acknowledged = nextQueue.length !== queue.length;
  if (acknowledged) {
    deliveryStats.acknowledged++;
    if (ackedItem) {
      const latencyMs = Math.max(0, Date.now() - (ackedItem.lastEmittedAt || ackedItem.firstQueuedAt || Date.now()));
      deliveryStats.ackLatencyMsTotal += latencyMs;
      deliveryStats.ackLatencyCount += 1;
      deliveryStats.ackLatencyMsMax = Math.max(deliveryStats.ackLatencyMsMax, latencyMs);
      ackLatencySamples.push(latencyMs);
      if (ackLatencySamples.length > MAX_ACK_LATENCY_SAMPLES) {
        ackLatencySamples.splice(0, ackLatencySamples.length - MAX_ACK_LATENCY_SAMPLES);
      }
    }
    if (deliveryStatusBroadcastEnabled && notificationEmitter) {
      const statusPayload = {
        type: "notification:status",
        status: "acknowledged",
        notificationId,
        timestamp: Date.now(),
      };
      notificationEmitter(userId, statusPayload);
      emitOpsStatus({
        ...statusPayload,
        userId,
      });
    }
  }
  return acknowledged;
}

/**
 * Retry delivery of pending notifications for a user (or all users).
 */
export function retryPendingNotifications(userId = null) {
  const targets = userId ? [userId] : [...pendingNotifications.keys()];
  let retried = 0;
  for (const uid of targets) {
    cleanupExpiredPendingForUser(uid);
    const queue = pendingNotifications.get(uid) || [];
    const aliveQueue = [];
    for (const item of queue) {
      if (item.attempt >= MAX_RETRY_ATTEMPTS) {
        pushDeadLetter(item, "max_retry_reached");
        continue;
      }
      item.attempt++;
      item.lastEmittedAt = Date.now();
      if (notificationEmitter) {
        deliveryStats.retries++;
        notificationEmitter(uid, {
          type: "notification:new",
          notification: item.notification,
          retryAttempt: item.attempt,
        });
      }
      retried++;
      aliveQueue.push(item);
    }
    pendingNotifications.set(uid, aliveQueue);
  }
  return retried;
}

/**
 * Force resend a specific pending notification by id.
 */
export function forceResendNotification(notificationId) {
  if (!notificationId) return { resent: false, reason: "missing_notification_id" };
  for (const [userId, queue] of pendingNotifications) {
    cleanupExpiredPendingForUser(userId);
    const target = queue.find((item) => item.notification.id === notificationId);
    if (!target) continue;
    if (target.forcedResentAt) {
      return { resent: false, reason: "already_forced_resent", userId, notificationId, attempt: target.attempt };
    }
    target.attempt = Math.min(target.attempt + 1, MAX_RETRY_ATTEMPTS);
    target.lastEmittedAt = Date.now();
    target.forcedResentAt = target.lastEmittedAt;
    if (notificationEmitter) {
      deliveryStats.retries++;
      notificationEmitter(userId, {
        type: "notification:new",
        notification: target.notification,
        retryAttempt: target.attempt,
        forced: true,
      });
    }
    return { resent: true, userId, notificationId, attempt: target.attempt };
  }
  return { resent: false, reason: "pending_notification_not_found" };
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
  cleanupExpiredPendingForUser(userId);
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
    delivery: {
      ...deliveryStats,
      ackLatencyMsAvg: deliveryStats.ackLatencyCount > 0
        ? Math.round(deliveryStats.ackLatencyMsTotal / deliveryStats.ackLatencyCount)
        : 0,
      ...getAckLatencyPercentiles(),
    },
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

function getEscalationState(data) {
  if (!data.slaEscalations) data.slaEscalations = {};
  return data.slaEscalations;
}

function getNudgeState(data) {
  if (!data.nudgeState) data.nudgeState = {};
  return data.nudgeState;
}

function getSupportRoomLastActivity(room = {}, messages = []) {
  const roomTs = Date.parse(room.createdAt || 0) || 0;
  const messageTs = messages.reduce((max, m) => {
    const ts = Date.parse(m?.timestamp || 0) || 0;
    return ts > max ? ts : max;
  }, 0);
  return Math.max(roomTs, messageTs);
}

export function evaluateSupportRoomSLA(options = {}) {
  const {
    room = null,
    messages = [],
    now = Date.now(),
    adminUserIds = [],
    config = {},
  } = options;

  if (!room || room.type !== "support" || !room.id) {
    return { roomId: room?.id || null, tagged: false, stages: [], notificationsSent: 0 };
  }

  const merged = { ...SLA_CONFIG, ...config };
  const lastActivityTs = getSupportRoomLastActivity(room, messages);
  const inactiveMs = Math.max(0, now - lastActivityTs);
  const stagesToEmit = [];

  if (inactiveMs >= merged.warningAfterMs) stagesToEmit.push("warning");
  if (inactiveMs >= merged.criticalAfterMs) stagesToEmit.push("critical");

  const tagged = inactiveMs >= merged.staleAfterMs;
  if (stagesToEmit.length === 0) {
    return { roomId: room.id, tagged, stages: [], notificationsSent: 0 };
  }

  const data = readJSON(DATA_FILE);
  const state = getEscalationState(data);
  if (!state[room.id]) state[room.id] = {};

  let notificationsSent = 0;
  const emittedStages = [];

  for (const stage of stagesToEmit) {
    const windowId = Math.floor(now / merged.dedupeWindowMs);
    if (state[room.id][stage] === windowId) continue;

    state[room.id][stage] = windowId;
    emittedStages.push(stage);

    for (const adminUserId of adminUserIds) {
      sendNotification({
        userId: adminUserId,
        type: stage === "critical" ? "alert" : "warning",
        title: `Support SLA ${stage}`,
        message: `Support room ${room.id} is ${stage} due to inactivity`,
        data: {
          event: "support:sla:escalation",
          roomId: room.id,
          stage,
          tagged,
          inactiveMs,
          dedupeWindowId: windowId,
        },
      });
      notificationsSent++;
    }
  }

  writeJSON(DATA_FILE, data);

  return {
    roomId: room.id,
    tagged,
    stages: emittedStages,
    notificationsSent,
  };
}

export function evaluateSupportRoomNudges(options = {}) {
  const {
    room = null,
    messages = [],
    now = Date.now(),
    targetUserIds = [],
    config = {},
  } = options;

  if (!room || room.type !== "support" || !room.id) {
    return { roomId: room?.id || null, stages: [], notificationsSent: 0, suppressed: true };
  }

  if (room.nudgeOptOut || String(room.status || "").toLowerCase() === "resolved") {
    return { roomId: room.id, stages: [], notificationsSent: 0, suppressed: true };
  }

  const merged = { ...NUDGE_CONFIG, ...config };
  const lastActivityTs = getSupportRoomLastActivity(room, messages);
  const inactiveMs = Math.max(0, now - lastActivityTs);
  const stagesToEmit = [];

  if (inactiveMs >= merged.firstNudgeAfterMs) stagesToEmit.push("first_followup");
  if (inactiveMs >= merged.secondNudgeAfterMs) stagesToEmit.push("second_followup");

  if (stagesToEmit.length === 0 || !Array.isArray(targetUserIds) || targetUserIds.length === 0) {
    return { roomId: room.id, stages: [], notificationsSent: 0, suppressed: false };
  }

  const data = readJSON(DATA_FILE);
  const state = getNudgeState(data);
  if (!state[room.id]) state[room.id] = {};

  let notificationsSent = 0;
  const emittedStages = [];

  for (const stage of stagesToEmit) {
    const lastSentAt = Number(state[room.id][stage] || 0);
    if (lastSentAt > 0 && now - lastSentAt < merged.dedupeWindowMs) continue;
    state[room.id][stage] = now;
    emittedStages.push(stage);

    for (const userId of targetUserIds) {
      sendNotification({
        userId,
        type: "info",
        title: "Support follow-up",
        message: `We have not heard back in room ${room.id}.`,
        data: {
          event: "support:nudge",
          roomId: room.id,
          stage,
          inactiveMs,
          dedupeWindowMs: merged.dedupeWindowMs,
        },
      });
      notificationsSent++;
    }
  }

  writeJSON(DATA_FILE, data);

  return {
    roomId: room.id,
    stages: emittedStages,
    notificationsSent,
    suppressed: false,
  };
}

export function getSupportSLAState() {
  const data = readJSON(DATA_FILE);
  return { ...(data.slaEscalations || {}) };
}

export function clearSupportSLAState() {
  const data = readJSON(DATA_FILE);
  const count = Object.keys(data.slaEscalations || {}).length;
  data.slaEscalations = {};
  writeJSON(DATA_FILE, data);
  return count;
}

export function getConversationQualitySignals(events = []) {
  const stream = Array.isArray(events) ? events : [];
  const perRoom = new Map();
  const responseLatencies = [];

  for (const evt of stream) {
    const roomId = String(evt?.roomId || "");
    if (!roomId) continue;
    if (!perRoom.has(roomId)) {
      perRoom.set(roomId, { openedAt: null, firstReplyAt: null, resolved: false, reopened: 0 });
    }
    const room = perRoom.get(roomId);
    const ts = Number(evt?.timestamp) || 0;

    if (evt.type === "support:opened" && !room.openedAt) room.openedAt = ts;
    if (evt.type === "support:admin_reply" && room.openedAt && !room.firstReplyAt) room.firstReplyAt = ts;
    if (evt.type === "support:resolved") room.resolved = true;
    if (evt.type === "support:reopened") room.reopened += 1;
  }

  for (const [, room] of perRoom) {
    if (room.openedAt && room.firstReplyAt && room.firstReplyAt >= room.openedAt) {
      responseLatencies.push(room.firstReplyAt - room.openedAt);
    }
  }

  const roomsAnalyzed = perRoom.size;
  const unresolvedCount = [...perRoom.values()].filter((r) => !r.resolved).length;
  const reopenedRooms = [...perRoom.values()].filter((r) => r.reopened > 0).length;

  return {
    roomsAnalyzed,
    responseLatencyMsAvg: responseLatencies.length
      ? Math.round(responseLatencies.reduce((a, b) => a + b, 0) / responseLatencies.length)
      : 0,
    reopenRate: roomsAnalyzed > 0 ? Number((reopenedRooms / roomsAnalyzed).toFixed(4)) : 0,
    unresolvedCount,
    updatedAt: Date.now(),
  };
}

export function recordPostChatFeedback(options = {}) {
  const roomId = String(options.roomId || "").trim();
  const userId = options.userId === undefined || options.userId === null ? null : String(options.userId);
  const rating = Number(options.rating);
  const comment = String(options.comment || "").trim().slice(0, 500);
  if (!roomId) return null;
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return null;

  const data = readJSON(DATA_FILE);
  if (!Array.isArray(data.postChatFeedback)) data.postChatFeedback = [];
  const entry = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    roomId,
    userId,
    rating,
    comment,
    createdAt: Date.now(),
  };
  data.postChatFeedback.unshift(entry);
  if (data.postChatFeedback.length > 5000) data.postChatFeedback.length = 5000;
  writeJSON(DATA_FILE, data);
  return entry;
}

export function getPostChatFeedbackMetrics() {
  const data = readJSON(DATA_FILE);
  const items = Array.isArray(data.postChatFeedback) ? data.postChatFeedback : [];
  const count = items.length;
  const avgRating = count > 0 ? Number((items.reduce((acc, i) => acc + (Number(i.rating) || 0), 0) / count).toFixed(2)) : 0;
  const lowRatings = items.filter((i) => Number(i.rating) <= 2).length;
  return {
    feedbackCount: count,
    avgRating,
    lowRatingRate: count > 0 ? Number((lowRatings / count).toFixed(4)) : 0,
    updatedAt: Date.now(),
  };
}
export function evaluateSupportRoomSlaPrediction(options = {}) {
  const {
    room = null,
    messages = [],
    now = Date.now(),
    adminUserIds = [],
    config = {},
  } = options;

  if (!room || room.type !== "support" || !room.id) {
    return { roomId: room?.id || null, predicted: false, alertsSent: 0, reason: "not_support_room" };
  }

  const merged = {
    breachAfterMs: 60 * 60 * 1000,
    predictLeadMs: 30 * 60 * 1000,
    dedupeWindowMs: 60 * 60 * 1000,
    ...config,
  };

  const lastActivityTs = getSupportRoomLastActivity(room, messages);
  const inactiveMs = Math.max(0, now - lastActivityTs);
  const untilBreachMs = Math.max(0, merged.breachAfterMs - inactiveMs);
  const predicted = untilBreachMs <= merged.predictLeadMs;

  if (!predicted || !Array.isArray(adminUserIds) || adminUserIds.length === 0) {
    return { roomId: room.id, predicted, alertsSent: 0, untilBreachMs };
  }

  const data = readJSON(DATA_FILE);
  if (!data.slaPredictions) data.slaPredictions = {};
  if (!data.slaPredictions[room.id]) data.slaPredictions[room.id] = {};

  const lastSentAt = Number(data.slaPredictions[room.id].lastSentAt || 0);
  if (lastSentAt > 0 && now - lastSentAt < merged.dedupeWindowMs) {
    return { roomId: room.id, predicted: true, alertsSent: 0, untilBreachMs, deduped: true };
  }

  data.slaPredictions[room.id].lastSentAt = now;

  let alertsSent = 0;
  for (const adminUserId of adminUserIds) {
    sendNotification({
      userId: adminUserId,
      type: "warning",
      title: "SLA breach predicted",
      message: `Support room ${room.id} is approaching SLA breach`,
      data: {
        event: "support:sla:prediction",
        roomId: room.id,
        untilBreachMs,
        dedupeWindowMs: merged.dedupeWindowMs,
      },
    });
    alertsSent++;
  }

  writeJSON(DATA_FILE, data);
  return { roomId: room.id, predicted: true, alertsSent, untilBreachMs, deduped: false };
}

export function getSlaPredictionAlerts() {
  const data = readJSON(DATA_FILE);
  const notifications = Array.isArray(data.notifications) ? data.notifications : [];
  return notifications
    .filter((n) => n?.data?.event === "support:sla:prediction")
    .map((n) => ({
      id: n.id,
      userId: n.userId,
      roomId: n.data?.roomId || null,
      untilBreachMs: n.data?.untilBreachMs ?? null,
      timestamp: n.timestamp,
    }))
    .slice(0, 200);
}

/**
 * Clear all notification data.
 */
export function clearAllNotificationData() {
  pendingNotifications.clear();
  deadLetterQueue.length = 0;
  stopNotificationRetryScheduler();
  deliveryStats.emitted = 0;
  deliveryStats.retries = 0;
  deliveryStats.acknowledged = 0;
  deliveryStats.expired = 0;
  deliveryStats.deadLettered = 0;
  deliveryStats.ackLatencyMsTotal = 0;
  deliveryStats.ackLatencyCount = 0;
  deliveryStats.ackLatencyMsMax = 0;
  ackLatencySamples.length = 0;
  deliveryStatusBroadcastEnabled = true;
  opsStatusThrottleMs = 0;
  lastOpsStatusEmitAt.clear();
  writeJSON(DATA_FILE, { notifications: [], config: {}, slaEscalations: {} });
}
