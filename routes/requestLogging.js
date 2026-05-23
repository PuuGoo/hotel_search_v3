import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.join(__dirname, "..", "request_log.json");
const MAX_ENTRIES = 1000;

const router = Router();

export function readRequestLog() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      return JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading request log:", e.message);
  }
  return { entries: [] };
}

export function writeRequestLog(data) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(data, null, 2));
}

export function logRequest(info) {
  try {
    const data = readRequestLog();
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      method: info.method,
      path: info.path,
      statusCode: info.statusCode,
      duration: info.duration,
      userId: info.userId || null,
      username: info.username || null,
      ip: info.ip || null,
      userAgent: info.userAgent || null,
      timestamp: Date.now(),
    };

    data.entries.unshift(entry);
    if (data.entries.length > MAX_ENTRIES) {
      data.entries.length = MAX_ENTRIES;
    }

    writeRequestLog(data);
  } catch (e) {
    console.error("Error writing request log:", e.message);
  }
}

// GET /api/admin/request-log — list logged requests
router.get("/api/admin/request-log", checkAuthenticated, checkRole("admin"), (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_ENTRIES);
  const search = req.query.search?.toLowerCase();
  const method = req.query.method?.toUpperCase();
  const statusCode = req.query.statusCode ? parseInt(req.query.statusCode) : null;
  const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom).getTime() : null;
  const dateTo = req.query.dateTo ? new Date(req.query.dateTo).getTime() + 86400000 : null;

  const data = readRequestLog();
  let entries = data.entries;

  if (search) {
    entries = entries.filter((e) =>
      (e.path || "").toLowerCase().includes(search) ||
      (e.username || "").toLowerCase().includes(search)
    );
  }

  if (method) {
    entries = entries.filter((e) => e.method === method);
  }

  if (statusCode) {
    entries = entries.filter((e) => e.statusCode === statusCode);
  }

  if (dateFrom) {
    entries = entries.filter((e) => e.timestamp >= dateFrom);
  }
  if (dateTo) {
    entries = entries.filter((e) => e.timestamp <= dateTo);
  }

  const total = entries.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const paged = entries.slice(offset, offset + limit);

  res.json({
    entries: paged,
    total,
    page,
    limit,
    totalPages,
    hasMore: page < totalPages,
  });
});

// GET /api/admin/request-log/stats — request stats
router.get("/api/admin/request-log/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const data = readRequestLog();
  const entries = data.entries || [];

  const byMethod = {};
  const byStatus = {};
  let totalDuration = 0;
  let slowest = null;

  for (const e of entries) {
    byMethod[e.method] = (byMethod[e.method] || 0) + 1;
    const bucket = Math.floor((e.statusCode || 0) / 100) + "xx";
    byStatus[bucket] = (byStatus[bucket] || 0) + 1;
    totalDuration += e.duration || 0;
    if (!slowest || (e.duration || 0) > (slowest.duration || 0)) {
      slowest = e;
    }
  }

  const dayAgo = Date.now() - 86400000;
  const recentCount = entries.filter((e) => e.timestamp > dayAgo).length;

  res.json({
    total: entries.length,
    recentCount,
    avgDuration: entries.length ? Math.round(totalDuration / entries.length) : 0,
    slowest: slowest ? { path: slowest.path, duration: slowest.duration, method: slowest.method } : null,
    byMethod,
    byStatus,
  });
});

// DELETE /api/admin/request-log — clear log
router.delete("/api/admin/request-log", checkAuthenticated, checkRole("admin"), (_req, res) => {
  writeRequestLog({ entries: [] });
  res.json({ success: true });
});

export default router;
