// Request/response logging routes — view and manage request/response logs

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  getEntries,
  getEntry,
  getLogStats,
  clearLog,
  getConfig,
  updateConfig,
} from "../utils/requestResponseLogger.js";

const router = Router();

/**
 * GET /api/req-res-log
 * Get logged request/response entries (admin only).
 * Query: method, path, statusCode, limit, offset
 */
router.get("/api/req-res-log", checkAuthenticated, checkRole("admin"), (req, res) => {
  const method = req.query.method || null;
  const pathFilter = req.query.path || null;
  const statusCode = req.query.statusCode || null;
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const entries = getEntries({ method, path: pathFilter, statusCode, limit, offset });
  res.json(entries);
});

/**
 * GET /api/req-res-log/stats/overview
 * Get logging statistics (admin only).
 * Query: minutes
 */
router.get("/api/req-res-log/stats/overview", checkAuthenticated, checkRole("admin"), (req, res) => {
  const minutes = parseInt(req.query.minutes) || 60;
  const stats = getLogStats({ minutes });
  res.json(stats);
});

/**
 * GET /api/req-res-log/config
 * Get logging config (admin only).
 */
router.get("/api/req-res-log/config", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const config = getConfig();
  res.json(config);
});

/**
 * PUT /api/req-res-log/config
 * Update logging config (admin only).
 * Body: { enabled, logHeaders, logBodies }
 */
router.put("/api/req-res-log/config", checkAuthenticated, checkRole("admin"), (req, res) => {
  const config = updateConfig(req.body);
  res.json({ config, message: "Config updated" });
});

/**
 * DELETE /api/req-res-log/clear
 * Clear log data (admin only).
 */
router.delete("/api/req-res-log/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearLog();
  res.json({ message: "Request/response log cleared" });
});

/**
 * GET /api/req-res-log/:id
 * Get a specific log entry (admin only).
 */
router.get("/api/req-res-log/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const entry = getEntry(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found", code: 404 });
  }
  res.json(entry);
});

export default router;
