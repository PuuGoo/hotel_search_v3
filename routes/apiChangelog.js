// API changelog routes — track API changes and deprecations

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  addEntry,
  getEntries,
  getEntry,
  addDeprecation,
  getDeprecations,
  isDeprecated,
  getChangelogStats,
  clearChangelog,
} from "../utils/apiChangelog.js";

const router = Router();

/**
 * GET /api/changelog
 * Get changelog entries.
 * Query: type, endpoint, version, limit
 */
router.get("/api/changelog", checkAuthenticated, (req, res) => {
  const type = req.query.type || null;
  const endpoint = req.query.endpoint || null;
  const version = req.query.version || null;
  const limit = parseInt(req.query.limit) || 50;
  const entries = getEntries({ type, endpoint, version, limit });
  res.json(entries);
});

/**
 * GET /api/changelog/:id
 * Get a specific changelog entry.
 */
router.get("/api/changelog/:id", checkAuthenticated, (req, res) => {
  const entry = getEntry(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found", code: 404 });
  }
  res.json(entry);
});

/**
 * POST /api/changelog
 * Add a changelog entry (admin only).
 * Body: { type, endpoint, title, description, version, breaking }
 */
router.post("/api/changelog", checkAuthenticated, checkRole("admin"), (req, res) => {
  const entry = addEntry({
    ...req.body,
    author: req.session.user?.id || "admin",
  });
  res.status(201).json(entry);
});

/**
 * GET /api/changelog/deprecations/list
 * Get deprecation notices.
 * Query: active
 */
router.get("/api/changelog/deprecations/list", checkAuthenticated, (req, res) => {
  const active = req.query.active !== "false";
  const deprecations = getDeprecations({ active });
  res.json(deprecations);
});

/**
 * POST /api/changelog/deprecate
 * Add a deprecation notice (admin only).
 * Body: { endpoint, reason, removedIn, alternative, sunsetDate }
 */
router.post("/api/changelog/deprecate", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deprecation = addDeprecation(req.body);
  res.status(201).json(deprecation);
});

/**
 * GET /api/changelog/check/:endpoint
 * Check if an endpoint is deprecated.
 */
router.get("/api/changelog/check/:endpoint", checkAuthenticated, (req, res) => {
  const endpoint = decodeURIComponent(req.params.endpoint);
  const deprecated = isDeprecated(endpoint);
  res.json({ endpoint, deprecated });
});

/**
 * GET /api/changelog/stats/overview
 * Get changelog statistics (admin only).
 */
router.get("/api/changelog/stats/overview", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getChangelogStats();
  res.json(stats);
});

/**
 * DELETE /api/changelog/clear
 * Clear changelog data (admin only).
 */
router.delete("/api/changelog/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearChangelog();
  res.json({ message: "Changelog cleared" });
});

export default router;
