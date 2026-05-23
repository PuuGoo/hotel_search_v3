import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "data_retention.json");

const router = Router();

const DEFAULT_SETTINGS = {
  historyDays: 90,
  cacheHours: 1,
  recentSearchesDays: 30,
  sharedSearchesDays: 7,
  analyticsDays: 90,
  notificationsDays: 7,
  autoCleanup: false,
  cleanupIntervalHours: 24,
};

function readSettings() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      return data;
    }
  } catch (e) {
    console.error("Error reading retention settings:", e.message);
  }
  return {};
}

function writeSettings(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Get current retention settings
router.get("/api/data-retention", checkAuthenticated, (req, res) => {
  const allSettings = readSettings();
  const userId = req.session.user.id;
  const userSettings = allSettings[userId] || {};
  res.json({ ...DEFAULT_SETTINGS, ...userSettings });
});

// Update retention settings
router.put("/api/data-retention", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const allSettings = readSettings();

  const currentSettings = { ...DEFAULT_SETTINGS, ...(allSettings[userId] || {}) };
  const allowedKeys = Object.keys(DEFAULT_SETTINGS);

  for (const [key, value] of Object.entries(req.body)) {
    if (allowedKeys.includes(key)) {
      if (key === "autoCleanup") {
        currentSettings[key] = !!value;
      } else {
        const num = parseInt(value);
        if (!isNaN(num) && num >= 0) {
          currentSettings[key] = num;
        }
      }
    }
  }

  currentSettings.updatedAt = new Date().toISOString();
  allSettings[userId] = currentSettings;
  writeSettings(allSettings);

  res.json(currentSettings);
});

// Reset to defaults
router.delete("/api/data-retention", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const allSettings = readSettings();
  delete allSettings[userId];
  writeSettings(allSettings);
  res.json({ ...DEFAULT_SETTINGS });
});

// Preview what would be cleaned with current settings
router.get("/api/data-retention/preview", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const allSettings = readSettings();
  const settings = { ...DEFAULT_SETTINGS, ...(allSettings[userId] || {}) };

  const preview = {
    settings,
    wouldClean: {},
  };

  // Check cache
  const cacheFile = path.join(__dirname, "..", "result_cache.json");
  try {
    if (fs.existsSync(cacheFile)) {
      const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      const entries = Object.values(cache);
      const cutoff = Date.now() - settings.cacheHours * 3600000;
      preview.wouldClean.cache = entries.filter(
        (e) => new Date(e.timestamp).getTime() < cutoff
      ).length;
    }
  } catch {}

  // Check recent searches
  const recentFile = path.join(__dirname, "..", "recent_searches.json");
  try {
    if (fs.existsSync(recentFile)) {
      const recent = JSON.parse(fs.readFileSync(recentFile, "utf8"));
      if (Array.isArray(recent)) {
        const cutoff = Date.now() - settings.recentSearchesDays * 86400000;
        preview.wouldClean.recentSearches = recent.filter(
          (r) => new Date(r.timestamp).getTime() < cutoff
        ).length;
      }
    }
  } catch {}

  // Check shared searches
  const sharedFile = path.join(__dirname, "..", "shared_searches.json");
  try {
    if (fs.existsSync(sharedFile)) {
      const shared = JSON.parse(fs.readFileSync(sharedFile, "utf8"));
      if (Array.isArray(shared)) {
        const now = new Date();
        preview.wouldClean.sharedSearches = shared.filter(
          (s) => new Date(s.expiresAt) < now
        ).length;
      }
    }
  } catch {}

  // Check analytics
  const analyticsFile = path.join(__dirname, "..", "search_analytics.json");
  try {
    if (fs.existsSync(analyticsFile)) {
      const analytics = JSON.parse(fs.readFileSync(analyticsFile, "utf8"));
      const cutoff = Date.now() - settings.analyticsDays * 86400000;
      preview.wouldClean.analytics = (analytics.searches || []).filter(
        (s) => new Date(s.timestamp).getTime() < cutoff
      ).length;
    }
  } catch {}

  // Check notifications
  const notifFile = path.join(__dirname, "..", "notifications.json");
  try {
    if (fs.existsSync(notifFile)) {
      const notifs = JSON.parse(fs.readFileSync(notifFile, "utf8"));
      if (Array.isArray(notifs)) {
        const cutoff = Date.now() - settings.notificationsDays * 86400000;
        preview.wouldClean.notifications = notifs.filter(
          (n) => n.read && new Date(n.createdAt).getTime() < cutoff
        ).length;
      }
    }
  } catch {}

  res.json(preview);
});

