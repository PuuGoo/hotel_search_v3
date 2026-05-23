// Smart defaults routes — get engine recommendations

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import { getRecommendedEngine, getSmartDefaults, classifyQuery } from "../utils/smartDefaults.js";

const router = Router();

/**
 * GET /api/smart-defaults?q=query
 * Get smart defaults for a search query.
 */
router.get("/api/smart-defaults", checkAuthenticated, (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) {
    return res.status(400).json({ error: "q parameter is required" });
  }

  const defaults = getSmartDefaults(q, req.session.user.id);
  res.json(defaults);
});

/**
 * POST /api/smart-defaults/recommend
 * Get engine recommendation for a query.
 * Body: { query }
 */
router.post("/api/smart-defaults/recommend", checkAuthenticated, (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  const recommendation = getRecommendedEngine(query, req.session.user.id);
  res.json(recommendation);
});

/**
 * POST /api/smart-defaults/classify
 * Classify a query type.
 * Body: { query }
 */
router.post("/api/smart-defaults/classify", checkAuthenticated, (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  const queryType = classifyQuery(query);
  res.json({ query, queryType });
});

export default router;
