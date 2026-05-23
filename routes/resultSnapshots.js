// Result snapshot routes — save and compare search result sets over time

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import {
  saveSnapshot,
  getSnapshots,
  getSnapshot,
  deleteSnapshot,
  compareSnapshots,
  getSnapshotStats,
} from "../utils/resultSnapshots.js";

const router = Router();

/**
 * GET /api/snapshots
 * Get all snapshots for the current user.
 * Query: query, engine, limit
 */
router.get("/api/snapshots", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { query, engine, limit } = req.query;

  const snapshots = getSnapshots(userId, {
    query,
    engine,
    limit: limit ? parseInt(limit) : undefined,
  });

  res.json({ snapshots, count: snapshots.length });
});

/**
 * GET /api/snapshots/stats
 * Get snapshot statistics.
 */
router.get("/api/snapshots/stats", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const stats = getSnapshotStats(userId);
  res.json(stats);
});

/**
 * POST /api/snapshots
 * Save a new snapshot.
 * Body: { query, engine?, results[], userAgent?, filters?, sortBy? }
 */
router.post("/api/snapshots", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { query, engine, results, userAgent, filters, sortBy } = req.body;

  if (!query || !results || !Array.isArray(results)) {
    return res.status(400).json({ error: "query and results array are required" });
  }

  try {
    const snapshot = saveSnapshot(userId, { query, engine, results, userAgent, filters, sortBy });
    res.status(201).json(snapshot);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/snapshots/compare
 * Compare two snapshots.
 * Query: snapshot1, snapshot2
 */
router.get("/api/snapshots/compare", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { snapshot1, snapshot2 } = req.query;

  if (!snapshot1 || !snapshot2) {
    return res.status(400).json({ error: "snapshot1 and snapshot2 IDs are required" });
  }

  const comparison = compareSnapshots(userId, snapshot1, snapshot2);

  if (!comparison) {
    return res.status(404).json({ error: "One or both snapshots not found" });
  }

  res.json(comparison);
});

/**
 * GET /api/snapshots/:id
 * Get a specific snapshot by ID.
 */
router.get("/api/snapshots/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const snapshot = getSnapshot(userId, req.params.id);

  if (!snapshot) {
    return res.status(404).json({ error: "Snapshot not found" });
  }

  res.json(snapshot);
});

/**
 * DELETE /api/snapshots/:id
 * Delete a snapshot.
 */
router.delete("/api/snapshots/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const deleted = deleteSnapshot(userId, req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: "Snapshot not found" });
  }

  res.json({ message: "Snapshot deleted" });
});

export default router;
