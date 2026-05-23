// API health score routes — compute overall API health

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  computeHealthScore,
  recordHealthScore,
  getHealthHistory,
  getHealthTrend,
  getHealthStats,
  clearHealthData,
} from "../utils/apiHealthScore.js";

const router = Router();

/**
 * GET /api/health-score
 * Compute current health score from provided metrics or defaults.
 * Query: errorRate, p95ResponseTime, uptimePercent, memoryPercent, cpuPercent
 */
router.get("/api/health-score", checkAuthenticated, checkRole("admin"), (req, res) => {
  const metrics = {
    errorRate: parseFloat(req.query.errorRate) || 0,
    p95ResponseTime: parseFloat(req.query.p95ResponseTime) || 100,
    uptimePercent: parseFloat(req.query.uptimePercent) || 100,
    memoryPercent: parseFloat(req.query.memoryPercent) || 50,
    cpuPercent: parseFloat(req.query.cpuPercent) || 30,
  };
  const score = computeHealthScore(metrics);
  res.json(score);
});

/**
 * POST /api/health-score/record
 * Record a health score snapshot (admin only).
 * Body: { errorRate, p95ResponseTime, uptimePercent, memoryPercent, cpuPercent }
 */
router.post("/api/health-score/record", checkAuthenticated, checkRole("admin"), (req, res) => {
  const score = recordHealthScore(req.body);
  res.status(201).json(score);
});

/**
 * GET /api/health-score/history
 * Get health score history (admin only).
 * Query: minutes
 */
router.get("/api/health-score/history", checkAuthenticated, checkRole("admin"), (req, res) => {
  const minutes = parseInt(req.query.minutes) || 60;
  const history = getHealthHistory({ minutes });
  res.json(history);
});

/**
 * GET /api/health-score/trend
 * Get health trend (admin only).
 * Query: minutes
 */
router.get("/api/health-score/trend", checkAuthenticated, checkRole("admin"), (req, res) => {
  const minutes = parseInt(req.query.minutes) || 60;
  const trend = getHealthTrend({ minutes });
  res.json(trend);
});

/**
 * GET /api/health-score/stats
 * Get health score statistics (admin only).
 * Query: hours
 */
router.get("/api/health-score/stats", checkAuthenticated, checkRole("admin"), (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const stats = getHealthStats({ hours });
  res.json(stats);
});

/**
 * DELETE /api/health-score/clear
 * Clear health score data (admin only).
 */
router.delete("/api/health-score/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearHealthData();
  res.json({ message: "Health score data cleared" });
});

export default router;
