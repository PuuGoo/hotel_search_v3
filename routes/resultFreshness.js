// Result freshness routes — score and filter results by freshness

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import {
  calculateFreshnessScore,
  scoreByFreshness,
  sortByFreshness,
  filterByFreshness,
  getFreshnessStats,
} from "../utils/resultFreshness.js";

const router = Router();

/**
 * POST /api/freshness/score
 * Calculate freshness score for a single result.
 * Body: { result, options? }
 */
router.post("/api/freshness/score", checkAuthenticated, (req, res) => {
  const { result, options } = req.body;

  if (!result || typeof result !== "object") {
    return res.status(400).json({ error: "result object is required" });
  }

  const freshness = calculateFreshnessScore(result, options);
  res.json({ result, freshness });
});

/**
 * POST /api/freshness/batch
 * Score multiple results by freshness.
 * Body: { results[], options? }
 */
router.post("/api/freshness/batch", checkAuthenticated, (req, res) => {
  const { results, options } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results array is required" });
  }

  const scored = scoreByFreshness(results, options);
  const stats = getFreshnessStats(results, options);
  res.json({ results: scored, stats });
});

/**
 * POST /api/freshness/sort
 * Sort results by freshness.
 * Body: { results[], direction?, options? }
 */
router.post("/api/freshness/sort", checkAuthenticated, (req, res) => {
  const { results, direction, options } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results array is required" });
  }

  const sorted = sortByFreshness(results, direction);
  const stats = getFreshnessStats(sorted, options);
  res.json({ results: sorted, stats });
});

/**
 * POST /api/freshness/filter
 * Filter results by minimum freshness score.
 * Body: { results[], minScore?, options? }
 */
router.post("/api/freshness/filter", checkAuthenticated, (req, res) => {
  const { results, minScore, options } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results array is required" });
  }

  const filtered = filterByFreshness(results, minScore, options);
  const stats = getFreshnessStats(results, options);
  res.json({
    results: filtered,
    stats,
    filter: { minScore: minScore || 50, passed: filtered.length, total: results.length },
  });
});

/**
 * POST /api/freshness/stats
 * Get freshness statistics for results.
 * Body: { results[], options? }
 */
router.post("/api/freshness/stats", checkAuthenticated, (req, res) => {
  const { results, options } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results array is required" });
  }

  const stats = getFreshnessStats(results, options);
  res.json(stats);
});

export default router;
