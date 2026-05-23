// Anomaly detection routes — detect unusual API usage patterns

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  recordRequest,
  getRequestRate,
  detectAnomalies,
  detectIPAnomalies,
  getAnomalyStats,
  clearAnomalyData,
} from "../utils/anomalyDetection.js";

const router = Router();

/**
 * POST /api/anomaly/record
 * Record a request for anomaly tracking.
 * Body: { endpoint, method, userId, ip, statusCode, duration }
 */
router.post("/api/anomaly/record", checkAuthenticated, (req, res) => {
  const record = recordRequest(req.body);
  res.status(201).json(record);
});

/**
 * GET /api/anomaly/rate
 * Get request rate per minute (admin only).
 * Query: minutes, endpoint
 */
router.get("/api/anomaly/rate", checkAuthenticated, checkRole("admin"), (req, res) => {
  const minutes = parseInt(req.query.minutes) || 60;
  const endpoint = req.query.endpoint || null;
  const rate = getRequestRate({ minutes, endpoint });
  res.json(rate);
});

/**
 * GET /api/anomaly/detect
 * Detect request anomalies (admin only).
 * Query: threshold, lookbackMinutes
 */
router.get("/api/anomaly/detect", checkAuthenticated, checkRole("admin"), (req, res) => {
  const threshold = parseFloat(req.query.threshold) || 2.5;
  const lookbackMinutes = parseInt(req.query.lookbackMinutes) || 60;
  const anomalies = detectAnomalies({ threshold, lookbackMinutes });
  res.json({ anomalies, count: anomalies.length });
});

/**
 * GET /api/anomaly/ips
 * Detect IP-based anomalies (admin only).
 * Query: threshold, maxRequestsPerIP
 */
router.get("/api/anomaly/ips", checkAuthenticated, checkRole("admin"), (req, res) => {
  const threshold = parseFloat(req.query.threshold) || 3;
  const maxRequestsPerIP = parseInt(req.query.maxRequestsPerIP) || 100;
  const anomalies = detectIPAnomalies({ threshold, maxRequestsPerIP });
  res.json({ anomalies, count: anomalies.length });
});

/**
 * GET /api/anomaly/stats
 * Get anomaly statistics (admin only).
 */
router.get("/api/anomaly/stats", checkAuthenticated, checkRole("admin"), (req, res) => {
  const stats = getAnomalyStats();
  res.json(stats);
});

/**
 * DELETE /api/anomaly/clear
 * Clear anomaly data (admin only).
 */
router.delete("/api/anomaly/clear", checkAuthenticated, checkRole("admin"), (req, res) => {
  clearAnomalyData();
  res.json({ message: "Anomaly data cleared" });
});

export default router;
