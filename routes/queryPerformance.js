// Query performance routes — track and analyze query performance

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  recordQueryPerformance,
  getPerformanceStats,
  getSlowQueries,
  getQueryFrequency,
  getPerformanceTrends,
  clearPerformanceData,
} from "../utils/queryPerformance.js";

const router = Router();

/**
 * GET /api/performance/stats
 * Get query performance statistics (admin only).
 * Query: hours, engine
 */
router.get("/api/performance/stats", checkAuthenticated, checkRole("admin"), (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const engine = req.query.engine || null;

  const stats = getPerformanceStats({ hours, engine });
  res.json(stats);
});

/**
 * GET /api/performance/slow
 * Get slow query details (admin only).
 * Query: threshold, limit, engine
 */
router.get("/api/performance/slow", checkAuthenticated, checkRole("admin"), (req, res) => {
  const threshold = parseInt(req.query.threshold) || 1000;
  const limit = parseInt(req.query.limit) || 50;
  const engine = req.query.engine || null;

  const slowQueries = getSlowQueries({ threshold, limit, engine });
  res.json({ queries: slowQueries, count: slowQueries.length });
});

/**
 * GET /api/performance/frequency
 * Get query frequency analysis (admin only).
 * Query: hours, limit
 */
router.get("/api/performance/frequency", checkAuthenticated, checkRole("admin"), (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const limit = parseInt(req.query.limit) || 20;

  const frequency = getQueryFrequency({ hours, limit });
  res.json({ queries: frequency, count: frequency.length });
});

/**
 * GET /api/performance/trends
 * Get performance trends over time (admin only).
 * Query: hours, interval (hour|day)
 */
router.get("/api/performance/trends", checkAuthenticated, checkRole("admin"), (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const interval = req.query.interval || "hour";

  const trends = getPerformanceTrends({ hours, interval });
  res.json({ trends, count: trends.length });
});

/**
 * POST /api/performance/record
 * Record a query performance entry.
 * Body: { query, engine, duration, resultCount?, cached? }
 */
router.post("/api/performance/record", checkAuthenticated, (req, res) => {
  const { query, engine, duration, resultCount, cached } = req.body;

  if (!query || !engine || duration === undefined) {
    return res.status(400).json({ error: "query, engine, and duration are required" });
  }

  const record = recordQueryPerformance({
    query,
    engine,
    duration,
    resultCount,
    userId: req.session.user?.id,
    cached,
  });

  res.status(201).json(record);
});

/**
 * DELETE /api/performance/clear
 * Clear performance data (admin only).
 */
router.delete("/api/performance/clear", checkAuthenticated, checkRole("admin"), (req, res) => {
  clearPerformanceData();
  res.json({ message: "Performance data cleared" });
});

export default router;
