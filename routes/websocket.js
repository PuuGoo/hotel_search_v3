// WebSocket management routes — manage WebSocket connections and rooms

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  getConnectionStats,
  getActiveRooms,
  getUserConnections,
  disconnectUser,
  sendToUser,
  sendToRoom,
  sendToOps,
  getOpsEventHistory,
  clearOpsEventHistory,
  clearConnectionHistory,
  getChatManager,
} from "../utils/websocket.js";
import { getSlaPredictionAlerts, getSupportSLAState } from "../utils/realtimeNotifications.js";

const router = Router();

/**
 * GET /api/websocket/stats
 * Get WebSocket connection statistics (admin only).
 */
router.get("/api/websocket/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getConnectionStats();
  res.json(stats);
});

/**
 * GET /api/websocket/rooms
 * Get active WebSocket rooms (admin only).
 */
router.get("/api/websocket/rooms", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const rooms = getActiveRooms();
  res.json({ rooms, count: rooms.length });
});

/**
 * GET /api/websocket/connections/:userId
 * Get connections for a specific user (admin only).
 */
router.get("/api/websocket/connections/:userId", checkAuthenticated, checkRole("admin"), (req, res) => {
  const connections = getUserConnections(req.params.userId);
  res.json({ userId: req.params.userId, connections, count: connections.length });
});

/**
 * POST /api/websocket/send/user
 * Send message to a specific user (admin only).
 * Body: { userId, message }
 */
router.post("/api/websocket/send/user", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) {
    return res.status(400).json({ error: "Missing userId or message", code: 400 });
  }
  sendToUser(userId, message);
  res.json({ message: "Message sent", userId });
});

/**
 * POST /api/websocket/send/room
 * Send message to a room (admin only).
 * Body: { room, message }
 */
router.post("/api/websocket/send/room", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { room, message } = req.body;
  if (!room || !message) {
    return res.status(400).json({ error: "Missing room or message", code: 400 });
  }
  sendToRoom(room, message);
  res.json({ message: "Message sent", room });
});

/**
 * POST /api/websocket/send/ops
 * Send message to admin ops room (admin only).
 * Body: { message }
 */
router.post("/api/websocket/send/ops", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Missing message", code: 400 });
  }
  const actor = req.session.user || null;
  sendToOps(message, actor, "websocket");
  res.json({ message: "Message sent", room: "ops:admin" });
});

/**
 * GET /api/websocket/ops/history
 * Get ops event history (admin only).
 */
router.get("/api/websocket/ops/history", checkAuthenticated, checkRole("admin"), (req, res) => {
  const events = getOpsEventHistory(req.query.limit || 100, {
    type: req.query.type || null,
    since: req.query.since || null,
  });
  res.json({ events, count: events.length });
});

/**
 * DELETE /api/websocket/ops/history
 * Clear ops event history (admin only).
 */
router.delete("/api/websocket/ops/history", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const count = clearOpsEventHistory();
  res.json({ message: `Cleared ${count} ops events`, count });
});

