import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ACTIVITY_FILE = path.join(__dirname, "..", "user_activity.json");
const MAX_ENTRIES = 500;

const router = Router();

export function readActivity() {
  try {
    if (fs.existsSync(ACTIVITY_FILE)) {
      return JSON.parse(fs.readFileSync(ACTIVITY_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading user activity:", e.message);
  }
  return {};
}

export function writeActivity(data) {
  fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(data, null, 2));
}

export function logActivity(userId, action, details = {}) {
  try {
    const data = readActivity();
    if (!data[userId]) {
      data[userId] = [];
    }

    data[userId].unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      action,
      details,
      timestamp: Date.now(),
    });

    // Trim to max entries per user
    if (data[userId].length > MAX_ENTRIES) {
      data[userId].length = MAX_ENTRIES;
    }

    writeActivity(data);
  } catch (e) {
    console.error("Error logging activity:", e.message);
  }
}

// GET /api/activity — get current user's activity
router.get("/api/activity", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const action = req.query.action;

  const data = readActivity();
  let activities = data[userId] || [];

  if (action) {
    activities = activities.filter((a) => a.action === action);
  }

  const total = activities.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const paged = activities.slice(offset, offset + limit);

  res.json({
    activities: paged,
    total,
    page,
    limit,
    totalPages,
    hasMore: page < totalPages,
  });
});

// GET /api/activity/actions — list unique actions
router.get("/api/activity/actions", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const data = readActivity();
  const activities = data[userId] || [];
  const actions = [...new Set(activities.map((a) => a.action))].sort();
  res.json({ actions });
});

// GET /api/activity/stats — activity stats
router.get("/api/activity/stats", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const data = readActivity();
  const activities = data[userId] || [];

  const byAction = {};
  const byDay = {};
  const dayAgo = Date.now() - 86400000;
  const weekAgo = Date.now() - 7 * 86400000;

  for (const a of activities) {
    byAction[a.action] = (byAction[a.action] || 0) + 1;
    const day = new Date(a.timestamp).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  }

  const recentCount = activities.filter((a) => a.timestamp > dayAgo).length;
  const weekCount = activities.filter((a) => a.timestamp > weekAgo).length;

  res.json({
    total: activities.length,
    recentCount,
    weekCount,
    byAction,
    byDay,
  });
});

// DELETE /api/activity — clear own activity
router.delete("/api/activity", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const data = readActivity();
  delete data[userId];
  writeActivity(data);
  res.json({ success: true });
});

export default router;
