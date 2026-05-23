import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const DATA_FILES = {
  templates: path.join(__dirname, "..", "search_templates.json"),
  alerts: path.join(__dirname, "..", "price_alerts.json"),
  webhooks: path.join(__dirname, "..", "webhooks.json"),
  scheduled: path.join(__dirname, "..", "scheduled_searches.json"),
};

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
  }
  return [];
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function filterUserItems(items, userId) {
  return items.filter((item) => item.userId === userId);
}

// Export all user data
router.get("/api/bulk/export", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const types = req.query.types ? req.query.types.split(",") : Object.keys(DATA_FILES);

  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    userId,
    data: {},
  };

  for (const type of types) {
    if (DATA_FILES[type]) {
      const allItems = readJSON(DATA_FILES[type]);
      exportData.data[type] = filterUserItems(allItems, userId);
    }
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="hotel-search-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(exportData);
});

// Import data
router.post("/api/bulk/import", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { data, overwrite } = req.body;

  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "Invalid import data" });
  }

  const results = {};

  for (const [type, items] of Object.entries(data)) {
    if (!DATA_FILES[type] || !Array.isArray(items)) continue;

    const existing = readJSON(DATA_FILES[type]);
    const otherUsers = existing.filter((item) => item.userId !== userId);
    const imported = items.map((item) => ({
      ...item,
      userId,
      id: overwrite && item.id ? item.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      importedAt: new Date().toISOString(),
    }));

    if (overwrite) {
      // Replace all user items
      writeJSON(DATA_FILES[type], [...otherUsers, ...imported]);
    } else {
      // Append
      writeJSON(DATA_FILES[type], [...existing, ...imported]);
    }

    results[type] = imported.length;
  }

  res.json({ success: true, imported: results });
});

// Get import/export stats
router.get("/api/bulk/stats", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const stats = {};

  for (const [type, filePath] of Object.entries(DATA_FILES)) {
    const allItems = readJSON(filePath);
    stats[type] = filterUserItems(allItems, userId).length;
  }

  res.json(stats);
});

// Clear all user data for a type
router.delete("/api/bulk/:type", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { type } = req.params;

  if (!DATA_FILES[type]) {
    return res.status(400).json({ error: "Invalid data type" });
  }

  const existing = readJSON(DATA_FILES[type]);
  const otherUsers = existing.filter((item) => item.userId !== userId);
  writeJSON(DATA_FILES[type], otherUsers);

  res.json({ success: true, deleted: existing.length - otherUsers.length });
});

export default router;
