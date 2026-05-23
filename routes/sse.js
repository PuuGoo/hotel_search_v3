// SSE routes — real-time event stream for authenticated users

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import { getSSEManager } from "../middleware/sse.js";

const router = Router();

/**
 * GET /api/sse — Connect to the SSE event stream.
 * Query params: events (comma-separated event types to subscribe to)
 * Supported events: notification, search-progress, price-alert
 */
router.get("/api/sse", checkAuthenticated, (req, res) => {
  const sse = getSSEManager();
  const userId = req.session.user.id;

  sse.addClient(userId, res);

  // Don't call res.end() — SSE stays open
  req.on("close", () => {
    // Cleanup handled by SSEManager's res.on("close")
  });
});

/**
 * POST /api/sse/send — Send an event to a specific user (admin/system use).
 * Body: { userId, type, data }
 */
router.post("/api/sse/send", checkAuthenticated, (req, res) => {
  const { userId, type, data } = req.body;

  if (!userId || !type) {
    return res.status(400).json({ error: "userId and type are required" });
  }

  const sse = getSSEManager();
  const sent = sse.sendToUser(userId, { type, data, timestamp: Date.now() });
  res.json({ success: true, sent });
});

/**
 * POST /api/sse/broadcast — Broadcast an event to all connected clients (admin only).
 * Body: { type, data }
 */
router.post("/api/sse/broadcast", checkAuthenticated, (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  const { type, data } = req.body;
  if (!type) {
    return res.status(400).json({ error: "type is required" });
  }

  const sse = getSSEManager();
  const sent = sse.broadcast({ type, data, timestamp: Date.now() });
  res.json({ success: true, sent });
});

/**
 * GET /api/sse/stats — Get SSE connection stats (admin only).
 */
router.get("/api/sse/stats", checkAuthenticated, (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  const sse = getSSEManager();
  res.json(sse.stats());
});

export default router;
