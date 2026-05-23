// Search personalization routes — personalize results based on user behavior

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import {
  buildUserPreferences,
  personalizeResults,
  getPersonalizationStats,
} from "../utils/searchPersonalization.js";

const router = Router();

/**
 * GET /api/personalization/preferences
 * Get current user's preference profile.
 */
router.get("/api/personalization/preferences", checkAuthenticated, (req, res) => {
  const preferences = buildUserPreferences(req.session.user?.id);
  res.json(preferences);
});

/**
 * POST /api/personalization/rerank
 * Re-rank results based on user preferences.
 * Body: { results }
 */
router.post("/api/personalization/rerank", checkAuthenticated, (req, res) => {
  const { results } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results array is required" });
  }

  const personalized = personalizeResults(req.session.user?.id, results);
  res.json({ results: personalized, count: personalized.length });
});

/**
 * GET /api/personalization/stats
 * Get personalization stats for current user.
 */
router.get("/api/personalization/stats", checkAuthenticated, (req, res) => {
  const stats = getPersonalizationStats(req.session.user?.id);
  res.json(stats);
});

export default router;
