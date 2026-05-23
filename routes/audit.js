import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkRole } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIT_FILE = path.join(__dirname, "..", "audit_log.json");
const MAX_AUDIT_ENTRIES = 500;

const router = Router();

function readAudit() {
  try {
    if (fs.existsSync(AUDIT_FILE)) {
      return JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading audit log:", e.message);
  }
  return [];
}

function writeAudit(entries) {
  fs.writeFileSync(AUDIT_FILE, JSON.stringify(entries, null, 2), "utf8");
}

// Exported helper to log actions from other modules
export function logAudit(action, details = {}) {
  try {
    const entries = readAudit();
    entries.unshift({
      id: Date.now(),
      action,
      userId: details.userId || null,
      username: details.username || null,
      ip: details.ip || null,
      target: details.target || null,
      detail: details.detail || null,
      timestamp: Date.now(),
    });
    if (entries.length > MAX_AUDIT_ENTRIES) {
      entries.length = MAX_AUDIT_ENTRIES;
    }
    writeAudit(entries);
  } catch (e) {
    console.error("Error writing audit log:", e.message);
  }
}

/**
 * @swagger
 * /api/admin/audit-log:
 *   get:
 *     summary: Get audit log
 *     description: Returns the audit log (admin only)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Max results to return
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action type
 *     responses:
 *       200:
 *         description: Audit log entries
 *       403:
 *         description: Not an admin
 */
router.get("/api/admin/audit-log", checkRole("admin"), (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_AUDIT_ENTRIES);
  const actionFilter = req.query.action;
  const search = req.query.search?.toLowerCase();
  const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom).getTime() : null;
  const dateTo = req.query.dateTo ? new Date(req.query.dateTo).getTime() + 86400000 : null;

  let entries = readAudit();

  if (actionFilter) {
    entries = entries.filter((e) => e.action === actionFilter);
  }

  if (search) {
    entries = entries.filter((e) =>
      (e.username || "").toLowerCase().includes(search) ||
      (e.action || "").toLowerCase().includes(search) ||
      (e.detail || "").toLowerCase().includes(search) ||
      (e.ip || "").includes(search)
    );
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

// Get unique action types for filter dropdown
router.get("/api/admin/audit-log/actions", checkRole("admin"), (_req, res) => {
  const entries = readAudit();
  const actions = [...new Set(entries.map((e) => e.action))].sort();
  res.json({ actions });
});

/**
 * @swagger
 * /api/admin/audit-log:
 *   delete:
 *     summary: Clear audit log
 *     description: Clear the audit log (admin only)
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Audit log cleared
 *       403:
 *         description: Not an admin
 */
/**
 * @swagger
 * /api/admin/audit-log/export:
 *   get:
 *     summary: Export audit log as CSV
 *     description: Downloads the audit log as a CSV file (admin only)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action type
 *     responses:
 *       200:
 *         description: CSV file download
 *       403:
 *         description: Not an admin
 */
router.get("/api/admin/audit-log/export", checkRole("admin"), (req, res) => {
  const actionFilter = req.query.action;

  let entries = readAudit();

  if (actionFilter) {
    entries = entries.filter((e) => e.action === actionFilter);
  }

  const escapeCsv = (val) => {
    const str = String(val ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = "ID,Action,Username,IP,Target,Detail,Timestamp";
  const rows = entries.map((e) =>
    [
      e.id,
      escapeCsv(e.action),
      escapeCsv(e.username),
      escapeCsv(e.ip),
      escapeCsv(e.target),
      escapeCsv(e.detail),
      new Date(e.timestamp).toISOString(),
    ].join(",")
  );

  const csv = [header, ...rows].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${Date.now()}.csv"`);
  res.send(csv);
});

router.delete("/api/admin/audit-log", checkRole("admin"), (req, res) => {
  writeAudit([]);
  logAudit("audit_log_cleared", {
    userId: req.session.user?.id,
    username: req.session.user?.username,
    ip: req.ip,
  });
  res.json({ success: true });
});

export default router;
