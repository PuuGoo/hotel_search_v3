import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ERROR_FILE = path.join(__dirname, "..", "error_log.json");
const MAX_ERRORS = 500;

const router = Router();

function readErrors() {
  try {
    if (fs.existsSync(ERROR_FILE)) {
      return JSON.parse(fs.readFileSync(ERROR_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading error log:", e.message);
  }
  return { errors: [], stats: {} };
}

function writeErrors(data) {
  fs.writeFileSync(ERROR_FILE, JSON.stringify(data, null, 2));
}

// Exported helper to log errors from anywhere
export function logError(error, context = {}) {
  try {
    const data = readErrors();

    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      message: error.message || String(error),
      stack: error.stack || null,
      code: error.code || null,
      statusCode: context.statusCode || 500,
      path: context.path || null,
      method: context.method || null,
      userId: context.userId || null,
      username: context.username || null,
      ip: context.ip || null,
      userAgent: context.userAgent || null,
      timestamp: Date.now(),
    };

    data.errors.unshift(entry);

    // Trim to max
    if (data.errors.length > MAX_ERRORS) {
      data.errors.length = MAX_ERRORS;
    }

    // Update stats
    const errorKey = entry.message.slice(0, 100);
    if (!data.stats[errorKey]) {
      data.stats[errorKey] = { count: 0, firstSeen: entry.timestamp, lastSeen: entry.timestamp };
    }
    data.stats[errorKey].count++;
    data.stats[errorKey].lastSeen = entry.timestamp;

    // Trim stats to top 100
    const sortedStats = Object.entries(data.stats)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 100);
    data.stats = Object.fromEntries(sortedStats);

    writeErrors(data);
  } catch (e) {
    console.error("Error writing error log:", e.message);
  }
}

// GET /api/admin/errors — list errors with pagination and filtering
router.get("/api/admin/errors", checkAuthenticated, checkRole("admin"), (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_ERRORS);
  const search = req.query.search?.toLowerCase();
  const statusCode = req.query.statusCode ? parseInt(req.query.statusCode) : null;
  const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom).getTime() : null;
  const dateTo = req.query.dateTo ? new Date(req.query.dateTo).getTime() + 86400000 : null;

  const data = readErrors();
  let errors = data.errors;

  if (search) {
    errors = errors.filter((e) =>
      (e.message || "").toLowerCase().includes(search) ||
      (e.path || "").toLowerCase().includes(search) ||
      (e.username || "").toLowerCase().includes(search)
    );
  }

  if (statusCode) {
    errors = errors.filter((e) => e.statusCode === statusCode);
  }

  if (dateFrom) {
    errors = errors.filter((e) => e.timestamp >= dateFrom);
  }
  if (dateTo) {
    errors = errors.filter((e) => e.timestamp <= dateTo);
  }

  const total = errors.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const paged = errors.slice(offset, offset + limit);

  res.json({
    errors: paged,
    total,
    page,
    limit,
    totalPages,
    hasMore: page < totalPages,
  });
});

// GET /api/admin/errors/stats — error frequency stats
router.get("/api/admin/errors/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const data = readErrors();

  const stats = Object.entries(data.stats || {}).map(([message, info]) => ({
    message,
    count: info.count,
    firstSeen: info.firstSeen,
    lastSeen: info.lastSeen,
  })).sort((a, b) => b.count - a.count);

  // Recent errors count (last 24h)
  const dayAgo = Date.now() - 86400000;
  const recentCount = (data.errors || []).filter((e) => e.timestamp > dayAgo).length;

  // Errors by status code
  const byStatus = {};
  for (const e of data.errors || []) {
    const code = e.statusCode || 500;
    byStatus[code] = (byStatus[code] || 0) + 1;
  }

  res.json({
    total: (data.errors || []).length,
    recentCount,
    topErrors: stats.slice(0, 20),
    byStatus,
  });
});

// DELETE /api/admin/errors — clear error log
router.delete("/api/admin/errors", checkAuthenticated, checkRole("admin"), (req, res) => {
  writeErrors({ errors: [], stats: {} });
  res.json({ success: true });
});

// POST /api/admin/errors/report — client-side error reporting
router.post("/api/admin/errors/report", checkAuthenticated, (req, res) => {
  const { message, stack, path: errPath } = req.body;

  if (!message) {
    return res.status(400).json({ error: "message required" });
  }

  logError(new Error(message), {
    path: errPath || req.headers.referer,
    method: "CLIENT",
    userId: req.session.user?.id,
    username: req.session.user?.username,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });

  res.json({ success: true });
});

export default router;
