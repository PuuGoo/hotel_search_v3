// Response time percentiles routes — track p50/p95/p99 per route

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  recordResponseTime,
  getPercentiles,
  getPercentilesByEndpoint,
  getSlowEndpoints,
  getResponseTimeStats,
  clearResponseTimeData,
} from "../utils/responseTimePercentiles.js";

const router = Router();

/**
 * POST /api/response-time/record
 * Record a response time sample.
 * Body: { endpoint, method, statusCode, duration }
 */
router.post("/api/response-time/record", checkAuthenticated, (req, res) => {
  const record = recordResponseTime(req.body);
  res.status(201).json(record);
});

/**
 * GET /api/response-time/percentiles
 * Get percentiles for a specific endpoint or overall (admin only).
 * Query: endpoint, minutes
 */
router.get("/api/response-time/percentiles", checkAuthenticated, checkRole("admin"), (req, res) => {
  const endpoint = req.query.endpoint || null;
  const minutes = parseInt(req.query.minutes) || 60;
  const result = getPercentiles({ endpoint, minutes });
  res.json(result);
});

/**
 * GET /api/response-time/by-endpoint
 * Get percentiles grouped by endpoint (admin only).
 * Query: minutes
 */
router.get("/api/response-time/by-endpoint", checkAuthenticated, checkRole("admin"), (req, res) => {
  const minutes = parseInt(req.query.minutes) || 60;
  const result = getPercentilesByEndpoint({ minutes });
  res.json(result);
});

/**
 * GET /api/response-time/slow
 * Get slow endpoints (admin only).
 * Query: thresholdMs, minutes
 */
router.get("/api/response-time/slow", checkAuthenticated, checkRole("admin"), (req, res) => {
  const thresholdMs = parseInt(req.query.thresholdMs) || 1000;
  const minutes = parseInt(req.query.minutes) || 60;
  const result = getSlowEndpoints({ thresholdMs, minutes });
  res.json(result);
});

/**
 * GET /api/response-time/stats
 * Get response time statistics (admin only).
 * Query: hours
 */
router.get("/api/response-time/stats", checkAuthenticated, checkRole("admin"), (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const stats = getResponseTimeStats({ hours });
  res.json(stats);
});

/**
 * DELETE /api/response-time/clear
 * Clear response time data (admin only).
 */
router.delete("/api/response-time/clear", checkAuthenticated, checkRole("admin"), (req, res) => {
  clearResponseTimeData();
  res.json({ message: "Response time data cleared" });
});

export default router;
