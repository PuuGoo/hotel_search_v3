// Predictive prefetch routes — prefetch likely next search results

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  buildTransitions,
  getPredictions,
  storePrefetch,
  checkPrefetch,
  runPrefetch,
  getPrefetchStats,
  clearPrefetchCache,
} from "../utils/predictivePrefetch.js";

const router = Router();

/**
 * GET /api/prefetch/predictions
 * Get predictions for the current user's next query.
 * Query: query
 */
router.get("/api/prefetch/predictions", checkAuthenticated, (req, res) => {
  const query = req.query.query || "";
  const predictions = getPredictions(req.session.user?.id, query);
  res.json({ query, predictions, count: predictions.length });
});

/**
 * GET /api/prefetch/transitions
 * Get all transition patterns for the current user.
 * Query: hours
 */
router.get("/api/prefetch/transitions", checkAuthenticated, (req, res) => {
  const hours = parseInt(req.query.hours) || 168;
  const transitions = buildTransitions(req.session.user?.id, { hours });
  res.json({ transitions, count: Object.keys(transitions).length });
});

/**
 * GET /api/prefetch/check
 * Check if a query has prefetched results.
 * Query: query, engine
 */
router.get("/api/prefetch/check", checkAuthenticated, (req, res) => {
  const query = req.query.query || "";
  const engine = req.query.engine || null;

  const result = checkPrefetch(query, engine);
  if (!result) {
    return res.json({ cached: false, query, engine });
  }

  res.json({ cached: true, ...result });
});

/**
 * POST /api/prefetch/store
 * Store a prefetched result (admin only).
 * Body: { query, engine, results }
 */
router.post("/api/prefetch/store", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { query, engine, results } = req.body;

  if (!query || !results) {
    return res.status(400).json({ error: "query and results are required" });
  }

  storePrefetch(query, engine, results);
  res.status(201).json({ message: "Prefetch stored", query, engine });
});

/**
 * POST /api/prefetch/run
 * Run prefetch for predicted queries (admin only).
 * Body: { query, engine?, maxPrefetches? }
 */
router.post("/api/prefetch/run", checkAuthenticated, checkRole("admin"), async (req, res) => {
  const { query, engine, maxPrefetches } = req.body;

  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  // Use a simple search function that returns empty results
  const searchFn = async (q, e) => ({ query: q, engine: e, results: [], prefetched: true });

  try {
    const results = await runPrefetch(req.session.user?.id, query, searchFn, { engine, maxPrefetches });
    res.json({ results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: "Prefetch failed" });
  }
});

/**
 * GET /api/prefetch/stats
 * Get prefetch statistics (admin only).
 */
router.get("/api/prefetch/stats", checkAuthenticated, checkRole("admin"), (req, res) => {
  const stats = getPrefetchStats();
  res.json(stats);
});

/**
 * DELETE /api/prefetch/cache
 * Clear prefetch cache (admin only).
 */
router.delete("/api/prefetch/cache", checkAuthenticated, checkRole("admin"), (req, res) => {
  clearPrefetchCache();
  res.json({ message: "Prefetch cache cleared" });
});

export default router;
