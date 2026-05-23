import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";

const router = Router();

function escapeCsvField(field) {
  if (field === null || field === undefined) return "";
  const str = String(field);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Export results as CSV
router.post("/api/export/csv", checkAuthenticated, (req, res) => {
  const { results, filename } = req.body;

  if (!Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: "results must be a non-empty array" });
  }

  const headers = ["title", "url", "snippet", "engine", "score", "price", "rating"];
  const csv = [
    headers.join(","),
    ...results.map((r) =>
      headers.map((h) => escapeCsvField(r[h])).join(",")
    ),
  ].join("\n");

  const fname = filename || `search-results-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send("﻿" + csv); // BOM for Excel UTF-8
});

// Export results as JSON
router.post("/api/export/json", checkAuthenticated, (req, res) => {
  const { results, filename } = req.body;

  if (!Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: "results must be a non-empty array" });
  }

  const exportData = {
    exportedAt: new Date().toISOString(),
    count: results.length,
    results,
  };

  const fname = filename || `search-results-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.json(exportData);
});

export default router;
