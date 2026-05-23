import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAVED_SEARCHES_FILE = path.join(__dirname, "..", "saved_searches.json");
const MAX_SAVED_PER_USER = 50;

const router = Router();

function readSavedSearches() {
  try {
    if (fs.existsSync(SAVED_SEARCHES_FILE)) {
      return JSON.parse(fs.readFileSync(SAVED_SEARCHES_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading saved_searches.json:", e.message);
  }
  return {};
}

function writeSavedSearches(data) {
  fs.writeFileSync(SAVED_SEARCHES_FILE, JSON.stringify(data, null, 2), "utf8");
}

/**
 * @swagger
 * /api/saved-searches:
 *   get:
 *     summary: Get saved searches
 *     description: Returns the authenticated user's saved searches
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: engine
 *         schema:
 *           type: string
 *           enum: [tavily, google, ddg]
 *         description: Filter by search engine
 *     responses:
 *       200:
 *         description: Saved searches list
 *       401:
 *         description: Not authenticated
 */
router.get("/api/saved-searches", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const engineFilter = req.query.engine;

  const allSaved = readSavedSearches();
  let items = allSaved[userId] || [];

  if (engineFilter && ["tavily", "google", "ddg"].includes(engineFilter)) {
    items = items.filter((s) => s.engine === engineFilter);
  }

  items.sort((a, b) => b.updatedAt - a.updatedAt);

  res.json({ savedSearches: items });
});

/**
 * @swagger
 * /api/saved-searches:
 *   post:
 *     summary: Save a search
 *     description: Save a search query for later re-execution
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [query, engine]
 *             properties:
 *               query:
 *                 type: string
 *               engine:
 *                 type: string
 *                 enum: [tavily, google, ddg]
 *               label:
 *                 type: string
 *     responses:
 *       200:
 *         description: Search saved
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Not authenticated
 */
router.post("/api/saved-searches", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { query, engine, label } = req.body;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return res.status(400).json({ error: "Thiếu query" });
  }
  if (!engine || !["tavily", "google", "ddg"].includes(engine)) {
    return res.status(400).json({ error: "Engine không hợp lệ" });
  }

  const sanitizedQuery = query.replace(/[<>]/g, "").trim().slice(0, 500);
  const sanitizedLabel = (label || "").replace(/[<>]/g, "").trim().slice(0, 100);

  const allSaved = readSavedSearches();
  if (!allSaved[userId]) {
    allSaved[userId] = [];
  }

  // Check for duplicate
  const exists = allSaved[userId].find((s) => s.query === sanitizedQuery && s.engine === engine);
  if (exists) {
    exists.lastRun = Date.now();
    exists.runCount = (exists.runCount || 0) + 1;
    exists.updatedAt = Date.now();
    writeSavedSearches(allSaved);
    return res.json({ success: true, savedSearch: exists, duplicate: true });
  }

  if (allSaved[userId].length >= MAX_SAVED_PER_USER) {
    return res.status(400).json({ error: `Tối đa ${MAX_SAVED_PER_USER} tìm kiếm đã lưu` });
  }

  const entry = {
    id: Date.now(),
    query: sanitizedQuery,
    engine,
    label: sanitizedLabel || sanitizedQuery.slice(0, 50),
    runCount: 0,
    lastRun: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  allSaved[userId].unshift(entry);
  writeSavedSearches(allSaved);
  res.json({ success: true, savedSearch: entry });
});

/**
 * @swagger
 * /api/saved-searches/{id}:
 *   put:
 *     summary: Update saved search
 *     description: Update label of a saved search
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
 *         description: Saved search updated
 *       404:
 *         description: Not found
 */
router.put("/api/saved-searches/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const searchId = Number(req.params.id);

  const allSaved = readSavedSearches();
  const userSaved = allSaved[userId] || [];
  const saved = userSaved.find((s) => s.id === searchId);

  if (!saved) {
    return res.status(404).json({ error: "Không tìm thấy" });
  }

  const { label } = req.body;
  if (label !== undefined) {
    if (typeof label !== "string" || label.length > 100) {
      return res.status(400).json({ error: "Label không hợp lệ" });
    }
    saved.label = label.replace(/[<>]/g, "").trim();
  }

  saved.updatedAt = Date.now();
  writeSavedSearches(allSaved);
  res.json({ success: true, savedSearch: saved });
});

/**
 * @swagger
 * /api/saved-searches/{id}:
 *   delete:
 *     summary: Delete saved search
 *     description: Delete a specific saved search
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
 *         description: Deleted
 *       404:
 *         description: Not found
 */
router.delete("/api/saved-searches/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const searchId = Number(req.params.id);

  const allSaved = readSavedSearches();
  const userSaved = allSaved[userId] || [];
  const idx = userSaved.findIndex((s) => s.id === searchId);

  if (idx === -1) {
    return res.status(404).json({ error: "Không tìm thấy" });
  }

  userSaved.splice(idx, 1);
  allSaved[userId] = userSaved;
  writeSavedSearches(allSaved);
  res.json({ success: true });
});

/**
 * @swagger
 * /api/saved-searches/{id}/run:
 *   post:
 *     summary: Record a run
 *     description: Increment run count and update last run timestamp
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
 *         description: Updated
 *       404:
 *         description: Not found
 */
router.post("/api/saved-searches/:id/run", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const searchId = Number(req.params.id);

  const allSaved = readSavedSearches();
  const userSaved = allSaved[userId] || [];
  const saved = userSaved.find((s) => s.id === searchId);

  if (!saved) {
    return res.status(404).json({ error: "Không tìm thấy" });
  }

  saved.runCount = (saved.runCount || 0) + 1;
  saved.lastRun = Date.now();
  saved.updatedAt = Date.now();
  writeSavedSearches(allSaved);
  res.json({ success: true, savedSearch: saved });
});

export default router;
