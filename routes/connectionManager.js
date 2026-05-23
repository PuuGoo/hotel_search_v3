// Connection management routes — track and manage connections per user

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  registerConnection,
  unregisterConnection,
  getActiveConnections,
  getConnection,
  getUserConnectionCount,
  disconnectUser,
  getConnectionStats,
  getConnectionHistory,
  clearConnectionData,
  cleanupStale,
} from "../utils/connectionManager.js";

const router = Router();

/**
 * POST /api/connections/register
 * Register a new connection.
 * Body: { connectionId, type, metadata, ip }
 */
router.post("/api/connections/register", checkAuthenticated, (req, res) => {
  const connection = registerConnection({
    ...req.body,
    userId: req.session.user?.id,
  });
  if (connection.error) {
    return res.status(400).json({ error: connection.error, code: 400 });
  }
  res.status(201).json(connection);
});

/**
 * GET /api/connections
 * Get active connections (admin only).
 * Query: userId, type
 */
router.get("/api/connections", checkAuthenticated, checkRole("admin"), (req, res) => {
  const userId = req.query.userId || null;
  const type = req.query.type || null;
  const connections = getActiveConnections({ userId, type });
  res.json({ connections, count: connections.length });
});

/**
 * GET /api/connections/user/count
 * Get current user's connection count.
 */
router.get("/api/connections/user/count", checkAuthenticated, (req, res) => {
  const count = getUserConnectionCount(req.session.user?.id);
  res.json({ userId: req.session.user?.id, connections: count });
});

/**
 * GET /api/connections/stats
 * Get connection statistics (admin only).
 */
router.get("/api/connections/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getConnectionStats();
  res.json(stats);
});

/**
 * GET /api/connections/history
 * Get connection history (admin only).
 * Query: limit, type
 */
router.get("/api/connections/history", checkAuthenticated, checkRole("admin"), (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const type = req.query.type || null;
  const history = getConnectionHistory({ limit, type });
  res.json(history);
});

/**
 * POST /api/connections/disconnect/:userId
 * Disconnect all connections for a user (admin only).
 */
router.post("/api/connections/disconnect/:userId", checkAuthenticated, checkRole("admin"), (req, res) => {
  const count = disconnectUser(req.params.userId);
  res.json({ message: `Disconnected ${count} connection(s)`, userId: req.params.userId, count });
});

/**
 * POST /api/connections/cleanup
 * Cleanup stale connections (admin only).
 * Query: maxIdleMs
 */
router.post("/api/connections/cleanup", checkAuthenticated, checkRole("admin"), (req, res) => {
  const maxIdleMs = parseInt(req.query.maxIdleMs) || 5 * 60 * 1000;
  const cleaned = cleanupStale(maxIdleMs);
  res.json({ message: `Cleaned up ${cleaned} stale connection(s)`, cleaned });
});

/**
 * DELETE /api/connections/clear
 * Clear connection data (admin only).
 */
router.delete("/api/connections/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearConnectionData();
  res.json({ message: "Connection data cleared" });
});

/**
 * POST /api/connections/:id/unregister
 * Unregister a connection.
 */
router.post("/api/connections/:id/unregister", checkAuthenticated, (req, res) => {
  const unregistered = unregisterConnection(req.params.id);
  if (!unregistered) {
    return res.status(404).json({ error: "Connection not found", code: 404 });
  }
  res.json({ message: "Connection unregistered" });
});

/**
 * GET /api/connections/:id
 * Get connection info (admin only).
 */
router.get("/api/connections/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const connection = getConnection(req.params.id);
  if (!connection) {
    return res.status(404).json({ error: "Connection not found", code: 404 });
  }
  res.json(connection);
});

export default router;
