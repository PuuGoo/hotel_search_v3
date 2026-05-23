// API changelog viewer routes — visual changelog with version history

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  addEntry,
  getEntries,
  getEntry,
  deleteEntry,
  createVersion,
  getVersions,
  getGroupedChangelog,
  getChangelogStats,
  clearChangelogData,
} from "../utils/apiChangelogViewer.js";

const router = Router();

/**
 * POST /api/changelog/entries
 * Add a changelog entry (admin only).
 */
router.post("/api/changelog/entries", checkAuthenticated, checkRole("admin"), (req, res) => {
  const entry = addEntry({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(entry);
});

/**
 * GET /api/changelog/entries
 * Get changelog entries with optional filters.
 */
router.get("/api/changelog/entries", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { version, type, limit } = req.query;
  const result = getEntries({
    version: version || null,
    type: type || null,
    limit: limit ? parseInt(limit) : 50,
  });
  res.json(result);
});

/**
 * GET /api/changelog/grouped
 * Get changelog grouped by version.
 */
router.get("/api/changelog/grouped", checkAuthenticated, checkRole("admin"), (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 10;
  const grouped = getGroupedChangelog(limit);
  res.json({ versions: grouped, count: grouped.length });
});

/**
 * GET /api/changelog/versions
 * Get all versions.
 */
router.get("/api/changelog/versions", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const versions = getVersions();
  res.json({ versions, count: versions.length });
});

/**
 * POST /api/changelog/versions
 * Create a version release (admin only).
 */
router.post("/api/changelog/versions", checkAuthenticated, checkRole("admin"), (req, res) => {
  const version = createVersion({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(version);
});

/**
 * GET /api/changelog/stats
 * Get changelog statistics.
 */
router.get("/api/changelog/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getChangelogStats();
  res.json(stats);
});

/**
 * DELETE /api/changelog/clear
 * Clear all changelog data (admin only).
 */
router.delete("/api/changelog/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearChangelogData();
  res.json({ message: "Changelog data cleared" });
});

/**
 * GET /api/changelog/entries/:id
 * Get a specific changelog entry.
 */
router.get("/api/changelog/entries/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const entry = getEntry(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found", code: 404 });
  }
  res.json(entry);
});

/**
 * DELETE /api/changelog/entries/:id
 * Delete a changelog entry (admin only).
 */
router.delete("/api/changelog/entries/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteEntry(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Entry not found", code: 404 });
  }
  res.json({ message: "Entry deleted" });
});

export default router;
