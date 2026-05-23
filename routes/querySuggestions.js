// Query suggestion routes — autocomplete and query expansion

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import { getSuggestions, expandQuery, getTrendingQueries } from "../utils/querySuggestions.js";

const router = Router();

/**
 * GET /api/suggestions/autocomplete?q=prefix
 * Get autocomplete suggestions for a partial query.
 */
router.get("/api/suggestions/autocomplete", checkAuthenticated, (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 2) {
    return res.json({ suggestions: [] });
  }

  const limit = parseInt(req.query.limit) || 10;
  const suggestions = getSuggestions(q, req.session.user.id, { limit });
  res.json({ suggestions, query: q });
});

/**
 * POST /api/suggestions/expand
 * Expand a query with abbreviations and synonyms.
 * Body: { query }
 */
router.post("/api/suggestions/expand", checkAuthenticated, (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  const expanded = expandQuery(query);
  res.json({ original: query, expanded, changed: expanded !== query.toLowerCase() });
});

/**
 * GET /api/suggestions/trending
 * Get trending search queries.
 */
router.get("/api/suggestions/trending", checkAuthenticated, (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const limit = parseInt(req.query.limit) || 10;
  const trending = getTrendingQueries(hours, limit);
  res.json({ trending, period: `${hours} hours` });
});

export default router;
