// Endpoint deprecation manager routes

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  addDeprecation,
  getDeprecations,
  getDeprecation,
  updateDeprecation,
  deleteDeprecation,
  checkEndpoint,
  getDeprecationStats,
  processSunsets,
  clearDeprecationData,
} from "../utils/endpointDeprecation.js";

const router = Router();

/**
 * POST /api/deprecations
 * Register an endpoint as deprecated (admin only).
 */
router.post("/api/deprecations", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deprecation = addDeprecation({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(deprecation);
});

/**
 * GET /api/deprecations
 * Get all deprecations with optional filters.
 */
router.get("/api/deprecations", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { status, limit } = req.query;
  const result = getDeprecations({
    status: status || null,
    limit: limit ? parseInt(limit) : 50,
  });
  res.json(result);
});

/**
 * GET /api/deprecations/stats
 * Get deprecation statistics.
 */
router.get("/api/deprecations/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getDeprecationStats();
  res.json(stats);
});

/**
 * POST /api/deprecations/process-sunsets
 * Process sunset — move past-sunset deprecations to sunset status.
 */
router.post("/api/deprecations/process-sunsets", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const result = processSunsets();
  res.json(result);
});

/**
 * POST /api/deprecations/check
 * Check if an endpoint is deprecated.
 */
router.post("/api/deprecations/check", checkAuthenticated, (req, res) => {
  const { method, path: pathStr } = req.body;
  if (!method || !pathStr) {
    return res.status(400).json({ error: "method and path are required", code: 400 });
  }
  const result = checkEndpoint(method, pathStr);
  if (!result) {
    return res.json({ deprecated: false });
  }
  res.json(result);
});

/**
 * DELETE /api/deprecations/clear
 * Clear all deprecation data (admin only).
 */
router.delete("/api/deprecations/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearDeprecationData();
  res.json({ message: "Deprecation data cleared" });
});

/**
 * GET /api/deprecations/:id
 * Get a specific deprecation.
 */
router.get("/api/deprecations/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deprecation = getDeprecation(req.params.id);
  if (!deprecation) {
    return res.status(404).json({ error: "Deprecation not found", code: 404 });
  }
  res.json(deprecation);
});

/**
 * PUT /api/deprecations/:id
 * Update a deprecation (admin only).
 */
router.put("/api/deprecations/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deprecation = updateDeprecation(req.params.id, req.body);
  if (!deprecation) {
    return res.status(404).json({ error: "Deprecation not found", code: 404 });
  }
  res.json(deprecation);
});

/**
 * DELETE /api/deprecations/:id
 * Delete a deprecation (admin only).
 */
router.delete("/api/deprecations/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteDeprecation(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Deprecation not found", code: 404 });
  }
  res.json({ message: "Deprecation deleted" });
});

export default router;
