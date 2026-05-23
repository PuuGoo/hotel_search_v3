// Developer tools routes — pipeline trace, health history, adaptive rate limit status

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import { getTrace, getRecentTraces, getTraceStats, clearTraces } from "../middleware/pipelineTrace.js";
import { getHealthHistory, getCurrentStatus } from "../utils/healthHistory.js";
import { getAdaptiveStatus } from "../middleware/adaptiveRateLimit.js";

const router = Router();

/**
 * GET /api/dev/trace/:id
 * Get a specific pipeline trace.
 */
router.get("/api/dev/trace/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const trace = getTrace(req.params.id);
  if (!trace) return res.status(404).json({ error: "Trace not found" });
  res.json(trace);
});

/**
 * GET /api/dev/traces
 * Get recent pipeline traces.
 */
router.get("/api/dev/traces", checkAuthenticated, checkRole("admin"), (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const traces = getRecentTraces(limit);
  const stats = getTraceStats();
  res.json({ traces, stats });
});

/**
 * DELETE /api/dev/traces
 * Clear all traces.
 */
router.delete("/api/dev/traces", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearTraces();
  res.json({ success: true });
});

/**
 * GET /api/dev/health-history
 * Get health check history.
 */
router.get("/api/dev/health-history", checkAuthenticated, checkRole("admin"), (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const history = getHealthHistory(hours);
  res.json(history);
});

/**
 * GET /api/dev/health-status
 * Get current health status.
 */
router.get("/api/dev/health-status", checkAuthenticated, (req, res) => {
  const status = getCurrentStatus();
  res.json(status);
});

/**
 * GET /api/dev/rate-limit-status
 * Get adaptive rate limit status.
 */
router.get("/api/dev/rate-limit-status", checkAuthenticated, checkRole("admin"), (req, res) => {
  const status = getAdaptiveStatus();
  res.json(status);
});

export default router;
