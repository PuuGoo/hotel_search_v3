import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "recent_searches.json");

const router = Router();

function readRecent() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading recent searches:", e.message);
  }
  return [];
}

function writeRecent(searches) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(searches, null, 2));
}

// Get recent searches for current user
router.get("/api/recent-searches", checkAuthenticated, (req, res) => {
  const searches = readRecent();
  const userSearches = searches
    .filter((s) => s.userId === req.session.user.id)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, parseInt(req.query.limit) || 20);
  res.json(userSearches);
});

// Add a recent search
router.post("/api/recent-searches", checkAuthenticated, (req, res) => {
  const { query, engine } = req.body;

  if (!query || !query.trim()) {
    return res.status(400).json({ error: "query is required" });
  }

  const searches = readRecent();
  const userId = req.session.user.id;

  // Remove duplicate if exists
  const filtered = searches.filter(
    (s) => !(s.userId === userId && s.query.toLowerCase() === query.trim().toLowerCase())
  );

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId,
    query: query.trim(),
    engine: engine || "tavily",
    timestamp: new Date().toISOString(),
  };

  filtered.unshift(entry);

  // Keep only last 100 per user
  const userSearches = filtered.filter((s) => s.userId === userId).slice(0, 100);
  const otherSearches = filtered.filter((s) => s.userId !== userId);
  writeRecent([...otherSearches, ...userSearches]);

  res.status(201).json(entry);
});

// Delete a recent search
router.delete("/api/recent-searches/:id", checkAuthenticated, (req, res) => {
  const searches = readRecent();
  const idx = searches.findIndex(
    (s) => s.id === req.params.id && s.userId === req.session.user.id
  );
  if (idx === -1) {
    return res.status(404).json({ error: "Not found" });
  }
  searches.splice(idx, 1);
  writeRecent(searches);
  res.json({ success: true });
});

// Clear all recent searches for current user
router.delete("/api/recent-searches", checkAuthenticated, (req, res) => {
  const searches = readRecent();
  const otherSearches = searches.filter((s) => s.userId !== req.session.user.id);
  writeRecent(otherSearches);
  res.json({ success: true });
});

export default router;
