// Search session routes — group related searches into sessions

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import {
  groupSearchSessions,
  getSessionSummary,
  getSession,
  getSessionStats,
  saveSession,
  getSavedSessions,
  deleteSavedSession,
} from "../utils/searchSessions.js";

const router = Router();

/**
 * GET /api/sessions
 * Get all search sessions for the current user.
 * Query: sessionTimeout (ms), minSimilarity (0-1)
 */
router.get("/api/sessions", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const sessionTimeout = parseInt(req.query.sessionTimeout) || undefined;
  const minSimilarity = parseFloat(req.query.minSimilarity) || undefined;

  const sessions = groupSearchSessions(userId, { sessionTimeout, minSimilarity });
  res.json({ sessions, count: sessions.length });
});

/**
 * GET /api/sessions/summary
 * Get session summaries (without full search details).
 */
router.get("/api/sessions/summary", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const sessions = getSessionSummary(userId);
  res.json({ sessions, count: sessions.length });
});

/**
 * GET /api/sessions/stats
 * Get session statistics.
 */
router.get("/api/sessions/stats", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const stats = getSessionStats(userId);
  res.json(stats);
});

/**
 * GET /api/sessions/saved
 * Get saved sessions.
 */
router.get("/api/sessions/saved", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const saved = getSavedSessions(userId);
  res.json({ sessions: saved, count: saved.length });
});

/**
 * GET /api/sessions/:sessionId
 * Get a specific session by ID.
 */
router.get("/api/sessions/:sessionId", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const session = getSession(userId, req.params.sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.json(session);
});

/**
 * POST /api/sessions/:sessionId/save
 * Save a session for later reference.
 * Body: { name? }
 */
router.post("/api/sessions/:sessionId/save", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { name } = req.body;

  const saved = saveSession(userId, req.params.sessionId, name);

  if (!saved) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.json(saved);
});

/**
 * DELETE /api/sessions/saved/:sessionId
 * Delete a saved session.
 */
router.delete("/api/sessions/saved/:sessionId", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const deleted = deleteSavedSession(userId, req.params.sessionId);

  if (!deleted) {
    return res.status(404).json({ error: "Saved session not found" });
  }

  res.json({ message: "Session deleted" });
});

export default router;
