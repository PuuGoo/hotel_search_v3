import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");
const AUDIT_FILE = path.join(__dirname, "..", "audit_log.json");

const router = Router();

function readJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
  }
  return null;
}

/**
 * @swagger
 * /api/dashboard/stats:
 *   get:
 *     summary: Get user dashboard stats
 *     description: "Returns aggregated stats for the authenticated user: searches per engine, bookmark count, recent activity"
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics
 *       401:
 *         description: Not authenticated
 */
router.get("/api/dashboard/stats", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;

  // Search history stats
  const allHistory = readJson(HISTORY_FILE) || {};
  const userHistory = Array.isArray(allHistory[userId]) ? allHistory[userId] : [];

  const searchesByEngine = { tavily: 0, google: 0, ddg: 0 };
  let totalResults = 0;
  let searchesToday = 0;
  let searchesThisWeek = 0;

  for (const h of userHistory) {
    if (searchesByEngine[h.engine] !== undefined) {
      searchesByEngine[h.engine]++;
    }
    totalResults += h.resultCount || 0;
    if (now - h.timestamp < oneDay) searchesToday++;
    if (now - h.timestamp < oneWeek) searchesThisWeek++;
  }

  // Top queries (most frequent)
  const queryCounts = {};
  for (const h of userHistory) {
    const q = h.query?.toLowerCase().trim();
    if (q) {
      queryCounts[q] = (queryCounts[q] || 0) + 1;
    }
  }
  const topQueries = Object.entries(queryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([query, count]) => ({ query, count }));

  // Bookmarks stats
  const allBookmarks = readJson(BOOKMARKS_FILE) || {};
  const userBookmarks = allBookmarks[userId] || [];

  const bookmarksByEngine = { tavily: 0, google: 0, ddg: 0 };
  const tagCounts = {};

  for (const b of userBookmarks) {
    if (bookmarksByEngine[b.engine] !== undefined) {
      bookmarksByEngine[b.engine]++;
    }
    for (const t of b.tags || []) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }

  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  // Recent activity timeline (last 20 actions from audit log)
  const auditEntries = readJson(AUDIT_FILE) || [];
  const recentActivity = auditEntries
    .filter((e) => e.userId === userId)
    .slice(0, 20)
    .map((e) => ({
      action: e.action,
      target: e.target,
      timestamp: e.timestamp,
    }));

  // Recent search history (last 20 entries)
  const recentSearches = userHistory
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 20)
    .map((h) => ({
      query: h.query,
      engine: h.engine,
      resultCount: h.resultCount,
      timestamp: h.timestamp,
    }));

  res.json({
    searches: {
      total: userHistory.length,
      today: searchesToday,
      thisWeek: searchesThisWeek,
      totalResults,
      byEngine: searchesByEngine,
      topQueries,
    },
    bookmarks: {
      total: userBookmarks.length,
      byEngine: bookmarksByEngine,
      topTags,
    },
    recentActivity,
    recentSearches,
    generatedAt: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/admin/dashboard/overview:
 *   get:
 *     summary: Get admin dashboard overview
 *     description: Returns system-wide stats (admin only)
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Admin dashboard overview
 *       403:
 *         description: Not an admin
 */
router.get("/api/admin/dashboard/overview", checkRole("admin"), (req, res) => {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;

  // System-wide search stats
  const allHistory = readJson(HISTORY_FILE) || {};
  let totalSearches = 0;
  let searchesToday = 0;
  let searchesThisWeek = 0;
  const engineTotals = { tavily: 0, google: 0, ddg: 0 };
  const activeUsers = new Set();

  for (const [userId, entries] of Object.entries(allHistory)) {
    totalSearches += entries.length;
    if (entries.length > 0) activeUsers.add(userId);
    for (const h of entries) {
      if (engineTotals[h.engine] !== undefined) {
        engineTotals[h.engine]++;
      }
      if (now - h.timestamp < oneDay) searchesToday++;
      if (now - h.timestamp < oneWeek) searchesThisWeek++;
    }
  }

  // System-wide bookmark stats
  const allBookmarks = readJson(BOOKMARKS_FILE) || {};
  let totalBookmarks = 0;
  const bookmarkUsers = new Set();

  for (const [userId, entries] of Object.entries(allBookmarks)) {
    totalBookmarks += entries.length;
    if (entries.length > 0) bookmarkUsers.add(userId);
  }

  // Recent audit actions
  const auditEntries = readJson(AUDIT_FILE) || [];
  const recentActions = auditEntries.slice(0, 20).map((e) => ({
    action: e.action,
    username: e.username,
    target: e.target,
    timestamp: e.timestamp,
  }));

  res.json({
    system: {
      totalSearches,
      searchesToday,
      searchesThisWeek,
      totalBookmarks,
      activeSearchUsers: activeUsers.size,
      activeBookmarkUsers: bookmarkUsers.size,
      byEngine: engineTotals,
    },
    recentActions,
    generatedAt: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/dashboard/search-statistics:
 *   get:
 *     summary: Get search history statistics
 *     description: Returns time-series data for search patterns over time
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Number of days to look back (1-90)
 *     responses:
 *       200:
 *         description: Search statistics with time-series data
 *       401:
 *         description: Not authenticated
 */
router.get("/api/dashboard/search-statistics", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  const allHistory = readJson(HISTORY_FILE) || {};
  const userHistory = Array.isArray(allHistory[userId]) ? allHistory[userId] : [];

  // Searches per day (last N days)
  const dailySearches = [];
  const dailyByEngine = {};
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = new Date(now - i * oneDay);
    const dateStr = dayStart.toISOString().slice(0, 10);
    dailySearches.push({ date: dateStr, total: 0 });
    dailyByEngine[dateStr] = { tavily: 0, google: 0, ddg: 0 };
  }

  // Busiest hours (0-23)
  const hourDistribution = new Array(24).fill(0);

  // Day of week distribution (0=Sun, 6=Sat)
  const dayOfWeekDistribution = new Array(7).fill(0);

  // Query length stats
  let totalQueryLength = 0;
  let queryCount = 0;

  for (const h of userHistory) {
    const age = now - h.timestamp;
    if (age > days * oneDay) continue;

    const dateStr = new Date(h.timestamp).toISOString().slice(0, 10);
    const dayEntry = dailySearches.find((d) => d.date === dateStr);
    if (dayEntry) {
      dayEntry.total++;
    }

    if (dailyByEngine[dateStr] && dailyByEngine[dateStr][h.engine] !== undefined) {
      dailyByEngine[dateStr][h.engine]++;
    }

    const hour = new Date(h.timestamp).getHours();
    hourDistribution[hour]++;

    const dow = new Date(h.timestamp).getDay();
    dayOfWeekDistribution[dow]++;

    if (h.query) {
      totalQueryLength += h.query.length;
      queryCount++;
    }
  }

  // Search streak (consecutive days with at least 1 search, counting backwards from today)
  let streak = 0;
  for (let i = 0; i < days; i++) {
    const dateStr = new Date(now - i * oneDay).toISOString().slice(0, 10);
    const entry = dailySearches.find((d) => d.date === dateStr);
    if (entry && entry.total > 0) {
      streak++;
    } else {
      break;
    }
  }

  // Searches per week (aggregate daily into weeks)
  const weeklySearches = [];
  for (let i = 0; i < Math.ceil(days / 7); i++) {
    const weekStart = days - 1 - i * 7;
    const weekEnd = Math.max(weekStart - 6, 0);
    let weekTotal = 0;
    for (let j = weekStart; j >= weekEnd; j--) {
      const dayEntry = dailySearches[dailySearches.length - 1 - (days - 1 - j)];
      if (dayEntry) weekTotal += dayEntry.total;
    }
    const weekStartDate = new Date(now - weekStart * oneDay).toISOString().slice(0, 10);
    weeklySearches.unshift({ weekStart: weekStartDate, total: weekTotal });
  }

  // Engine totals for the period
  const engineTotals = { tavily: 0, google: 0, ddg: 0 };
  for (const d of Object.values(dailyByEngine)) {
    for (const [engine, count] of Object.entries(d)) {
      engineTotals[engine] += count;
    }
  }

  res.json({
    period: { days, from: new Date(now - days * oneDay).toISOString(), to: new Date(now).toISOString() },
    summary: {
      total: userHistory.filter((h) => now - h.timestamp < days * oneDay).length,
      streak,
      avgQueryLength: queryCount > 0 ? Math.round(totalQueryLength / queryCount) : 0,
      byEngine: engineTotals,
    },
    dailySearches,
    dailyByEngine,
    weeklySearches,
    hourDistribution,
    dayOfWeekDistribution,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
