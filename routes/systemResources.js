// System resource routes — track CPU, memory, disk usage over time

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  recordSnapshot,
  getCurrentResources,
  getResourceHistory,
  getResourceStats,
  getResourceAlerts,
  clearResourceData,
} from "../utils/systemResources.js";

const router = Router();

/**
 * GET /api/system-resources/current
 * Get current system resources (admin only).
 */
router.get("/api/system-resources/current", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const resources = getCurrentResources();
  res.json(resources);
});

/**
 * POST /api/system-resources/snapshot
 * Take and record a resource snapshot (admin only).
 */
router.post("/api/system-resources/snapshot", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const snapshot = recordSnapshot();
  res.status(201).json(snapshot);
});

/**
 * GET /api/system-resources/history
 * Get resource history (admin only).
 * Query: minutes
 */
router.get("/api/system-resources/history", checkAuthenticated, checkRole("admin"), (req, res) => {
  const minutes = parseInt(req.query.minutes) || 60;
  const history = getResourceHistory({ minutes });
  res.json(history);
});

/**
 * GET /api/system-resources/stats
 * Get resource statistics (admin only).
 * Query: minutes
 */
router.get("/api/system-resources/stats", checkAuthenticated, checkRole("admin"), (req, res) => {
  const minutes = parseInt(req.query.minutes) || 60;
  const stats = getResourceStats({ minutes });
  res.json(stats);
});

/**
 * GET /api/system-resources/alerts
 * Get resource alerts (admin only).
 * Query: cpuThreshold, memoryThreshold, heapThreshold
 */
router.get("/api/system-resources/alerts", checkAuthenticated, checkRole("admin"), (req, res) => {
  const cpuThreshold = parseInt(req.query.cpuThreshold) || 90;
  const memoryThreshold = parseInt(req.query.memoryThreshold) || 90;
  const heapThreshold = parseInt(req.query.heapThreshold) || 500;
  const alerts = getResourceAlerts({ cpuThreshold, memoryThreshold, heapThreshold });
  res.json(alerts);
});

/**
 * DELETE /api/system-resources/clear
 * Clear resource data (admin only).
 */
router.delete("/api/system-resources/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearResourceData();
  res.json({ message: "System resource data cleared" });
});

export default router;
