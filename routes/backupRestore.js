import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import { logAudit } from "./audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUP_DIR = path.join(__dirname, "..", "backups");

const router = Router();

const DATA_FILES = [
  "users.json",
  "bookmarks.json",
  "search_history.json",
  "audit_log.json",
  "search_tags.json",
  "webhooks.json",
  "scheduled_searches.json",
  "notifications.json",
  "user_preferences.json",
  "starred_results.json",
  "result_cache.json",
  "shared_searches.json",
  "search_analytics.json",
  "recent_searches.json",
  "search_templates.json",
  "price_alerts.json",
  "api_keys.json",
  "data_retention.json",
];

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// GET /api/admin/backup — create a backup
router.get("/api/admin/backup", checkAuthenticated, checkRole("admin"), (req, res) => {
  const dataDir = path.join(__dirname, "..");
  const backup = {
    version: 1,
    timestamp: new Date().toISOString(),
    createdBy: req.session.user?.username,
    files: {},
  };

  let fileCount = 0;
  for (const file of DATA_FILES) {
    const filePath = path.join(dataDir, file);
    if (fs.existsSync(filePath)) {
      try {
        backup.files[file] = JSON.parse(fs.readFileSync(filePath, "utf8"));
        fileCount++;
      } catch (e) {
        console.error(`Error reading ${file}:`, e.message);
      }
    }
  }

  // Save to backups directory
  ensureBackupDir();
  const filename = `backup-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  const backupPath = path.join(BACKUP_DIR, filename);
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

  logAudit("backup_created", {
    userId: req.session.user?.id,
    username: req.session.user?.username,
    ip: req.ip,
    detail: `${fileCount} files backed up`,
  });

  // Return the backup data for download
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.json(backup);
});

// GET /api/admin/backups — list saved backups
router.get("/api/admin/backups", checkAuthenticated, checkRole("admin"), (_req, res) => {
  ensureBackupDir();

  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const filePath = path.join(BACKUP_DIR, f);
      const stats = fs.statSync(filePath);
      return {
        filename: f,
        size: stats.size,
        createdAt: stats.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ backups: files });
});

// POST /api/admin/restore — restore from backup
router.post("/api/admin/restore", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { backup, selective } = req.body;

  if (!backup || !backup.files || typeof backup.files !== "object") {
    return res.status(400).json({ error: "Invalid backup data" });
  }

  const dataDir = path.join(__dirname, "..");
  let restored = 0;
  let skipped = 0;
  const results = {};

  // If selective, only restore specified files
  const filesToRestore = selective && Array.isArray(selective)
    ? selective.filter((f) => backup.files[f])
    : Object.keys(backup.files);

  for (const file of filesToRestore) {
    if (!DATA_FILES.includes(file)) {
      results[file] = "skipped (not a data file)";
      skipped++;
      continue;
    }

    try {
      const filePath = path.join(dataDir, file);
      fs.writeFileSync(filePath, JSON.stringify(backup.files[file], null, 2));
      results[file] = "restored";
      restored++;
    } catch (e) {
      results[file] = `error: ${e.message}`;
    }
  }

  logAudit("backup_restored", {
    userId: req.session.user?.id,
    username: req.session.user?.username,
    ip: req.ip,
    detail: `Restored ${restored}, skipped ${skipped}`,
  });

  res.json({
    success: true,
    restored,
    skipped,
    results,
    timestamp: new Date().toISOString(),
  });
});

// DELETE /api/admin/backups/:filename — delete a backup
router.delete("/api/admin/backups/:filename", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { filename } = req.params;

  // Sanitize filename to prevent path traversal
  const safeFilename = path.basename(filename);
  const backupPath = path.join(BACKUP_DIR, safeFilename);

  if (!fs.existsSync(backupPath)) {
    return res.status(404).json({ error: "Backup not found" });
  }

  fs.unlinkSync(backupPath);

  logAudit("backup_deleted", {
    userId: req.session.user?.id,
    username: req.session.user?.username,
    ip: req.ip,
    detail: `Deleted: ${safeFilename}`,
  });

  res.json({ success: true });
});

// GET /api/admin/backup/download/:filename — download a saved backup
router.get("/api/admin/backup/download/:filename", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { filename } = req.params;
  const safeFilename = path.basename(filename);
  const backupPath = path.join(BACKUP_DIR, safeFilename);

  if (!fs.existsSync(backupPath)) {
    return res.status(404).json({ error: "Backup not found" });
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
  res.sendFile(backupPath);
});

export default router;