router.get("/api/websocket/diagnostics", checkAuthenticated, checkRole("admin"), (req, res) => {
  const opsHistory = getOpsEventHistory(req.query.limit || 100, {
    type: req.query.type || null,
    since: req.query.since || null,
  });
  const predictionRoomId = typeof req.query.predictionRoomId === "string" ? req.query.predictionRoomId : "";
  const escalationRoomId = typeof req.query.escalationRoomId === "string" ? req.query.escalationRoomId : "";
  const escalationStage = typeof req.query.escalationStage === "string" ? req.query.escalationStage : "";
  const parsedSince = typeof req.query.slaSince === "string" ? Date.parse(req.query.slaSince) : NaN;
  const sinceTs = Number.isFinite(parsedSince) ? parsedSince : null;

  let predictionAlerts = getSlaPredictionAlerts();
  if (predictionRoomId) {
    predictionAlerts = predictionAlerts.filter((a) => String(a.roomId) === predictionRoomId);
  }
  if (sinceTs !== null) {
    predictionAlerts = predictionAlerts.filter((a) => Date.parse(a.timestamp) >= sinceTs);
  }

  const escalationState = getSupportSLAState();
  let escalationEvents = Object.entries(escalationState).map(([roomId, stagesMap]) => {
    const stageEntries = Object.entries(stagesMap || {});
    const stages = stageEntries.map(([stage]) => stage);
    const lastEscalationTs = stageEntries.reduce((max, [, windowId]) => {
      const windowTs = Number(windowId) * 60 * 60 * 1000;
      return Number.isFinite(windowTs) && windowTs > max ? windowTs : max;
    }, 0);
    return {
      roomId,
      stages,
      windows: stagesMap || {},
      lastEscalatedAt: lastEscalationTs > 0 ? new Date(lastEscalationTs).toISOString() : null,
    };
  });
  if (escalationRoomId) {
    escalationEvents = escalationEvents.filter((e) => String(e.roomId) === escalationRoomId);
  }
  if (escalationStage) {
    escalationEvents = escalationEvents.filter((e) => e.stages.includes(escalationStage));
  }
  if (sinceTs !== null) {
    escalationEvents = escalationEvents.filter((e) => {
      if (!e.lastEscalatedAt) return false;
      return Date.parse(e.lastEscalatedAt) >= sinceTs;
    });
  }

  res.json({
    connections: getConnectionStats(),
    rooms: getActiveRooms(),
    opsHistory,
    sla: {
      escalations: {
        events: escalationEvents,
        count: escalationEvents.length,
      },
      predictions: {
        alerts: predictionAlerts,
        count: predictionAlerts.length,
      },
    },
  });
});

/**
 * POST /api/websocket/disconnect/:userId
 * Disconnect a user (admin only).
 */
router.post("/api/websocket/disconnect/:userId", checkAuthenticated, checkRole("admin"), (req, res) => {
  const count = disconnectUser(req.params.userId);
  res.json({ message: `Disconnected ${count} connection(s)`, userId: req.params.userId, count });
});

/**
 * DELETE /api/websocket/history
 * Clear connection history (admin only).
 */
router.delete("/api/websocket/history", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearConnectionHistory();
  res.json({ message: "Connection history cleared" });
});

router.post("/api/websocket/moderation/rooms/:roomId/lock", checkAuthenticated, checkRole("admin"), (req, res) => {
  const manager = getChatManager();
  const actor = req.session.user || {};
  const result = manager.lockRoom(req.params.roomId, actor.id, actor.role);
  if (!result) return res.status(404).json({ error: "Room not found" });
  sendToRoom(req.params.roomId, { type: "chat:moderation:room_locked", ...result });
  return res.json({ success: true, moderation: result });
});

router.post("/api/websocket/moderation/rooms/:roomId/unlock", checkAuthenticated, checkRole("admin"), (req, res) => {
  const manager = getChatManager();
  const actor = req.session.user || {};
  const result = manager.unlockRoom(req.params.roomId, actor.id, actor.role);
  if (!result) return res.status(404).json({ error: "Room not found" });
  sendToRoom(req.params.roomId, { type: "chat:moderation:room_unlocked", ...result });
  return res.json({ success: true, moderation: result });
});

router.post("/api/websocket/moderation/rooms/:roomId/mute", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { targetUserId } = req.body || {};
  if (!targetUserId) return res.status(400).json({ error: "Missing targetUserId" });
  const manager = getChatManager();
  const actor = req.session.user || {};
  const result = manager.muteUserInRoom(req.params.roomId, targetUserId, actor.id, actor.role);
  if (!result) return res.status(404).json({ error: "Room not found" });
  sendToRoom(req.params.roomId, { type: "chat:moderation:user_muted", roomId: req.params.roomId, ...result });
  return res.json({ success: true, moderation: result });
});

router.post("/api/websocket/moderation/rooms/:roomId/unmute", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { targetUserId } = req.body || {};
  if (!targetUserId) return res.status(400).json({ error: "Missing targetUserId" });
  const manager = getChatManager();
  const actor = req.session.user || {};
  const result = manager.unmuteUserInRoom(req.params.roomId, targetUserId, actor.id, actor.role);
  if (!result) return res.status(404).json({ error: "Room not found" });
  sendToRoom(req.params.roomId, { type: "chat:moderation:user_unmuted", roomId: req.params.roomId, ...result });
  return res.json({ success: true, moderation: result });
});

export default router;
