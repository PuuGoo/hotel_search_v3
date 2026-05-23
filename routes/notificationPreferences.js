import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PREFS_FILE = path.join(__dirname, "..", "notification_preferences.json");

const router = Router();

const DEFAULT_PREFS = {
  priceAlerts: true,
  searchResults: true,
  systemNotifications: true,
  webhooks: true,
  scheduledSearches: true,
  emailDigest: false,
  digestFrequency: "daily", // daily, weekly, never
};

export function readNotifPrefs() {
  try {
    if (fs.existsSync(PREFS_FILE)) {
      return JSON.parse(fs.readFileSync(PREFS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading notification preferences:", e.message);
  }
  return {};
}

export function writeNotifPrefs(data) {
  fs.writeFileSync(PREFS_FILE, JSON.stringify(data, null, 2));
}

export function getUserNotifPrefs(userId) {
  const allPrefs = readNotifPrefs();
  return { ...DEFAULT_PREFS, ...(allPrefs[userId] || {}) };
}

// GET /api/notification-preferences — get current user's preferences
router.get("/api/notification-preferences", checkAuthenticated, (req, res) => {
  const prefs = getUserNotifPrefs(req.session.user.id);
  res.json({ preferences: prefs });
});

// PUT /api/notification-preferences — update current user's preferences
router.put("/api/notification-preferences", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { preferences } = req.body;

  if (!preferences || typeof preferences !== "object") {
    return res.status(400).json({ error: "Preferences object required" });
  }

  const allPrefs = readNotifPrefs();
  const current = { ...DEFAULT_PREFS, ...(allPrefs[userId] || {}) };

  // Update only known fields
  const allowedFields = Object.keys(DEFAULT_PREFS);
  for (const key of allowedFields) {
    if (preferences[key] !== undefined) {
      current[key] = preferences[key];
    }
  }

  // Validate digestFrequency
  if (!["daily", "weekly", "never"].includes(current.digestFrequency)) {
    current.digestFrequency = "daily";
  }

  allPrefs[userId] = current;
  writeNotifPrefs(allPrefs);

  res.json({ preferences: current });
});

// POST /api/notification-preferences/reset — reset to defaults
router.post("/api/notification-preferences/reset", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const allPrefs = readNotifPrefs();
  delete allPrefs[userId];
  writeNotifPrefs(allPrefs);

  res.json({ preferences: DEFAULT_PREFS });
});

export default router;