// Run cleanup with current settings
router.post("/api/data-retention/cleanup", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const allSettings = readSettings();
  const settings = { ...DEFAULT_SETTINGS, ...(allSettings[userId] || {}) };

  const results = {};

  // Clean cache
  const cacheFile = path.join(__dirname, "..", "result_cache.json");
  try {
    if (fs.existsSync(cacheFile)) {
      const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      const cutoff = Date.now() - settings.cacheHours * 3600000;
      let cleaned = 0;
      for (const [key, entry] of Object.entries(cache)) {
        if (new Date(entry.timestamp).getTime() < cutoff) {
          delete cache[key];
          cleaned++;
        }
      }
      fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
      results.cache = cleaned;
    }
  } catch {}

  // Clean recent searches
  const recentFile = path.join(__dirname, "..", "recent_searches.json");
  try {
    if (fs.existsSync(recentFile)) {
      const recent = JSON.parse(fs.readFileSync(recentFile, "utf8"));
      if (Array.isArray(recent)) {
        const cutoff = Date.now() - settings.recentSearchesDays * 86400000;
        const filtered = recent.filter(
          (r) => new Date(r.timestamp).getTime() >= cutoff
        );
        fs.writeFileSync(recentFile, JSON.stringify(filtered, null, 2));
        results.recentSearches = recent.length - filtered.length;
      }
    }
  } catch {}

  // Clean shared searches
  const sharedFile = path.join(__dirname, "..", "shared_searches.json");
  try {
    if (fs.existsSync(sharedFile)) {
      const shared = JSON.parse(fs.readFileSync(sharedFile, "utf8"));
      if (Array.isArray(shared)) {
        const now = new Date();
        const filtered = shared.filter((s) => new Date(s.expiresAt) >= now);
        fs.writeFileSync(sharedFile, JSON.stringify(filtered, null, 2));
        results.sharedSearches = shared.length - filtered.length;
      }
    }
  } catch {}

  // Clean analytics
  const analyticsFile = path.join(__dirname, "..", "search_analytics.json");
  try {
    if (fs.existsSync(analyticsFile)) {
      const analytics = JSON.parse(fs.readFileSync(analyticsFile, "utf8"));
      const cutoff = Date.now() - settings.analyticsDays * 86400000;
      const originalCount = (analytics.searches || []).length;
      if (analytics.searches) {
        analytics.searches = analytics.searches.filter(
          (s) => new Date(s.timestamp).getTime() >= cutoff
        );
      }
      if (analytics.daily) {
        const cutoffDate = new Date(cutoff).toISOString().slice(0, 10);
        for (const date of Object.keys(analytics.daily)) {
          if (date < cutoffDate) delete analytics.daily[date];
        }
      }
      fs.writeFileSync(analyticsFile, JSON.stringify(analytics, null, 2));
      results.analytics = originalCount - (analytics.searches || []).length;
    }
  } catch {}

  // Clean notifications
  const notifFile = path.join(__dirname, "..", "notifications.json");
  try {
    if (fs.existsSync(notifFile)) {
      const notifs = JSON.parse(fs.readFileSync(notifFile, "utf8"));
      if (Array.isArray(notifs)) {
        const cutoff = Date.now() - settings.notificationsDays * 86400000;
        const filtered = notifs.filter(
          (n) => !n.read || new Date(n.createdAt).getTime() >= cutoff
        );
        fs.writeFileSync(notifFile, JSON.stringify(filtered, null, 2));
        results.notifications = notifs.length - filtered.length;
      }
    }
  } catch {}

  const totalCleaned = Object.values(results).reduce((s, v) => s + v, 0);
  res.json({ success: true, totalCleaned, details: results });
});

export default router;
