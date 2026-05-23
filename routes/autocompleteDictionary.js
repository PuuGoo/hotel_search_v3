// Auto-complete dictionary routes — serve suggestions from search history

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  rebuildDictionary,
  getSuggestions,
  addTerm,
  removeTerm,
  getDictionaryStats,
  clearDictionary,
} from "../utils/autocompleteDictionary.js";

const router = Router();

/**
 * GET /api/autocomplete/suggest
 * Get autocomplete suggestions for a prefix.
 * Query: q, limit
 */
router.get("/api/autocomplete/suggest", checkAuthenticated, (req, res) => {
  const q = req.query.q || "";
  const limit = parseInt(req.query.limit) || 10;
  const suggestions = getSuggestions(q, { limit });
  res.json({ query: q, suggestions, count: suggestions.length });
});

/**
 * POST /api/autocomplete/rebuild
 * Rebuild the dictionary from search history (admin only).
 * Body: { minOccurrences?, includePhrases?, maxPhraseLength? }
 */
router.post("/api/autocomplete/rebuild", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = rebuildDictionary(req.body);
  res.json(result);
});

/**
 * POST /api/autocomplete/term
 * Add a term to the dictionary (admin only).
 * Body: { term, count? }
 */
router.post("/api/autocomplete/term", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { term, count } = req.body;
  if (!term) return res.status(400).json({ error: "term is required" });

  const result = addTerm(term, count);
  res.status(201).json(result);
});

/**
 * DELETE /api/autocomplete/term/:term
 * Remove a term from the dictionary (admin only).
 */
router.delete("/api/autocomplete/term/:term", checkAuthenticated, checkRole("admin"), (req, res) => {
  const removed = removeTerm(req.params.term);
  if (!removed) return res.status(404).json({ error: "Term not found" });
  res.json({ message: "Term removed" });
});

/**
 * GET /api/autocomplete/stats
 * Get dictionary statistics (admin only).
 */
router.get("/api/autocomplete/stats", checkAuthenticated, checkRole("admin"), (req, res) => {
  const stats = getDictionaryStats();
  res.json(stats);
});

/**
 * DELETE /api/autocomplete/clear
 * Clear the dictionary (admin only).
 */
router.delete("/api/autocomplete/clear", checkAuthenticated, checkRole("admin"), (req, res) => {
  clearDictionary();
  res.json({ message: "Dictionary cleared" });
});

export default router;
