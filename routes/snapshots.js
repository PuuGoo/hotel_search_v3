import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SNAPSHOTS_FILE = path.join(__dirname, "..", "search_snapshots.json");
const MAX_SNAPSHOTS_PER_USER = 50;

const router = Router();

function readSnapshots() {
  try {
    if (fs.existsSync(SNAPSHOTS_FILE)) {
      return JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading snapshots:", e.message);
  }
  return {};
}

function writeSnapshots(data) {
  fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(data, null, 2), "utf8");
}

/**
 * @swagger
 * /api/snapshots:
 *   get:
 *     summary: List search snapshots
 *     description: Returns the authenticated user's saved search snapshots
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: List of snapshots
 *       401:
 *         description: Not authenticated
 */
router.get("/api/snapshots", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const allSnapshots = readSnapshots();
  const userSnapshots = allSnapshots[userId] || [];

  const snapshots = userSnapshots
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((s) => ({
      id: s.id,
      name: s.name,
      query: s.query,
      engine: s.engine,
      resultCount: s.results.length,
      timestamp: s.timestamp,
    }));

  res.json({ snapshots, total: snapshots.length });
});

/**
 * @swagger
 * /api/snapshots:
 *   post:
 *     summary: Save search snapshot
 *     description: Save a snapshot of current search results
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [query, engine, results]
 *             properties:
 *               name:
 *                 type: string
 *               query:
 *                 type: string
 *               engine:
 *                 type: string
 *               results:
 *                 type: array
 *     responses:
 *       200:
 *         description: Snapshot saved
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Not authenticated
 */
router.post("/api/snapshots", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { name, query, engine, results } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Query is required" });
  }
  if (!engine || !["tavily", "google", "ddg"].includes(engine)) {
    return res.status(400).json({ error: "Valid engine is required" });
  }
  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "Results array is required" });
  }

  const allSnapshots = readSnapshots();
  if (!allSnapshots[userId]) {
    allSnapshots[userId] = [];
  }

  if (allSnapshots[userId].length >= MAX_SNAPSHOTS_PER_USER) {
    return res.status(400).json({ error: `Maximum ${MAX_SNAPSHOTS_PER_USER} snapshots allowed` });
  }

  const sanitizedResults = results.slice(0, 50).map((r) => ({
    title: String(r.title || "").slice(0, 500),
    url: String(r.url || "").slice(0, 2000),
    snippet: String(r.snippet || "").slice(0, 1000),
    price: r.price || null,
    rating: r.rating || null,
    position: r.position || null,
  }));

  const snapshot = {
    id: Date.now(),
    name: (name || `Search: ${query}`).slice(0, 200),
    query: query.replace(/[<>]/g, "").trim().slice(0, 500),
    engine,
    results: sanitizedResults,
    timestamp: Date.now(),
  };

  allSnapshots[userId].unshift(snapshot);

  if (allSnapshots[userId].length > MAX_SNAPSHOTS_PER_USER) {
    allSnapshots[userId].length = MAX_SNAPSHOTS_PER_USER;
  }

  writeSnapshots(allSnapshots);
  res.json({ success: true, snapshot: { id: snapshot.id, name: snapshot.name, resultCount: sanitizedResults.length } });
});

/**
 * @swagger
 * /api/snapshots/{id}:
 *   get:
 *     summary: Get snapshot details
 *     description: Returns full snapshot with all results
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Snapshot details
 *       404:
 *         description: Snapshot not found
 */
router.get("/api/snapshots/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const snapshotId = Number(req.params.id);

  const allSnapshots = readSnapshots();
  const userSnapshots = allSnapshots[userId] || [];
  const snapshot = userSnapshots.find((s) => s.id === snapshotId);

  if (!snapshot) {
    return res.status(404).json({ error: "Snapshot not found" });
  }

  res.json({ snapshot });
});

/**
 * @swagger
 * /api/snapshots/{id}:
 *   delete:
 *     summary: Delete snapshot
 *     description: Delete a saved search snapshot
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Snapshot deleted
 *       404:
 *         description: Snapshot not found
 */
router.delete("/api/snapshots/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const snapshotId = Number(req.params.id);

  const allSnapshots = readSnapshots();
  const userSnapshots = allSnapshots[userId] || [];
  const idx = userSnapshots.findIndex((s) => s.id === snapshotId);

  if (idx === -1) {
    return res.status(404).json({ error: "Snapshot not found" });
  }

  userSnapshots.splice(idx, 1);
  allSnapshots[userId] = userSnapshots;
  writeSnapshots(allSnapshots);
  res.json({ success: true });
});

/**
 * @swagger
 * /api/snapshots/compare:
 *   post:
 *     summary: Compare two snapshots
 *     description: Compare two snapshots and return differences
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [snapshotId1, snapshotId2]
 *             properties:
 *               snapshotId1:
 *                 type: integer
 *               snapshotId2:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Comparison result
 *       404:
 *         description: Snapshot not found
 */
router.post("/api/snapshots/compare", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { snapshotId1, snapshotId2 } = req.body;

  if (!snapshotId1 || !snapshotId2) {
    return res.status(400).json({ error: "Both snapshotId1 and snapshotId2 are required" });
  }

  const allSnapshots = readSnapshots();
  const userSnapshots = allSnapshots[userId] || [];
  const s1 = userSnapshots.find((s) => s.id === Number(snapshotId1));
  const s2 = userSnapshots.find((s) => s.id === Number(snapshotId2));

  if (!s1 || !s2) {
    return res.status(404).json({ error: "One or both snapshots not found" });
  }

  const urls1 = new Set(s1.results.map((r) => r.url));
  const urls2 = new Set(s2.results.map((r) => r.url));

  const added = s2.results.filter((r) => !urls1.has(r.url));
  const removed = s1.results.filter((r) => !urls2.has(r.url));
  const kept = s2.results.filter((r) => urls1.has(r.url));

  res.json({
    snapshot1: { id: s1.id, name: s1.name, query: s1.query, engine: s1.engine, timestamp: s1.timestamp },
    snapshot2: { id: s2.id, name: s2.name, query: s2.query, engine: s2.engine, timestamp: s2.timestamp },
    diff: {
      added: added.map((r) => ({ title: r.title, url: r.url })),
      removed: removed.map((r) => ({ title: r.title, url: r.url })),
      kept: kept.map((r) => ({ title: r.title, url: r.url })),
      addedCount: added.length,
      removedCount: removed.length,
      keptCount: kept.length,
    },
  });
});

export default router;
