// Data quality routes — validate data quality at each pipeline stage

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  createCheck,
  getChecks,
  getCheck,
  updateCheck,
  deleteCheck,
  runCheck,
  runAllChecks,
  getResults,
  getQualityStats,
  clearQualityData,
} from "../utils/dataQuality.js";

const router = Router();

/**
 * POST /api/quality/checks
 * Create a quality check (admin only).
 */
router.post("/api/quality/checks", checkAuthenticated, checkRole("admin"), (req, res) => {
  const check = createCheck({
    ...req.body,
    userId: req.session.user?.id,
  });
  if (check.error) {
    return res.status(400).json({ error: check.error, code: 400 });
  }
  res.status(201).json(check);
});

/**
 * GET /api/quality/checks
 * Get all quality checks (admin only).
 */
router.get("/api/quality/checks", checkAuthenticated, checkRole("admin"), (req, res) => {
  const enabled = req.query.enabled !== undefined ? req.query.enabled === "true" : null;
  const checks = getChecks({ enabled });
  res.json({ checks, count: checks.length });
});

/**
 * GET /api/quality/stats
 * Get quality statistics (admin only).
 */
router.get("/api/quality/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getQualityStats();
  res.json(stats);
});

/**
 * POST /api/quality/checks/:id/run
 * Run a quality check (admin only).
 */
router.post("/api/quality/checks/:id/run", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { records } = req.body;
  const result = runCheck(req.params.id, records);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  res.status(201).json(result);
});

/**
 * POST /api/quality/run-all
 * Run all quality checks (admin only).
 */
router.post("/api/quality/run-all", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: "Records must be an array", code: 400 });
  }
  const results = runAllChecks(records);
  res.json(results);
});

/**
 * GET /api/quality/results
 * Get check results (admin only).
 */
router.get("/api/quality/results", checkAuthenticated, checkRole("admin"), (req, res) => {
  const checkId = req.query.checkId || null;
  const limit = parseInt(req.query.limit) || 50;
  const results = getResults({ checkId, limit });
  res.json(results);
});

/**
 * GET /api/quality/checks/:id
 * Get a specific check (admin only).
 */
router.get("/api/quality/checks/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const check = getCheck(req.params.id);
  if (!check) {
    return res.status(404).json({ error: "Check not found", code: 404 });
  }
  res.json(check);
});

/**
 * PUT /api/quality/checks/:id
 * Update a check (admin only).
 */
router.put("/api/quality/checks/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const check = updateCheck(req.params.id, req.body);
  if (!check) {
    return res.status(404).json({ error: "Check not found", code: 404 });
  }
  res.json(check);
});

/**
 * DELETE /api/quality/checks/:id
 * Delete a check (admin only).
 */
router.delete("/api/quality/checks/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteCheck(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Check not found", code: 404 });
  }
  res.json({ message: "Check deleted" });
});

/**
 * DELETE /api/quality/clear
 * Clear quality data (admin only).
 */
router.delete("/api/quality/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearQualityData();
  res.json({ message: "Quality data cleared" });
});

export default router;
