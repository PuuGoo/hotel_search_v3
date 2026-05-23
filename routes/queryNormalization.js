// Query normalization routes — standardize queries for better caching

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import {
  normalizeQuery,
  generateCacheKey,
  areQueriesEquivalent,
  batchNormalize,
  getNormalizationStats,
  getNormalizationOptions,
} from "../utils/queryNormalization.js";

const router = Router();

/**
 * POST /api/normalize/query
 * Normalize a single query.
 * Body: { query, options? }
 */
router.post("/api/normalize/query", checkAuthenticated, (req, res) => {
  const { query, options } = req.body;

  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  const result = normalizeQuery(query, options);
  res.json(result);
});

/**
 * POST /api/normalize/batch
 * Normalize multiple queries.
 * Body: { queries, options? }
 */
router.post("/api/normalize/batch", checkAuthenticated, (req, res) => {
  const { queries, options } = req.body;

  if (!Array.isArray(queries)) {
    return res.status(400).json({ error: "queries array is required" });
  }

  const results = batchNormalize(queries, options);
  res.json({ results, count: results.length });
});

/**
 * POST /api/normalize/equivalent
 * Check if two queries are equivalent after normalization.
 * Body: { query1, query2, options? }
 */
router.post("/api/normalize/equivalent", checkAuthenticated, (req, res) => {
  const { query1, query2, options } = req.body;

  if (!query1 || !query2) {
    return res.status(400).json({ error: "query1 and query2 are required" });
  }

  const equivalent = areQueriesEquivalent(query1, query2, options);
  res.json({ query1, query2, equivalent });
});

/**
 * POST /api/normalize/cache-key
 * Generate a cache key from a query.
 * Body: { query }
 */
router.post("/api/normalize/cache-key", checkAuthenticated, (req, res) => {
  const { query } = req.body;

  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  const key = generateCacheKey(query);
  res.json({ query, key });
});

/**
 * POST /api/normalize/stats
 * Get normalization statistics for a list of queries.
 * Body: { queries, options? }
 */
router.post("/api/normalize/stats", checkAuthenticated, (req, res) => {
  const { queries, options } = req.body;

  if (!Array.isArray(queries)) {
    return res.status(400).json({ error: "queries array is required" });
  }

  const stats = getNormalizationStats(queries, options);
  res.json(stats);
});

/**
 * GET /api/normalize/options
 * Get available normalization options.
 */
router.get("/api/normalize/options", checkAuthenticated, (req, res) => {
  const options = getNormalizationOptions();
  res.json(options);
});

export default router;
