import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";
import { logAudit } from "./audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const IMPORTABLE_SOURCES = {
  searchHistory: { file: "search_history.json", merge: true },
  bookmarks: { file: "bookmarks.json", merge: true },
  savedSearches: { file: "saved_searches.json", merge: true },
  priceAlerts: { file: "price_alerts.json", merge: true },
  searchTemplates: { file: "search_templates.json", merge: true },
  webhooks: { file: "webhooks.json", merge: true },
  scheduledSearches: { file: "scheduled_searches.json", merge: true },
  preferences: { file: "user_preferences.json", merge: false }, // Overwrite
  recentSearches: { file: "recent_searches.json", merge: true },
  starredResults: { file: "starred_results.json", merge: true },
  resultNotes: { file: "result_notes.json", merge: true },
  searchTags: { file: "search_tags.json", merge: true },
};

function readFileSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {
    // File may not exist
  }
  return {};
}

// POST /api/import — import data from JSON
router.post("/api/import", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { data } = req.body;

  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "Data object required" });
  }

  const results = {};
  let totalImported = 0;

  // Import user data from each source
  for (const [key, config] of Object.entries(IMPORTABLE_SOURCES)) {
    const importData = data.data?.[key] || data[key];

    if (!importData) continue;

    const filePath = path.join(__dirname, "..", config.file);
    const existing = readFileSafe(filePath);

    if (config.merge) {
      // Merge with existing data
      if (!existing[userId]) {
        existing[userId] = Array.isArray(importData) ? [] : {};
      }

      if (Array.isArray(importData) && Array.isArray(existing[userId])) {
        // Merge arrays, deduplicate by URL or query
        const existingSet = new Set(
          existing[userId].map((item) => item.url || item.query || JSON.stringify(item))
        );
        let added = 0;
        for (const item of importData) {
          const key = item.url || item.query || JSON.stringify(item);
          if (!existingSet.has(key)) {
            existing[userId].push(item);
            existingSet.add(key);
            added++;
          }
        }
        results[key] = { imported: added, total: existing[userId].length };
        totalImported += added;
      } else if (typeof importData === "object" && !Array.isArray(importData)) {
        Object.assign(existing[userId], importData);
        results[key] = { imported: Object.keys(importData).length };
        totalImported += Object.keys(importData).length;
      }
    } else {
      // Overwrite
      existing[userId] = importData;
      results[key] = { imported: 1, overwritten: true };
      totalImported += 1;
    }

    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
  }

  logAudit("data_import", {
    userId,
    username: req.session.user.username,
    ip: req.ip,
    sources: Object.keys(results).length,
    totalImported,
  });

  res.json({ success: true, results, totalImported });
});

// GET /api/import/preview — preview what would be imported
router.post("/api/import/preview", checkAuthenticated, (req, res) => {
  const { data } = req.body;

  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "Data object required" });
  }

  const preview = {};

  for (const [key] of Object.entries(IMPORTABLE_SOURCES)) {
    const importData = data.data?.[key] || data[key];

    if (!importData) continue;

    if (Array.isArray(importData)) {
      preview[key] = { type: "array", count: importData.length };
    } else if (typeof importData === "object") {
      preview[key] = { type: "object", count: Object.keys(importData).length };
    }
  }

  res.json({ preview, totalSources: Object.keys(preview).length });
});

export default router;
