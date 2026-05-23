// Integration test suite routes — end-to-end API testing utilities

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  createSuite,
  getSuites,
  getSuite,
  updateSuite,
  deleteSuite,
  runSuite,
  getResults,
  getTestStats,
  clearTestData,
} from "../utils/integrationTests.js";

const router = Router();

/**
 * POST /api/test/suites
 * Create a test suite (admin only).
 */
router.post("/api/test/suites", checkAuthenticated, checkRole("admin"), (req, res) => {
  const suite = createSuite({
    ...req.body,
    userId: req.session.user?.id,
  });
  if (suite.error) {
    return res.status(400).json({ error: suite.error, code: 400 });
  }
  res.status(201).json(suite);
});

/**
 * GET /api/test/suites
 * Get all test suites (admin only).
 */
router.get("/api/test/suites", checkAuthenticated, checkRole("admin"), (req, res) => {
  const enabled = req.query.enabled !== undefined ? req.query.enabled === "true" : null;
  const suites = getSuites({ enabled });
  res.json({ suites, count: suites.length });
});

/**
 * GET /api/test/stats
 * Get testing statistics (admin only).
 */
router.get("/api/test/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getTestStats();
  res.json(stats);
});

/**
 * POST /api/test/suites/:id/run
 * Run a test suite (admin only).
 */
router.post("/api/test/suites/:id/run", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = runSuite(req.params.id, { baseUrl: req.body?.baseUrl });
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  res.status(201).json(result);
});

/**
 * GET /api/test/results
 * Get test results (admin only).
 */
router.get("/api/test/results", checkAuthenticated, checkRole("admin"), (req, res) => {
  const suiteId = req.query.suiteId || null;
  const limit = parseInt(req.query.limit) || 50;
  const results = getResults({ suiteId, limit });
  res.json(results);
});

/**
 * GET /api/test/suites/:id
 * Get a specific suite (admin only).
 */
router.get("/api/test/suites/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const suite = getSuite(req.params.id);
  if (!suite) {
    return res.status(404).json({ error: "Suite not found", code: 404 });
  }
  res.json(suite);
});

/**
 * PUT /api/test/suites/:id
 * Update a suite (admin only).
 */
router.put("/api/test/suites/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const suite = updateSuite(req.params.id, req.body);
  if (!suite) {
    return res.status(404).json({ error: "Suite not found", code: 404 });
  }
  res.json(suite);
});

/**
 * DELETE /api/test/suites/:id
 * Delete a suite (admin only).
 */
router.delete("/api/test/suites/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteSuite(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Suite not found", code: 404 });
  }
  res.json({ message: "Suite deleted" });
});

/**
 * DELETE /api/test/clear
 * Clear test data (admin only).
 */
router.delete("/api/test/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearTestData();
  res.json({ message: "Test data cleared" });
});

export default router;
