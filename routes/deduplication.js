import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import { deduplicateResults } from "../utils/deduplication.js";

const router = Router();

/**
 * POST /api/deduplicate
 * Deduplicates an array of results
 * Body: { results: [...], threshold?: number }
 * Returns: { deduplicated: [], duplicates: number, groups: number }
 */
router.post("/api/deduplicate", checkAuthenticated, (req, res) => {
  const { results, threshold } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results must be an array" });
  }

  if (threshold !== undefined && (typeof threshold !== "number" || threshold < 0 || threshold > 1)) {
    return res.status(400).json({ error: "threshold must be a number between 0 and 1" });
  }

  const deduplicated = deduplicateResults(results, threshold);
  res.json(deduplicated);
});

export default router;
