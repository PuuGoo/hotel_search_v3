// Backup scheduler — automated scheduled backups with retention
// Manages backup creation, rotation, and restoration

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, "..");
const BACKUP_DIR = path.join(ROOT, "backups");
const CONFIG_FILE = path.join(ROOT, "backup_config.json");

const DEFAULT_FILES = [
  "search_history.json",
  "bookmarks.json",
  "users.json",
  "search_templates.json",
  "price_alerts.json",
  "notifications.json",
  "audit_log.json",
  "feature_flags.json",
  "webhooks.json",
  "preferences.json",
];

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return null;
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

/**
 * Get backup configuration.
 */
export function getBackupConfig() {
  const config = readJSON(CONFIG_FILE);
  return {
    enabled: config?.enabled ?? true,
    maxBackups: config?.maxBackups ?? 10,
    files: config?.files ?? DEFAULT_FILES,
    intervalHours: config?.intervalHours ?? 24,
    lastBackup: config?.lastBackup ?? null,
    autoBackup: config?.autoBackup ?? true,
  };
}

/**
 * Update backup configuration.
 */
export function updateBackupConfig(updates) {
  const current = getBackupConfig();
  const config = { ...current, ...updates };
  writeJSON(CONFIG_FILE, config);
  return config;
}

/**
 * Create a backup.
 */
export function createBackup(name = null) {
  ensureBackupDir();

  const config = getBackupConfig();
  const timestamp = Date.now();
  const backupName = name || `backup_${new Date(timestamp).toISOString().replace(/[:.]/g, "-")}`;
  const backupDir = path.join(BACKUP_DIR, backupName);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backed = [];
  const errors = [];

  for (const file of config.files) {
    const srcPath = path.join(ROOT, file);
    const destPath = path.join(backupDir, file);

    try {
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        backed.push(file);
      } else {
        errors.push({ file, error: "File does not exist" });
      }
    } catch (err) {
      errors.push({ file, error: err.message });
    }
  }

  // Update config with last backup time
  updateBackupConfig({ lastBackup: timestamp });

  return {
    name: backupName,
    timestamp,
    filesBacked: backed.length,
    errors: errors.length,
    backed,
    errorDetails: errors,
  };
}

/**
 * List all backups.
 */
export function listBackups() {
  ensureBackupDir();

  const entries = fs.readdirSync(BACKUP_DIR, { withFileTypes: true });
  const backups = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const backupDir = path.join(BACKUP_DIR, entry.name);
    const files = fs.readdirSync(backupDir);
    let totalSize = 0;

    for (const file of files) {
      const stats = fs.statSync(path.join(backupDir, file));
      totalSize += stats.size;
    }

    backups.push({
      name: entry.name,
      files: files.length,
      size: totalSize,
      sizeFormatted: formatSize(totalSize),
      createdAt: extractTimestamp(entry.name),
    });
  }

  return backups.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * Delete a backup.
 */
export function deleteBackup(name) {
  const backupDir = path.join(BACKUP_DIR, name);

  if (!fs.existsSync(backupDir)) {
    return { deleted: false, error: "Backup not found" };
  }

  const files = fs.readdirSync(backupDir);
  for (const file of files) {
    fs.unlinkSync(path.join(backupDir, file));
  }
  fs.rmdirSync(backupDir);

  return { deleted: true, name, filesRemoved: files.length };
}

/**
 * Restore from a backup.
 */
export function restoreBackup(name) {
  const backupDir = path.join(BACKUP_DIR, name);

  if (!fs.existsSync(backupDir)) {
    return { success: false, error: "Backup not found" };
  }

  const files = fs.readdirSync(backupDir);
  const restoredFiles = [];
  const errors = [];

  for (const file of files) {
    const srcPath = path.join(backupDir, file);
    const destPath = path.join(ROOT, file);

    let copied = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.copyFileSync(srcPath, destPath);
        copied = true;
        break;
      } catch (err) {
        if (err.code === "EBUSY" || err.code === "EPERM") {
          const start = Date.now();
          while (Date.now() - start < 100) { /* busy wait */ }
          continue;
        }
        errors.push({ file, error: err.message });
        break;
      }
    }
    if (copied) restoredFiles.push(file);
    else if (!errors.some((e) => e.file === file)) {
      errors.push({ file, error: "Failed after retries (EBUSY)" });
    }
  }

  return {
    success: errors.length === 0,
    filesRestored: restoredFiles.length,
    errors: errors.length,
    restoredFiles,
    errorDetails: errors,
  };
}

/**
 * Auto-backup if enabled and interval has passed.
 */
export function autoBackup() {
  const config = getBackupConfig();

  if (!config.enabled || !config.autoBackup) {
    return { backed: false, reason: "Disabled" };
  }

  const now = Date.now();
  const intervalMs = config.intervalHours * 60 * 60 * 1000;

  if (config.lastBackup && (now - config.lastBackup) < intervalMs) {
    return { backed: false, reason: "Too soon", nextBackup: config.lastBackup + intervalMs };
  }

  // Rotate old backups
  const backups = listBackups();
  while (backups.length >= config.maxBackups) {
    const oldest = backups.pop();
    deleteBackup(oldest.name);
  }

  const result = createBackup();
  return { backed: true, ...result };
}

/**
 * Get backup statistics.
 */
export function getBackupStats() {
  const backups = listBackups();
  const config = getBackupConfig();

  const totalSize = backups.reduce((sum, b) => sum + b.size, 0);

  return {
    totalBackups: backups.length,
    maxBackups: config.maxBackups,
    totalSize,
    totalSizeFormatted: formatSize(totalSize),
    lastBackup: config.lastBackup,
    autoBackup: config.autoBackup,
    intervalHours: config.intervalHours,
    newestBackup: backups[0] || null,
    oldestBackup: backups[backups.length - 1] || null,
  };
}

function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function extractTimestamp(name) {
  const match = name.match(/backup_(.+)/);
  if (!match) return null;
  try {
    return new Date(match[1].replace(/-/g, (m, offset) => offset < 20 ? m : ":")).getTime();
  } catch {
    return null;
  }
}
