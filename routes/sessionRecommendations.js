// Session-based recommendation routes

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import {
  getSessionHistory,
  getSessionContext,
  getSessionRecommendations,
  getSessionStats,
} from "../utils/sessionRecommendations.js";

const router = Router();

/**
 * GET /api/session/history
 * Get current session's search history.
 */
router.get("/api/session/history", checkAuthenticated, (req, res) => {
  const history = getSessionHistory(req.session.user?.id);
  res.json({ history, count: history.length });
});

/**
 * GET /api/session/context
 * Get current session context (topics, locations, engines).
 */
router.get("/api/session/context", checkAuthenticated, (req, res) => {
  const context = getSessionContext(req.session.user?.id);
  res.json(context);
});

/**
 * GET /api/session/recommendations
 * Get session-based recommendations.
 * Query: limit
 */
router.get("/api/session/recommendations", checkAuthenticated, (req, res) => {
  const limit = parseInt(req.query.limit) || 5;
  const result = getSessionRecommendations(req.session.user?.id, { maxRecommendations: limit });
  res.json(result);
});

/**
 * GET /api/session/stats
 * Get session statistics.
 */
router.get("/api/session/stats", checkAuthenticated, (req, res) => {
  const stats = getSessionStats(req.session.user?.id);
  res.json(stats);
});

export default router;
