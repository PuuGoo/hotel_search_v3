// Result validation routes — verify URL accessibility

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  validateUrl,
  validateUrls,
  validateSearchResults,
  getValidationStats,
  clearValidationCache,
} from "../utils/resultValidation.js";

const router = Router();

/**
 * POST /api/validation/url
 * Validate a single URL.
 * Body: { url, timeout?, forceRefresh? }
 */
router.post("/api/validation/url", checkAuthenticated, async (req, res) => {
  const { url, timeout, forceRefresh } = req.body;

  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: "Invalid URL format" });
  }

  try {
    const result = await validateUrl(url, { timeout, forceRefresh });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Validation failed" });
  }
});

/**
 * POST /api/validation/urls
 * Validate multiple URLs.
 * Body: { urls[], timeout?, concurrency? }
 */
router.post("/api/validation/urls", checkAuthenticated, async (req, res) => {
  const { urls, timeout, concurrency } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "urls array is required" });
  }

  if (urls.length > 50) {
    return res.status(400).json({ error: "Maximum 50 URLs per batch" });
  }

  // Validate URL format
  for (const url of urls) {
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: `Invalid URL format: ${url}` });
    }
  }

  try {
    const results = await validateUrls(urls, { timeout, concurrency });
    const accessible = results.filter((r) => r.accessible).length;
    res.json({ results, summary: { total: urls.length, accessible, inaccessible: urls.length - accessible } });
  } catch (err) {
    res.status(500).json({ error: "Validation failed" });
  }
});

/**
 * POST /api/validation/results
 * Validate search results — add accessibility info.
 * Body: { results[], timeout? }
 */
router.post("/api/validation/results", checkAuthenticated, async (req, res) => {
  const { results, timeout } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results array is required" });
  }

  try {
    const validated = await validateSearchResults(results, { timeout });
    const withUrl = validated.filter((r) => r.url);
    const accessible = withUrl.filter((r) => r.validation?.accessible).length;
    res.json({
      results: validated,
      summary: {
        total: withUrl.length,
        accessible,
        inaccessible: withUrl.length - accessible,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Validation failed" });
  }
});

/**
 * GET /api/validation/stats
 * Get validation cache statistics (admin only).
 */
router.get("/api/validation/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getValidationStats();
  res.json(stats);
});

/**
 * DELETE /api/validation/cache
 * Clear validation cache (admin only).
 */
router.delete("/api/validation/cache", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearValidationCache();
  res.json({ message: "Validation cache cleared" });
});

export default router;
