// Comparison export routes — export comparison data as CSV

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import {
  exportComparisonCSV,
  exportBulkComparisonCSV,
  exportComparisonSummary,
  exportBookmarkComparisonCSV,
} from "../utils/comparisonExport.js";

const router = Router();

/**
 * POST /api/export/comparison/csv
 * Export a single comparison as CSV.
 * Body: { comparison, includeMetadata?, delimiter? }
 */
router.post("/api/export/comparison/csv", checkAuthenticated, (req, res) => {
  const { comparison, includeMetadata, delimiter } = req.body;

  if (!comparison || !comparison.results) {
    return res.status(400).json({ error: "comparison with results is required" });
  }

  const csv = exportComparisonCSV(comparison, { includeMetadata, delimiter });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="comparison-${Date.now()}.csv"`);
  res.send(csv);
});

/**
 * POST /api/export/comparisons/csv
 * Export multiple comparisons as CSV.
 * Body: { comparisons, delimiter? }
 */
router.post("/api/export/comparisons/csv", checkAuthenticated, (req, res) => {
  const { comparisons, delimiter } = req.body;

  if (!Array.isArray(comparisons)) {
    return res.status(400).json({ error: "comparisons array is required" });
  }

  const csv = exportBulkComparisonCSV(comparisons, { delimiter });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="comparisons-${Date.now()}.csv"`);
  res.send(csv);
});

/**
 * POST /api/export/comparison/summary
 * Export comparison summary as CSV.
 * Body: { comparison, delimiter? }
 */
router.post("/api/export/comparison/summary", checkAuthenticated, (req, res) => {
  const { comparison, delimiter } = req.body;

  if (!comparison || !comparison.results) {
    return res.status(400).json({ error: "comparison with results is required" });
  }

  const csv = exportComparisonSummary(comparison, { delimiter });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="summary-${Date.now()}.csv"`);
  res.send(csv);
});

/**
 * POST /api/export/bookmarks/csv
 * Export bookmarks comparison as CSV.
 * Body: { bookmarks, delimiter? }
 */
router.post("/api/export/bookmarks/csv", checkAuthenticated, (req, res) => {
  const { bookmarks, delimiter } = req.body;

  if (!Array.isArray(bookmarks)) {
    return res.status(400).json({ error: "bookmarks array is required" });
  }

  const csv = exportBookmarkComparisonCSV(bookmarks, { delimiter });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="bookmarks-${Date.now()}.csv"`);
  res.send(csv);
});

export default router;
