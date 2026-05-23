// Intelligent cache routes — cache management and statistics

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  getCached,
  setCache,
  invalidateCache,
  invalidateExpired,
  clearCache,
  warmCache,
  getCacheStats,
  getCacheEntries,
  generateCacheKey,
} from "../utils/intelligentCache.js";

const router = Router();

/**
 * GET /api/cache/stats
 * Get cache statistics (admin only).
 */
router.get("/api/cache/stats", checkAuthenticated, checkRole("admin"), (req, res) => {
  const stats = getCacheStats();
  res.json(stats);
});

/**
 * GET /api/cache/entries
 * Get cache entries for debugging (admin only).
 * Query: limit, offset
 */
router.get("/api/cache/entries", checkAuthenticated, checkRole("admin"), (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const entries = getCacheEntries({ limit, offset });
  res.json(entries);
});

/**
 * POST /api/cache/invalidate
 * Invalidate cache entries matching a pattern (admin only).
 * Body: { pattern }
 */
router.post("/api/cache/invalidate", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { pattern } = req.body;

  if (!pattern) {
    return res.status(400).json({ error: "pattern is required" });
  }

  const invalidated = invalidateCache(pattern);
  res.json({ invalidated, message: `Invalidated ${invalidated} cache entries` });
});

/**
 * POST /api/cache/cleanup
 * Invalidate expired cache entries (admin only).
 */
router.post("/api/cache/cleanup", checkAuthenticated, checkRole("admin"), (req, res) => {
  const invalidated = invalidateExpired();
  res.json({ invalidated, message: `Cleaned up ${invalidated} expired entries` });
});

/**
 * POST /api/cache/clear
 * Clear entire cache (admin only).
 */
router.post("/api/cache/clear", checkAuthenticated, checkRole("admin"), (req, res) => {
  clearCache();
  res.json({ message: "Cache cleared" });
});

/**
 * POST /api/cache/warm
 * Warm cache for popular queries (admin only).
 * Body: { searchFn? } (optional, uses default if not provided)
 */
router.post("/api/cache/warm", checkAuthenticated, checkRole("admin"), async (req, res) => {
  // Default search function that returns empty results
  const defaultSearchFn = async (query) => ({
    query,
    results: [],
    timestamp: Date.now(),
  });

  const searchFn = req.body.searchFn || defaultSearchFn;

  try {
    const result = await warmCache(searchFn);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Cache warming failed" });
  }
});

/**
 * GET /api/cache/check/:key
 * Check if a cache entry exists and is valid.
 */
router.get("/api/cache/check/:key", checkAuthenticated, (req, res) => {
  const cached = getCached(req.params.key);
  res.json({
    key: req.params.key,
    cached: cached !== null,
    data: cached,
  });
});

/**
 * POST /api/cache/set
 * Set a cache entry (for testing/admin).
 * Body: { key, data, ttl? }
 */
router.post("/api/cache/set", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { key, data, ttl, query, engine } = req.body;

  if (!key || !data) {
    return res.status(400).json({ error: "key and data are required" });
  }

  setCache(key, data, { ttl, query, engine });
  res.json({ message: "Cache entry set", key });
});

export default router;
