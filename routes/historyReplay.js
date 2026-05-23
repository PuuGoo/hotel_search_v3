import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");

const router = Router();

function readHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading history:", e.message);
  }
  return [];
}

// Get replayable search history
router.get("/api/history/replayable", checkAuthenticated, (req, res) => {
  const history = readHistory();
  const userHistory = history
    .filter((h) => h.userId === req.session.user.id)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Deduplicate by query+engine, keep latest
  const seen = new Set();
  const replayable = [];
  for (const h of userHistory) {
    const key = `${h.query}|${h.engine}`;
    if (!seen.has(key)) {
      seen.add(key);
      replayable.push({
        id: h.id,
        query: h.query,
        engine: h.engine || "tavily",
        resultCount: h.resultCount || 0,
        timestamp: h.timestamp,
        params: h.params || {},
      });
    }
    if (replayable.length >= 50) break;
  }

  res.json(replayable);
});

// Replay a specific search (returns the params needed to re-run)
router.get("/api/history/replay/:id", checkAuthenticated, (req, res) => {
  const history = readHistory();
  const entry = history.find(
    (h) => h.id === req.params.id && h.userId === req.session.user.id
  );

  if (!entry) {
    return res.status(404).json({ error: "Search not found" });
  }

  res.json({
    query: entry.query,
    engine: entry.engine || "tavily",
    params: entry.params || {},
    originalTimestamp: entry.timestamp,
  });
});

export default router;
