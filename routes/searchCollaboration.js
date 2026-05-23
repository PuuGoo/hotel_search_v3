// Search collaboration routes — manage real-time search collaboration sessions

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  createSession,
  joinSession,
  leaveSession,
  recordSearch,
  getActiveSessions,
  getSession,
  getCollaborationStats,
  clearCollaborationData,
} from "../utils/searchCollaboration.js";

const router = Router();

/**
 * POST /api/collaboration/sessions
 * Create a collaboration session.
 * Body: { name }
 */
router.post("/api/collaboration/sessions", checkAuthenticated, (req, res) => {
  const session = createSession({
    name: req.body.name,
    userId: req.session.user?.id,
  });
  res.status(201).json(session);
});

/**
 * GET /api/collaboration/sessions
 * Get active collaboration sessions.
 */
router.get("/api/collaboration/sessions", checkAuthenticated, (_req, res) => {
  const sessions = getActiveSessions();
  res.json({ sessions, count: sessions.length });
});

/**
 * GET /api/collaboration/sessions/:id
 * Get a specific session with details.
 */
router.get("/api/collaboration/sessions/:id", checkAuthenticated, (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found", code: 404 });
  }
  res.json(session);
});

/**
 * POST /api/collaboration/sessions/:id/join
 * Join a collaboration session.
 */
router.post("/api/collaboration/sessions/:id/join", checkAuthenticated, (req, res) => {
  const session = joinSession(req.params.id, req.session.user?.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found", code: 404 });
  }
  res.json({ message: "Joined session", sessionId: req.params.id });
});

/**
 * POST /api/collaboration/sessions/:id/leave
 * Leave a collaboration session.
 */
router.post("/api/collaboration/sessions/:id/leave", checkAuthenticated, (req, res) => {
  const left = leaveSession(req.params.id, req.session.user?.id);
  if (!left) {
    return res.status(404).json({ error: "Session not found", code: 404 });
  }
  res.json({ message: "Left session", sessionId: req.params.id });
});

/**
 * POST /api/collaboration/sessions/:id/search
 * Record a search in a session.
 * Body: { query, engine, resultCount }
 */
router.post("/api/collaboration/sessions/:id/search", checkAuthenticated, (req, res) => {
  const record = recordSearch(req.params.id, {
    ...req.body,
    userId: req.session.user?.id,
  });
  if (!record) {
    return res.status(404).json({ error: "Session not found", code: 404 });
  }
  res.status(201).json(record);
});

/**
 * GET /api/collaboration/stats
 * Get collaboration statistics (admin only).
 */
router.get("/api/collaboration/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getCollaborationStats();
  res.json(stats);
});

/**
 * DELETE /api/collaboration/clear
 * Clear collaboration data (admin only).
 */
router.delete("/api/collaboration/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearCollaborationData();
  res.json({ message: "Collaboration data cleared" });
});

export default router;
