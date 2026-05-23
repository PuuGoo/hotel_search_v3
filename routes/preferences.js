import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "user_preferences.json");

const router = Router();

function readPreferences() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading preferences:", e.message);
  }
  return [];
}

function writePreferences(prefs) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(prefs, null, 2));
}

const DEFAULT_PREFS = {
  defaultEngine: "tavily",
  resultsPerPage: 20,
  language: "vi",
  theme: "dark",
  autoSearch: false,
  showSnippets: true,
  sortBy: "relevance",
  safeSearch: false,
};

// Get user preferences
router.get("/api/preferences", checkAuthenticated, (req, res) => {
  const prefs = readPreferences();
  const userPrefs = prefs.find((p) => p.userId === req.session.user.id);
  res.json({ ...DEFAULT_PREFS, ...(userPrefs?.settings || {}) });
});

// Update user preferences
router.put("/api/preferences", checkAuthenticated, (req, res) => {
  const prefs = readPreferences();
  const idx = prefs.findIndex((p) => p.userId === req.session.user.id);
  const settings = req.body;

  // Validate known fields
  const validEngines = ["tavily", "google", "ddg"];
  if (settings.defaultEngine && !validEngines.includes(settings.defaultEngine)) {
    return res.status(400).json({ error: "Invalid engine" });
  }
  if (settings.resultsPerPage && (settings.resultsPerPage < 5 || settings.resultsPerPage > 100)) {
    return res.status(400).json({ error: "Results per page must be 5-100" });
  }
  if (settings.language && !["vi", "en"].includes(settings.language)) {
    return res.status(400).json({ error: "Invalid language" });
  }
  if (settings.theme && !["dark", "light", "system"].includes(settings.theme)) {
    return res.status(400).json({ error: "Invalid theme" });
  }

  const updatedSettings = { ...DEFAULT_PREFS };
  if (idx >= 0) {
    Object.assign(updatedSettings, prefs[idx].settings);
  }
  Object.assign(updatedSettings, settings);

  if (idx >= 0) {
    prefs[idx].settings = updatedSettings;
    prefs[idx].updatedAt = new Date().toISOString();
  } else {
    prefs.push({
      userId: req.session.user.id,
      settings: updatedSettings,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  writePreferences(prefs);
  res.json(updatedSettings);
});

// Reset preferences to defaults
router.delete("/api/preferences", checkAuthenticated, (req, res) => {
  const prefs = readPreferences();
  const idx = prefs.findIndex((p) => p.userId === req.session.user.id);
  if (idx >= 0) {
    prefs.splice(idx, 1);
    writePreferences(prefs);
  }
  res.json(DEFAULT_PREFS);
});

export default router;
