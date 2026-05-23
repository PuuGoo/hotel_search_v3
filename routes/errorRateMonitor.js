// Error rate monitoring routes — track error rates per endpoint with alerting

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  recordError,
  recordSuccess,
  getErrorRate,
  getErrorRatesByEndpoint,
  checkAlerts,
  getErrorStats,
  clearErrorData,
} from "../utils/errorRateMonitor.js";

const router = Router();

/**
 * POST /api/error-rate/record-error
 * Record an error response.
 * Body: { endpoint, method, statusCode, errorMessage, userId, ip }
 */
router.post("/api/error-rate/record-error", checkAuthenticated, (req, res) => {
  const record = recordError(req.body);
  res.status(201).json(record);
});

/**
 * POST /api/error-rate/record-success
 * Record a successful response.
 * Body: { endpoint, method, statusCode }
 */
router.post("/api/error-rate/record-success", checkAuthenticated, (req, res) => {
  const record = recordSuccess(req.body);
  res.status(201).json(record);
});

/**
 * GET /api/error-rate/rate
 * Get overall error rate for a time window (admin only).
 * Query: minutes, endpoint
 */
router.get("/api/error-rate/rate", checkAuthenticated, checkRole("admin"), (req, res) => {
  const minutes = parseInt(req.query.minutes) || 60;
  const endpoint = req.query.endpoint || null;
  const rate = getErrorRate({ minutes, endpoint });
  res.json(rate);
});

/**
 * GET /api/error-rate/endpoints
 * Get error rates per endpoint (admin only).
 * Query: minutes
 */
router.get("/api/error-rate/endpoints", checkAuthenticated, checkRole("admin"), (req, res) => {
  const minutes = parseInt(req.query.minutes) || 60;
  const rates = getErrorRatesByEndpoint({ minutes });
  res.json(rates);
});

/**
 * GET /api/error-rate/alerts
 * Check for error rate alerts (admin only).
 * Query: threshold, minutes
 */
router.get("/api/error-rate/alerts", checkAuthenticated, checkRole("admin"), (req, res) => {
  const threshold = parseFloat(req.query.threshold) || 5;
  const minutes = parseInt(req.query.minutes) || 5;
  const alerts = checkAlerts({ threshold, minutes });
  res.json({ alerts, count: alerts.length });
});

/**
 * GET /api/error-rate/stats
 * Get error statistics (admin only).
 * Query: hours
 */
router.get("/api/error-rate/stats", checkAuthenticated, checkRole("admin"), (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const stats = getErrorStats({ hours });
  res.json(stats);
});

/**
 * DELETE /api/error-rate/clear
 * Clear error rate data (admin only).
 */
router.delete("/api/error-rate/clear", checkAuthenticated, checkRole("admin"), (req, res) => {
  clearErrorData();
  res.json({ message: "Error rate data cleared" });
});

export default router;
