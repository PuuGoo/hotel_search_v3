// API versioning dashboard routes

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  registerVersion,
  getVersions,
  getVersion,
  updateVersion,
  deleteVersion,
  recordVersionUsage,
  getVersionUsage,
  getUsageBreakdown,
  getVersioningStats,
  processSunsets,
  clearVersioningData,
} from "../utils/apiVersioningDashboard.js";

const router = Router();

/**
 * POST /api/versions
 * Register an API version (admin only).
 */
router.post("/api/versions", checkAuthenticated, checkRole("admin"), (req, res) => {
  const version = registerVersion({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(version);
});

/**
 * GET /api/versions
 * Get all versions with optional status filter.
 */
router.get("/api/versions", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { status } = req.query;
  const result = getVersions({ status: status || null });
  res.json(result);
});

/**
 * GET /api/versions/stats
 * Get versioning statistics.
 */
router.get("/api/versions/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getVersioningStats();
  res.json(stats);
});

/**
 * GET /api/versions/breakdown
 * Get usage breakdown by version.
 */
router.get("/api/versions/breakdown", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const breakdown = getUsageBreakdown();
  res.json({ breakdown, count: breakdown.length });
});

/**
 * POST /api/versions/usage
 * Record version usage (admin only).
 */
router.post("/api/versions/usage", checkAuthenticated, checkRole("admin"), (req, res) => {
  const record = recordVersionUsage(req.body);
  res.status(201).json(record);
});

/**
 * GET /api/versions/usage
 * Get version usage records.
 */
router.get("/api/versions/usage", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { version, limit } = req.query;
  const result = getVersionUsage({
    version: version || null,
    limit: limit ? parseInt(limit) : 50,
  });
  res.json(result);
});

/**
 * POST /api/versions/process-sunsets
 * Process sunset versions (admin only).
 */
router.post("/api/versions/process-sunsets", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const result = processSunsets();
  res.json(result);
});

/**
 * DELETE /api/versions/clear
 * Clear versioning data (admin only).
 */
router.delete("/api/versions/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearVersioningData();
  res.json({ message: "Versioning data cleared" });
});

/**
 * GET /api/versions/:id
 * Get a specific version.
 */
router.get("/api/versions/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const version = getVersion(req.params.id);
  if (!version) {
    return res.status(404).json({ error: "Version not found", code: 404 });
  }
  res.json(version);
});

/**
 * PUT /api/versions/:id
 * Update a version (admin only).
 */
router.put("/api/versions/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const version = updateVersion(req.params.id, req.body);
  if (!version) {
    return res.status(404).json({ error: "Version not found", code: 404 });
  }
  res.json(version);
});

/**
 * DELETE /api/versions/:id
 * Delete a version (admin only).
 */
router.delete("/api/versions/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteVersion(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Version not found", code: 404 });
  }
  res.json({ message: "Version deleted" });
});

export default router;
