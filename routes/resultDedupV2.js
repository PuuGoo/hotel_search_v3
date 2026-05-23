// Result deduplication v2 routes — fuzzy matching for near-duplicates

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import {
  deduplicateResults,
  findDuplicates,
  getDedupStats,
} from "../utils/resultDedupV2.js";

const router = Router();

/**
 * POST /api/dedup/results
 * Deduplicate a list of results.
 * Body: { results, threshold?, keepFirst? }
 */
router.post("/api/dedup/results", checkAuthenticated, (req, res) => {
  const { results, threshold, keepFirst } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results array is required" });
  }

  const deduplicated = deduplicateResults(results, { threshold, keepFirst });
  res.json({
    unique: deduplicated.unique,
    duplicates: deduplicated.duplicates,
    stats: {
      total: results.length,
      unique: deduplicated.unique.length,
      removed: deduplicated.duplicates.length,
    },
  });
});

/**
 * POST /api/dedup/find
 * Find duplicates for a specific result.
 * Body: { target, results, threshold? }
 */
router.post("/api/dedup/find", checkAuthenticated, (req, res) => {
  const { target, results, threshold } = req.body;

  if (!target || !Array.isArray(results)) {
    return res.status(400).json({ error: "target and results array are required" });
  }

  const duplicates = findDuplicates(target, results, { threshold });
  res.json({ duplicates, count: duplicates.length });
});

/**
 * POST /api/dedup/stats
 * Get deduplication statistics.
 * Body: { results, threshold? }
 */
router.post("/api/dedup/stats", checkAuthenticated, (req, res) => {
  const { results, threshold } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results array is required" });
  }

  const stats = getDedupStats(results, { threshold });
  res.json(stats);
});

export default router;
