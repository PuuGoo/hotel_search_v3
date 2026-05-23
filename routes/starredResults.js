import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "starred_results.json");

const router = Router();

function readStarred() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading starred results:", e.message);
  }
  return [];
}

function writeStarred(starred) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(starred, null, 2));
}

// Get all starred results for current user
router.get("/api/starred-results", checkAuthenticated, (req, res) => {
  const starred = readStarred();
  const userStarred = starred
    .filter((s) => s.userId === req.session.user.id)
    .sort((a, b) => new Date(b.starredAt) - new Date(a.starredAt));

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const start = (page - 1) * limit;
  const items = userStarred.slice(start, start + limit);

  res.json({
    items,
    total: userStarred.length,
    page,
    limit,
    totalPages: Math.ceil(userStarred.length / limit),
    hasMore: start + limit < userStarred.length,
  });
});

// Star a result
router.post("/api/starred-results", checkAuthenticated, (req, res) => {
  const { title, url, snippet, engine, score, tags } = req.body;

  if (!title && !url) {
    return res.status(400).json({ error: "title or url is required" });
  }

  const starred = readStarred();
  const userId = req.session.user.id;

  // Check if already starred (by URL)
  if (url) {
    const existing = starred.find((s) => s.userId === userId && s.url === url);
    if (existing) {
      return res.status(409).json({ error: "Already starred", existing });
    }
  }

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId,
    title: title || "",
    url: url || "",
    snippet: snippet || "",
    engine: engine || "unknown",
    score: score || null,
    tags: Array.isArray(tags) ? tags : [],
    starredAt: new Date().toISOString(),
  };

  starred.push(entry);
  writeStarred(starred);
  res.status(201).json(entry);
});

// Update a starred result (tags, notes)
router.put("/api/starred-results/:id", checkAuthenticated, (req, res) => {
  const starred = readStarred();
  const idx = starred.findIndex(
    (s) => s.id === req.params.id && s.userId === req.session.user.id
  );
  if (idx === -1) {
    return res.status(404).json({ error: "Not found" });
  }

  const { tags, notes } = req.body;
  if (tags !== undefined) starred[idx].tags = tags;
  if (notes !== undefined) starred[idx].notes = notes;

  writeStarred(starred);
  res.json(starred[idx]);
});

// Unstar a result
router.delete("/api/starred-results/:id", checkAuthenticated, (req, res) => {
  const starred = readStarred();
  const idx = starred.findIndex(
    (s) => s.id === req.params.id && s.userId === req.session.user.id
  );
  if (idx === -1) {
    return res.status(404).json({ error: "Not found" });
  }
  starred.splice(idx, 1);
  writeStarred(starred);
  res.json({ success: true });
});

// Check if URL is starred
router.get("/api/starred-results/check", checkAuthenticated, (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.json({ starred: false });
  }
  const starred = readStarred();
  const exists = starred.find(
    (s) => s.userId === req.session.user.id && s.url === url
  );
  res.json({ starred: !!exists, id: exists?.id });
});

// Get starred stats
router.get("/api/starred-results/stats", checkAuthenticated, (req, res) => {
  const starred = readStarred();
  const userStarred = starred.filter((s) => s.userId === req.session.user.id);

  const byEngine = {};
  for (const s of userStarred) {
    byEngine[s.engine] = (byEngine[s.engine] || 0) + 1;
  }

  const allTags = {};
  for (const s of userStarred) {
    for (const tag of s.tags || []) {
      allTags[tag] = (allTags[tag] || 0) + 1;
    }
  }

  res.json({
    total: userStarred.length,
    byEngine,
    topTags: Object.entries(allTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count })),
  });
});

export default router;
