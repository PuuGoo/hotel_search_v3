import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "scheduled_searches.json");

const router = Router();

function readScheduled() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading scheduled searches:", e.message);
  }
  return [];
}

function writeScheduled(searches) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(searches, null, 2));
}

// Get all scheduled searches for current user
router.get("/api/scheduled-searches", checkAuthenticated, (req, res) => {
  const searches = readScheduled();
  const userSearches = searches.filter((s) => s.userId === req.session.user.id);
  res.json(userSearches);
});

// Create a scheduled search
router.post("/api/scheduled-searches", checkAuthenticated, (req, res) => {
  const { name, query, engine, frequency, time, enabled } = req.body;

  if (!name || !query) {
    return res.status(400).json({ error: "name and query are required" });
  }

  const validFrequencies = ["daily", "weekly", "monthly"];
  if (frequency && !validFrequencies.includes(frequency)) {
    return res.status(400).json({ error: "Invalid frequency. Use: daily, weekly, monthly" });
  }

  const searches = readScheduled();
  const search = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: req.session.user.id,
    name: name.trim(),
    query: query.trim(),
    engine: engine || "tavily",
    frequency: frequency || "daily",
    time: time || "09:00",
    enabled: enabled !== false,
    lastRunAt: null,
    nextRunAt: null,
    runCount: 0,
    lastResults: null,
    createdAt: new Date().toISOString(),
  };

  searches.push(search);
  writeScheduled(searches);
  res.status(201).json(search);
});

// Update a scheduled search
router.put("/api/scheduled-searches/:id", checkAuthenticated, (req, res) => {
  const searches = readScheduled();
  const idx = searches.findIndex(
    (s) => s.id === req.params.id && s.userId === req.session.user.id
  );
  if (idx === -1) {
    return res.status(404).json({ error: "Scheduled search not found" });
  }

  const { name, query, engine, frequency, time, enabled } = req.body;
  const search = searches[idx];

  if (name !== undefined) search.name = name.trim();
  if (query !== undefined) search.query = query.trim();
  if (engine !== undefined) search.engine = engine;
  if (frequency !== undefined) {
    const validFrequencies = ["daily", "weekly", "monthly"];
    if (!validFrequencies.includes(frequency)) {
      return res.status(400).json({ error: "Invalid frequency" });
    }
    search.frequency = frequency;
  }
  if (time !== undefined) search.time = time;
  if (enabled !== undefined) search.enabled = enabled;

  searches[idx] = search;
  writeScheduled(searches);
  res.json(search);
});

// Delete a scheduled search
router.delete("/api/scheduled-searches/:id", checkAuthenticated, (req, res) => {
  const searches = readScheduled();
  const idx = searches.findIndex(
    (s) => s.id === req.params.id && s.userId === req.session.user.id
  );
  if (idx === -1) {
    return res.status(404).json({ error: "Scheduled search not found" });
  }
  searches.splice(idx, 1);
  writeScheduled(searches);
  res.json({ success: true });
});

// Run a scheduled search now (manual trigger)
router.post("/api/scheduled-searches/:id/run", checkAuthenticated, async (req, res) => {
  const searches = readScheduled();
  const idx = searches.findIndex(
    (s) => s.id === req.params.id && s.userId === req.session.user.id
  );
  if (idx === -1) {
    return res.status(404).json({ error: "Scheduled search not found" });
  }

  const search = searches[idx];
  const engine = search.engine || "tavily";
  let results = [];

  try {
    let url;
    if (engine === "ddg") {
      url = `/searchApiDDG?q=${encodeURIComponent(search.query)}`;
    } else if (engine === "google") {
      url = `/searchApiGo?q=${encodeURIComponent(search.query)}`;
    } else {
      url = `/searchApiTavily?q=${encodeURIComponent(search.query)}`;
    }

    const resp = await fetch(`http://localhost:${process.env.PORT || 3000}${url}`, {
      headers: { Cookie: req.headers.cookie || "" },
      signal: AbortSignal.timeout(30000),
    });

    if (resp.ok) {
      const data = await resp.json();
      results = data.results || data.items || [];
    }

    search.lastRunAt = new Date().toISOString();
    search.runCount = (search.runCount || 0) + 1;
    search.lastResults = results.slice(0, 10);
    search.lastError = null;
  } catch (err) {
    search.lastRunAt = new Date().toISOString();
    search.lastError = err.message;
  }

  searches[idx] = search;
  writeScheduled(searches);
  res.json({
    success: !search.lastError,
    results: search.lastResults,
    error: search.lastError,
  });
});

// Get scheduled search stats
router.get("/api/scheduled-searches/stats", checkAuthenticated, (req, res) => {
  const searches = readScheduled();
  const userSearches = searches.filter((s) => s.userId === req.session.user.id);
  const enabled = userSearches.filter((s) => s.enabled).length;
  const totalRuns = userSearches.reduce((s, item) => s + (item.runCount || 0), 0);
  res.json({
    total: userSearches.length,
    enabled,
    disabled: userSearches.length - enabled,
    totalRuns,
  });
});

export default router;
