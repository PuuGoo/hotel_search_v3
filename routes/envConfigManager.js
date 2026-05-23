// Environment config manager routes

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  defineEnvironment,
  getEnvironments,
  getEnvironment,
  updateEnvironment,
  deleteEnvironment,
  validateEnvironment,
  compareEnvironments,
  getConfigHistory,
  getConfigStats,
  clearConfigData,
} from "../utils/envConfigManager.js";

const router = Router();

/**
 * POST /api/env-configs
 * Define an environment configuration (admin only).
 */
router.post("/api/env-configs", checkAuthenticated, checkRole("admin"), (req, res) => {
  const env = defineEnvironment({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(env);
});

/**
 * GET /api/env-configs
 * Get all environments.
 */
router.get("/api/env-configs", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const environments = getEnvironments();
  res.json({ environments, count: environments.length });
});

/**
 * GET /api/env-configs/stats
 * Get config statistics.
 */
router.get("/api/env-configs/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getConfigStats();
  res.json(stats);
});

/**
 * GET /api/env-configs/history
 * Get config history.
 */
router.get("/api/env-configs/history", checkAuthenticated, checkRole("admin"), (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 50;
  const history = getConfigHistory(limit);
  res.json({ history, count: history.length });
});

/**
 * POST /api/env-configs/compare
 * Compare two environments.
 */
router.post("/api/env-configs/compare", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { env1, env2 } = req.body;
  if (!env1 || !env2) {
    return res.status(400).json({ error: "env1 and env2 are required", code: 400 });
  }
  const result = compareEnvironments(env1, env2);
  if (result.error) {
    return res.status(404).json({ error: result.error, code: 404 });
  }
  res.json(result);
});

/**
 * POST /api/env-configs/:name/validate
 * Validate an environment.
 */
router.post("/api/env-configs/:name/validate", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = validateEnvironment(req.params.name);
  if (result.error) {
    return res.status(404).json({ error: result.error, code: 404 });
  }
  res.json(result);
});

/**
 * DELETE /api/env-configs/clear
 * Clear config data (admin only).
 */
router.delete("/api/env-configs/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearConfigData();
  res.json({ message: "Config data cleared" });
});

/**
 * GET /api/env-configs/:name
 * Get a specific environment.
 */
router.get("/api/env-configs/:name", checkAuthenticated, checkRole("admin"), (req, res) => {
  const env = getEnvironment(req.params.name);
  if (!env) {
    return res.status(404).json({ error: "Environment not found", code: 404 });
  }
  res.json(env);
});

/**
 * PUT /api/env-configs/:name
 * Update an environment (admin only).
 */
router.put("/api/env-configs/:name", checkAuthenticated, checkRole("admin"), (req, res) => {
  const env = updateEnvironment(req.params.name, {
    ...req.body,
    userId: req.session.user?.id,
  });
  if (!env) {
    return res.status(404).json({ error: "Environment not found", code: 404 });
  }
  res.json(env);
});

/**
 * DELETE /api/env-configs/:name
 * Delete an environment (admin only).
 */
router.delete("/api/env-configs/:name", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteEnvironment(req.params.name);
  if (!deleted) {
    return res.status(404).json({ error: "Environment not found", code: 404 });
  }
  res.json({ message: "Environment deleted" });
});

export default router;
