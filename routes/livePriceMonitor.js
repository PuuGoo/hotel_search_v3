// Live price monitoring routes — manage price monitors and alerts

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  createMonitor,
  getMonitors,
  getMonitor,
  updateMonitor,
  deleteMonitor,
  recordPriceCheck,
  getPriceHistory,
  getAlerts,
  getMonitorStats,
  clearMonitorData,
} from "../utils/livePriceMonitor.js";

const router = Router();

/**
 * POST /api/price-monitor/monitors
 * Create a price monitor.
 * Body: { hotelName, location, targetPrice, alertOnIncrease, alertOnDecrease, thresholdPercent }
 */
router.post("/api/price-monitor/monitors", checkAuthenticated, (req, res) => {
  const monitor = createMonitor({
    ...req.body,
    userId: req.session.user?.id,
  });
  if (monitor.error) {
    return res.status(400).json({ error: monitor.error, code: 400 });
  }
  res.status(201).json(monitor);
});

/**
 * GET /api/price-monitor/monitors
 * Get all monitors for current user.
 * Query: enabled
 */
router.get("/api/price-monitor/monitors", checkAuthenticated, (req, res) => {
  const enabled = req.query.enabled !== undefined ? req.query.enabled === "true" : undefined;
  const monitors = getMonitors(req.session.user?.id, { enabled });
  res.json({ monitors, count: monitors.length });
});

/**
 * GET /api/price-monitor/monitors/:id
 * Get a specific monitor.
 */
router.get("/api/price-monitor/monitors/:id", checkAuthenticated, (req, res) => {
  const monitor = getMonitor(req.params.id);
  if (!monitor) {
    return res.status(404).json({ error: "Monitor not found", code: 404 });
  }
  res.json(monitor);
});

/**
 * PUT /api/price-monitor/monitors/:id
 * Update a monitor.
 */
router.put("/api/price-monitor/monitors/:id", checkAuthenticated, (req, res) => {
  const monitor = updateMonitor(req.params.id, req.body);
  if (!monitor) {
    return res.status(404).json({ error: "Monitor not found", code: 404 });
  }
  res.json(monitor);
});

/**
 * DELETE /api/price-monitor/monitors/:id
 * Delete a monitor.
 */
router.delete("/api/price-monitor/monitors/:id", checkAuthenticated, (req, res) => {
  const deleted = deleteMonitor(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Monitor not found", code: 404 });
  }
  res.json({ message: "Monitor deleted" });
});

/**
 * POST /api/price-monitor/monitors/:id/check
 * Record a price check for a monitor.
 * Body: { price, source }
 */
router.post("/api/price-monitor/monitors/:id/check", checkAuthenticated, (req, res) => {
  const result = recordPriceCheck(req.params.id, req.body.price, req.body.source);
  if (!result) {
    return res.status(404).json({ error: "Monitor not found", code: 404 });
  }
  res.json(result);
});

/**
 * GET /api/price-monitor/monitors/:id/history
 * Get price history for a monitor.
 * Query: limit
 */
router.get("/api/price-monitor/monitors/:id/history", checkAuthenticated, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const history = getPriceHistory(req.params.id, { limit });
  res.json(history);
});

/**
 * GET /api/price-monitor/alerts
 * Get alerts for current user.
 * Query: limit
 */
router.get("/api/price-monitor/alerts", checkAuthenticated, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const alerts = getAlerts(req.session.user?.id, { limit });
  res.json(alerts);
});

/**
 * GET /api/price-monitor/stats
 * Get monitoring statistics for current user.
 */
router.get("/api/price-monitor/stats", checkAuthenticated, (req, res) => {
  const stats = getMonitorStats(req.session.user?.id);
  res.json(stats);
});

/**
 * DELETE /api/price-monitor/clear
 * Clear all monitor data (admin only).
 */
router.delete("/api/price-monitor/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearMonitorData();
  res.json({ message: "Monitor data cleared" });
});

export default router;
