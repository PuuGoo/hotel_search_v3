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
  clearConnectionHistory,
} from "../utils/websocket.js";

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

export default router;
