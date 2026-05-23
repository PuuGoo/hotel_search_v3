import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const DATA_FILES = {
  cache: path.join(__dirname, "..", "result_cache.json"),
  recentSearches: path.join(__dirname, "..", "recent_searches.json"),
  sharedSearches: path.join(__dirname, "..", "shared_searches.json"),
  analytics: path.join(__dirname, "..", "search_analytics.json"),
  notifications: path.join(__dirname, "..", "notifications.json"),
};

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
  }
  return null;
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Get cleanup stats
router.get("/api/cleanup/stats", checkAuthenticated, (_req, res) => {
  const stats = {
    cacheEntries: 0,
    cacheExpired: 0,
    recentSearches: 0,
    recentOlderThanWeek: 0,
    sharedSearches: 0,
    sharedExpired: 0,
    analyticsEntries: 0,
    analyticsDays: 0,
    notifications: 0,
    readNotifications: 0,
  };

  // Cache entries
  const cache = readJSON(DATA_FILES.cache);
  if (cache) {
    const entries = Object.values(cache);
    stats.cacheEntries = entries.length;
    const now = Date.now();
    stats.cacheExpired = entries.filter((e) => now - new Date(e.timestamp).getTime() > 3600000).length;
  }

  // Recent searches
  const recent = readJSON(DATA_FILES.recentSearches);
  if (Array.isArray(recent)) {
    stats.recentSearches = recent.length;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    stats.recentOlderThanWeek = recent.filter((r) => new Date(r.timestamp).getTime() < weekAgo).length;
  }

  // Shared searches
  const shared = readJSON(DATA_FILES.sharedSearches);
  if (Array.isArray(shared)) {
    stats.sharedSearches = shared.length;
    const now = new Date();
    stats.sharedExpired = shared.filter((s) => new Date(s.expiresAt) < now).length;
  }

  // Analytics
  const analytics = readJSON(DATA_FILES.analytics);
  if (analytics) {
    stats.analyticsEntries = (analytics.searches || []).length;
    stats.analyticsDays = Object.keys(analytics.daily || {}).length;
  }

  // Notifications
  const notifications = readJSON(DATA_FILES.notifications);
  if (Array.isArray(notifications)) {
    stats.notifications = notifications.length;
    stats.readNotifications = notifications.filter((n) => n.read).length;
  }

  res.json(stats);
});

// Clean expired cache entries
router.post("/api/cleanup/cache", checkAuthenticated, (_req, res) => {
  const cache = readJSON(DATA_FILES.cache);
  if (!cache) return res.json({ cleaned: 0 });

  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of Object.entries(cache)) {
    if (now - new Date(entry.timestamp).getTime() > 3600000) {
      delete cache[key];
      cleaned++;
    }
  }

  writeJSON(DATA_FILES.cache, cache);
  res.json({ cleaned });
});

// Clean old recent searches (older than 30 days)
router.post("/api/cleanup/recent", checkAuthenticated, (_req, res) => {
  const recent = readJSON(DATA_FILES.recentSearches);
  if (!Array.isArray(recent)) return res.json({ cleaned: 0 });

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const filtered = recent.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
  const cleaned = recent.length - filtered.length;

  writeJSON(DATA_FILES.recentSearches, filtered);
  res.json({ cleaned });
});

// Clean expired shared searches
router.post("/api/cleanup/shared", checkAuthenticated, (_req, res) => {
  const shared = readJSON(DATA_FILES.sharedSearches);
  if (!Array.isArray(shared)) return res.json({ cleaned: 0 });

  const now = new Date();
  const filtered = shared.filter((s) => new Date(s.expiresAt) >= now);
  const cleaned = shared.length - filtered.length;

  writeJSON(DATA_FILES.sharedSearches, filtered);
  res.json({ cleaned });
});

// Clean old analytics data (older than 90 days)
router.post("/api/cleanup/analytics", checkAuthenticated, (_req, res) => {
  const analytics = readJSON(DATA_FILES.analytics);
  if (!analytics) return res.json({ cleaned: 0 });

  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const originalCount = (analytics.searches || []).length;

  if (analytics.searches) {
    analytics.searches = analytics.searches.filter((s) => new Date(s.timestamp).getTime() >= cutoff);
  }

  // Clean old daily entries
  if (analytics.daily) {
    const cutoffDate = new Date(cutoff).toISOString().slice(0, 10);
    for (const date of Object.keys(analytics.daily)) {
      if (date < cutoffDate) delete analytics.daily[date];
    }
  }

  writeJSON(DATA_FILES.analytics, analytics);
  res.json({ cleaned: originalCount - (analytics.searches || []).length });
});

// Clean read notifications
router.post("/api/cleanup/notifications", checkAuthenticated, (req, res) => {
  const notifications = readJSON(DATA_FILES.notifications);
  if (!Array.isArray(notifications)) return res.json({ cleaned: 0 });

  const daysOld = parseInt(req.body.days) || 7;
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  const filtered = notifications.filter(
    (n) => !n.read || new Date(n.createdAt).getTime() >= cutoff
  );
  const cleaned = notifications.length - filtered.length;

  writeJSON(DATA_FILES.notifications, filtered);
  res.json({ cleaned });
});

// Run all cleanup
router.post("/api/cleanup/all", checkAuthenticated, async (_req, res) => {
  const results = {};

  // Cache
  const cache = readJSON(DATA_FILES.cache);
  if (cache) {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of Object.entries(cache)) {
      if (now - new Date(entry.timestamp).getTime() > 3600000) {
        delete cache[key];
        cleaned++;
      }
    }
    writeJSON(DATA_FILES.cache, cache);
    results.cache = cleaned;
  }

  // Recent searches
  const recent = readJSON(DATA_FILES.recentSearches);
  if (Array.isArray(recent)) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const filtered = recent.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
    writeJSON(DATA_FILES.recentSearches, filtered);
    results.recent = recent.length - filtered.length;
  }

  // Shared searches
  const shared = readJSON(DATA_FILES.sharedSearches);
  if (Array.isArray(shared)) {
    const now = new Date();
    const filtered = shared.filter((s) => new Date(s.expiresAt) >= now);
    writeJSON(DATA_FILES.sharedSearches, filtered);
    results.shared = shared.length - filtered.length;
  }

  // Analytics
  const analytics = readJSON(DATA_FILES.analytics);
  if (analytics) {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const originalCount = (analytics.searches || []).length;
    if (analytics.searches) {
      analytics.searches = analytics.searches.filter((s) => new Date(s.timestamp).getTime() >= cutoff);
    }
    if (analytics.daily) {
      const cutoffDate = new Date(cutoff).toISOString().slice(0, 10);
      for (const date of Object.keys(analytics.daily)) {
        if (date < cutoffDate) delete analytics.daily[date];
      }
    }
    writeJSON(DATA_FILES.analytics, analytics);
    results.analytics = originalCount - (analytics.searches || []).length;
  }

  // Read notifications
  const notifications = readJSON(DATA_FILES.notifications);
  if (Array.isArray(notifications)) {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const filtered = notifications.filter(
      (n) => !n.read || new Date(n.createdAt).getTime() >= cutoff
    );
    writeJSON(DATA_FILES.notifications, filtered);
    results.notifications = notifications.length - filtered.length;
  }

  const totalCleaned = Object.values(results).reduce((s, v) => s + v, 0);
  res.json({ success: true, totalCleaned, details: results });
});

export default router;
