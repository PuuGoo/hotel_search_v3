// URL health checker routes — batch verify and monitor URL accessibility

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  checkUrlHealth,
  batchCheckUrls,
  getUrlHealthHistory,
  getHealthStats,
  clearHealthData,
} from "../utils/urlHealthChecker.js";

const router = Router();

/**
 * POST /api/url-health/check
 * Check a single URL's health.
 * Body: { url, timeout? }
 */
router.post("/api/url-health/check", checkAuthenticated, async (req, res) => {
  const { url, timeout } = req.body;

  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  const result = await checkUrlHealth(url, { timeout });
  res.json(result);
});

/**
 * POST /api/url-health/batch
 * Batch check multiple URLs.
 * Body: { urls, concurrency?, timeout? }
 */
router.post("/api/url-health/batch", checkAuthenticated, async (req, res) => {
  const { urls, concurrency, timeout } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "urls array is required" });
  }

  const results = await batchCheckUrls(urls, { concurrency, timeout });
  const healthy = results.filter((r) => r.healthy).length;

  res.json({
    results,
    stats: {
      total: results.length,
      healthy,
      unhealthy: results.length - healthy,
      healthRate: Math.round((healthy / results.length) * 100),
    },
  });
});

/**
 * GET /api/url-health/history
 * Get health history for a URL.
 * Query: url
 */
router.get("/api/url-health/history", checkAuthenticated, (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "url query param is required" });

  const history = getUrlHealthHistory(url);
  if (!history) return res.status(404).json({ error: "No health data for this URL" });

  res.json(history);
});

/**
 * GET /api/url-health/stats
 * Get overall health statistics (admin only).
 */
router.get("/api/url-health/stats", checkAuthenticated, checkRole("admin"), (req, res) => {
  const stats = getHealthStats();
  res.json(stats);
});

/**
 * DELETE /api/url-health/clear
 * Clear health data (admin only).
 */
router.delete("/api/url-health/clear", checkAuthenticated, checkRole("admin"), (req, res) => {
  clearHealthData();
  res.json({ message: "Health data cleared" });
});

export default router;
