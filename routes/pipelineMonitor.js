// Pipeline monitoring routes — track pipeline execution status and history

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  recordMetric,
  getMetrics,
  getPipelineStatuses,
  getPipelineStatus,
  getAlerts,
  acknowledgeAlert,
  getMonitorStats,
  clearMonitorData,
} from "../utils/pipelineMonitor.js";

const router = Router();

/**
 * POST /api/pipeline-monitor/metrics
 * Record a pipeline execution metric (admin only).
 */
router.post("/api/pipeline-monitor/metrics", checkAuthenticated, checkRole("admin"), (req, res) => {
  const metric = recordMetric(req.body);
  res.status(201).json(metric);
});

/**
 * GET /api/pipeline-monitor/metrics
 * Get pipeline metrics (admin only).
 * Query: pipelineId, limit
 */
router.get("/api/pipeline-monitor/metrics", checkAuthenticated, checkRole("admin"), (req, res) => {
  const pipelineId = req.query.pipelineId || null;
  const limit = parseInt(req.query.limit) || 50;
  const metrics = getMetrics(pipelineId, limit);
  res.json(metrics);
});

/**
 * GET /api/pipeline-monitor/status
 * Get all pipeline statuses (admin only).
 */
router.get("/api/pipeline-monitor/status", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const statuses = getPipelineStatuses();
  res.json({ statuses, count: statuses.length });
});

/**
 * GET /api/pipeline-monitor/stats
 * Get monitoring statistics (admin only).
 */
router.get("/api/pipeline-monitor/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getMonitorStats();
  res.json(stats);
});

/**
 * GET /api/pipeline-monitor/alerts
 * Get alerts (admin only).
 * Query: acknowledged, severity, limit
 */
router.get("/api/pipeline-monitor/alerts", checkAuthenticated, checkRole("admin"), (req, res) => {
  const acknowledged = req.query.acknowledged !== undefined ? req.query.acknowledged === "true" : null;
  const severity = req.query.severity || null;
  const limit = parseInt(req.query.limit) || 50;
  const alerts = getAlerts({ acknowledged, severity, limit });
  res.json(alerts);
});

/**
 * PUT /api/pipeline-monitor/alerts/:id/acknowledge
 * Acknowledge an alert (admin only).
 */
router.put("/api/pipeline-monitor/alerts/:id/acknowledge", checkAuthenticated, checkRole("admin"), (req, res) => {
  const alert = acknowledgeAlert(req.params.id);
  if (!alert) {
    return res.status(404).json({ error: "Alert not found", code: 404 });
  }
  res.json(alert);
});

/**
 * GET /api/pipeline-monitor/status/:id
 * Get status for a specific pipeline (admin only).
 */
router.get("/api/pipeline-monitor/status/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const status = getPipelineStatus(req.params.id);
  if (!status) {
    return res.status(404).json({ error: "Pipeline not found", code: 404 });
  }
  res.json(status);
});

/**
 * DELETE /api/pipeline-monitor/clear
 * Clear monitoring data (admin only).
 */
router.delete("/api/pipeline-monitor/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearMonitorData();
  res.json({ message: "Pipeline monitor data cleared" });
});

export default router;
