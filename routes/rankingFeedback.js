// Ranking feedback routes — track clicks and improve result ranking

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  recordClick,
  getRankingBoosts,
  rerankResults,
  getClickStats,
  getUrlClickHistory,
  clearRankingFeedback,
} from "../utils/rankingFeedback.js";

const router = Router();

/**
 * POST /api/ranking/click
 * Record a click on a search result.
 * Body: { query, url, title, engine, position }
 */
router.post("/api/ranking/click", checkAuthenticated, (req, res) => {
  const { query, url, title, engine, position } = req.body;

  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  const click = recordClick({
    userId: req.session.user?.id,
    query,
    url,
    title,
    engine,
    position,
  });

  res.status(201).json(click);
});

/**
 * POST /api/ranking/boosts
 * Get ranking boost factors for a set of URLs.
 * Body: { urls, query? }
 */
router.post("/api/ranking/boosts", checkAuthenticated, (req, res) => {
  const { urls, query } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "urls array is required" });
  }

  const boosts = getRankingBoosts(urls, { query });
  res.json({ boosts });
});

/**
 * POST /api/ranking/rerank
 * Re-rank results using click feedback.
 * Body: { results, query?, boostWeight? }
 */
router.post("/api/ranking/rerank", checkAuthenticated, (req, res) => {
  const { results, query, boostWeight } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results array is required" });
  }

  const reranked = rerankResults(results, { query, boostWeight });
  res.json({ results: reranked, count: reranked.length });
});

/**
 * GET /api/ranking/stats
 * Get click statistics (admin only).
 * Query: hours
 */
router.get("/api/ranking/stats", checkAuthenticated, checkRole("admin"), (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const stats = getClickStats({ hours });
  res.json(stats);
});

/**
 * GET /api/ranking/url/:encodedUrl
 * Get click history for a specific URL.
 */
router.get("/api/ranking/url/:encodedUrl", checkAuthenticated, (req, res) => {
  const url = decodeURIComponent(req.params.encodedUrl);
  const history = getUrlClickHistory(url);
  res.json({ url, clicks: history, count: history.length });
});

/**
 * DELETE /api/ranking/clear
 * Clear all ranking feedback data (admin only).
 */
router.delete("/api/ranking/clear", checkAuthenticated, checkRole("admin"), (req, res) => {
  clearRankingFeedback();
  res.json({ message: "Ranking feedback data cleared" });
});

export default router;
