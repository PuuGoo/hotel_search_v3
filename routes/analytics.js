import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "search_analytics.json");

const router = Router();

function readAnalytics() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading analytics:", e.message);
  }
  return { searches: [], daily: {} };
}

function writeAnalytics(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Track a search event
router.post("/api/analytics/track", checkAuthenticated, (req, res) => {
  const { query, engine, resultCount, duration } = req.body;

  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  const data = readAnalytics();
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().getHours();

  const entry = {
    userId: req.session.user.id,
    query: query.trim().toLowerCase(),
    engine: engine || "unknown",
    resultCount: resultCount || 0,
    duration: duration || 0,
    timestamp: new Date().toISOString(),
  };

  data.searches.push(entry);

  // Update daily stats
  if (!data.daily[today]) {
    data.daily[today] = { total: 0, byEngine: {}, byHour: {}, topQueries: {} };
  }
  const day = data.daily[today];
  day.total++;
  day.byEngine[engine || "unknown"] = (day.byEngine[engine || "unknown"] || 0) + 1;
  day.byHour[hour] = (day.byHour[hour] || 0) + 1;
  day.topQueries[entry.query] = (day.topQueries[entry.query] || 0) + 1;

  writeAnalytics(data);
  res.json({ success: true });
});

// Get overall stats
router.get("/api/analytics/stats", checkAuthenticated, (req, res) => {
  const data = readAnalytics();
  const userSearches = data.searches.filter((s) => s.userId === req.session.user.id);
  const totalSearches = userSearches.length;

  // Engine breakdown
  const byEngine = {};
  for (const s of userSearches) {
    byEngine[s.engine] = (byEngine[s.engine] || 0) + 1;
  }

  // Top queries
  const queryCount = {};
  for (const s of userSearches) {
    queryCount[s.query] = (queryCount[s.query] || 0) + 1;
  }
  const topQueries = Object.entries(queryCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([query, count]) => ({ query, count }));

  // Average results per search
  const avgResults =
    totalSearches > 0
      ? Math.round(userSearches.reduce((s, e) => s + (e.resultCount || 0), 0) / totalSearches)
      : 0;

  // Average duration
  const avgDuration =
    totalSearches > 0
      ? Math.round(userSearches.reduce((s, e) => s + (e.duration || 0), 0) / totalSearches)
      : 0;

  res.json({
    totalSearches,
    byEngine,
    topQueries,
    avgResults,
    avgDuration,
  });
});

// Get daily stats
router.get("/api/analytics/daily", checkAuthenticated, (req, res) => {
  const data = readAnalytics();
  const days = parseInt(req.query.days) || 7;
  const result = {};

  const dates = Object.keys(data.daily).sort().slice(-days);
  for (const date of dates) {
    result[date] = data.daily[date];
  }

  res.json(result);
});

// Get hourly distribution
router.get("/api/analytics/hourly", checkAuthenticated, (req, res) => {
  const data = readAnalytics();
  const userSearches = data.searches.filter((s) => s.userId === req.session.user.id);
  const hourly = new Array(24).fill(0);

  for (const s of userSearches) {
    const hour = new Date(s.timestamp).getHours();
    hourly[hour]++;
  }

  res.json({ hourly });
});

// Get search trends (last 30 days)
router.get("/api/analytics/trends", checkAuthenticated, (req, res) => {
  const data = readAnalytics();
  const userSearches = data.searches.filter((s) => s.userId === req.session.user.id);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const recent = userSearches.filter((s) => new Date(s.timestamp) >= thirtyDaysAgo);

  // Group by date
  const byDate = {};
  for (const s of recent) {
    const date = s.timestamp.slice(0, 10);
    byDate[date] = (byDate[date] || 0) + 1;
  }

  // Fill in missing dates
  const trends = [];
  const current = new Date(thirtyDaysAgo);
  while (current <= now) {
    const date = current.toISOString().slice(0, 10);
    trends.push({ date, count: byDate[date] || 0 });
    current.setDate(current.getDate() + 1);
  }

  res.json({ trends });
});

// Clear analytics data
router.delete("/api/analytics", checkAuthenticated, (req, res) => {
  writeAnalytics({ searches: [], daily: {} });
  res.json({ success: true });
});

export default router;
