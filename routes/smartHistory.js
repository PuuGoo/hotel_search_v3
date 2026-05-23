// Smart history routes — pattern-based query prediction

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import {
  analyzeSearchPatterns,
  predictNextQueries,
  getSearchInsights,
} from "../utils/smartHistory.js";

const router = Router();

/**
 * GET /api/smart-history/patterns
 * Analyze search patterns for the current user.
 * Query: lookbackDays, minPatternOccurrences
 */
router.get("/api/smart-history/patterns", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const lookbackDays = parseInt(req.query.lookbackDays) || 30;
  const minPatternOccurrences = parseInt(req.query.minPatternOccurrences) || 2;

  const analysis = analyzeSearchPatterns(userId, { lookbackDays, minPatternOccurrences });
  res.json(analysis);
});

/**
 * GET /api/smart-history/predictions
 * Get predicted next queries.
 * Query: currentQuery, maxPredictions, lookbackDays
 */
router.get("/api/smart-history/predictions", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const currentQuery = req.query.currentQuery || null;
  const maxPredictions = parseInt(req.query.maxPredictions) || 5;
  const lookbackDays = parseInt(req.query.lookbackDays) || 30;

  const predictions = predictNextQueries(userId, currentQuery, { maxPredictions, lookbackDays });
  res.json({ predictions, count: predictions.length });
});

/**
 * GET /api/smart-history/insights
 * Get search habit insights.
 */
router.get("/api/smart-history/insights", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const insights = getSearchInsights(userId);
  res.json(insights);
});

export default router;
