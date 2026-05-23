// Query expansion routes — expand abbreviations, synonyms, and related terms

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  expandQueryTerms,
  generateAlternatives,
  addCustomRule,
  getCustomRulesList,
  deleteCustomRule,
  getExpansionStats,
} from "../utils/queryExpansion.js";

const router = Router();

/**
 * POST /api/expansion/expand
 * Expand a query with abbreviations, synonyms, and corrections.
 * Body: { query, options? }
 */
router.post("/api/expansion/expand", checkAuthenticated, (req, res) => {
  const { query, options } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "query string is required" });
  }

  const result = expandQueryTerms(query, options);
  res.json(result);
});

/**
 * POST /api/expansion/alternatives
 * Generate alternative queries for broader search.
 * Body: { query, maxAlternatives? }
 */
router.post("/api/expansion/alternatives", checkAuthenticated, (req, res) => {
  const { query, maxAlternatives } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "query string is required" });
  }

  const alternatives = generateAlternatives(query, maxAlternatives);
  res.json({ original: query, alternatives, count: alternatives.length });
});

/**
 * GET /api/expansion/stats
 * Get expansion statistics.
 */
router.get("/api/expansion/stats", checkAuthenticated, (req, res) => {
  const stats = getExpansionStats();
  res.json(stats);
});

/**
 * GET /api/expansion/rules
 * Get custom expansion rules (admin only).
 */
router.get("/api/expansion/rules", checkAuthenticated, checkRole("admin"), (req, res) => {
  const rules = getCustomRulesList();
  res.json({ rules, count: rules.length });
});

/**
 * POST /api/expansion/rules
 * Add custom expansion rule (admin only).
 * Body: { pattern, replacement, type?, flags? }
 */
router.post("/api/expansion/rules", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { pattern, replacement, type, flags } = req.body;

  if (!pattern || !replacement) {
    return res.status(400).json({ error: "pattern and replacement are required" });
  }

  try {
    const rule = addCustomRule({ pattern, replacement, type, flags });
    res.status(201).json({ message: "Rule added", rule });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/expansion/rules/:index
 * Delete custom expansion rule by index (admin only).
 */
router.delete("/api/expansion/rules/:index", checkAuthenticated, checkRole("admin"), (req, res) => {
  const index = parseInt(req.params.index);

  if (isNaN(index)) {
    return res.status(400).json({ error: "Invalid index" });
  }

  const deleted = deleteCustomRule(index);

  if (!deleted) {
    return res.status(404).json({ error: "Rule not found" });
  }

  res.json({ message: "Rule deleted" });
});

export default router;
