// Load testing routes — simulate concurrent users and measure throughput

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  createConfig,
  getConfigs,
  getConfig,
  deleteConfig,
  runLoadTest,
  getResults,
  getLoadTestStats,
  clearLoadTestData,
} from "../utils/loadTesting.js";

const router = Router();

/**
 * POST /api/load-test/configs
 * Create a load test config (admin only).
 */
router.post("/api/load-test/configs", checkAuthenticated, checkRole("admin"), (req, res) => {
  const config = createConfig({
    ...req.body,
    userId: req.session.user?.id,
  });
  if (config.error) {
    return res.status(400).json({ error: config.error, code: 400 });
  }
  res.status(201).json(config);
});

/**
 * GET /api/load-test/configs
 * Get all configs (admin only).
 */
router.get("/api/load-test/configs", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const configs = getConfigs();
  res.json({ configs, count: configs.length });
});

/**
 * GET /api/load-test/stats
 * Get load testing statistics (admin only).
 */
router.get("/api/load-test/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getLoadTestStats();
  res.json(stats);
});

/**
 * POST /api/load-test/run/:id
 * Run a load test (admin only).
 */
router.post("/api/load-test/run/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = runLoadTest(req.params.id);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  res.status(201).json(result);
});

/**
 * GET /api/load-test/results
 * Get load test results (admin only).
 */
router.get("/api/load-test/results", checkAuthenticated, checkRole("admin"), (req, res) => {
  const configId = req.query.configId || null;
  const limit = parseInt(req.query.limit) || 50;
  const results = getResults({ configId, limit });
  res.json(results);
});

/**
 * GET /api/load-test/configs/:id
 * Get a specific config (admin only).
 */
router.get("/api/load-test/configs/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const config = getConfig(req.params.id);
  if (!config) {
    return res.status(404).json({ error: "Config not found", code: 404 });
  }
  res.json(config);
});

/**
 * DELETE /api/load-test/configs/:id
 * Delete a config (admin only).
 */
router.delete("/api/load-test/configs/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteConfig(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Config not found", code: 404 });
  }
  res.json({ message: "Config deleted" });
});

/**
 * DELETE /api/load-test/clear
 * Clear load test data (admin only).
 */
router.delete("/api/load-test/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearLoadTestData();
  res.json({ message: "Load test data cleared" });
});

export default router;
