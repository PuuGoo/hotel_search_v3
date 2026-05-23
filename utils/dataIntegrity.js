// Data integrity validator — verify consistency across data files
// Checks for orphaned references, missing files, and data corruption

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const DATA_FILES = [
  "search_history.json",
  "bookmarks.json",
  "search_templates.json",
  "price_alerts.json",
  "notifications.json",
  "shared_searches.json",
  "audit_log.json",
  "users.json",
  "sessions.json",
  "feature_flags.json",
  "webhooks.json",
  "scheduled_searches.json",
  "comparison_history.json",
  "favorites_sync.json",
  "ranking_feedback.json",
  "search_ab_experiments.json",
  "search_ab_results.json",
  "prefetch_data.json",
  "autocomplete_dictionary.json",
  "url_health.json",
  "query_performance.json",
  "intelligent_cache.json",
];

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return null;
}

/**
 * Check if a JSON file is valid.
 */
export function validateFile(filePath) {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  const fileName = path.basename(filePath);

  if (!fs.existsSync(fullPath)) {
    return { file: fileName, exists: false, valid: false, error: "File does not exist" };
  }

  try {
    const content = fs.readFileSync(fullPath, "utf8");
    const data = JSON.parse(content);
    const size = Buffer.byteLength(content, "utf8");

    return {
      file: fileName,
      exists: true,
      valid: true,
      size,
      type: Array.isArray(data) ? "array" : typeof data,
      entries: Array.isArray(data) ? data.length : Object.keys(data).length,
    };
  } catch (err) {
    return {
      file: fileName,
      exists: true,
      valid: false,
      error: err.message,
    };
  }
}

/**
 * Validate all data files.
 */
export function validateAllFiles() {
  const results = [];
  let valid = 0;
  let invalid = 0;
  let missing = 0;

  for (const file of DATA_FILES) {
    const result = validateFile(file);
    results.push(result);
    if (result.valid) valid++;
    else if (result.exists) invalid++;
    else missing++;
  }

  return {
    total: DATA_FILES.length,
    valid,
    invalid,
    missing,
    results,
  };
}

/**
 * Check for orphaned references in bookmarks (URLs pointing to deleted shared searches).
 */
export function checkOrphanedReferences() {
  const issues = [];

  const bookmarks = readJSON(path.join(ROOT, "bookmarks.json"));
  const sharedSearches = readJSON(path.join(ROOT, "shared_searches.json"));

  if (bookmarks && typeof bookmarks === "object" && !Array.isArray(bookmarks)) {
    const sharedIds = new Set();
    if (sharedSearches && Array.isArray(sharedSearches)) {
      sharedSearches.forEach((s) => sharedIds.add(s.id));
    }

    for (const [userId, userBookmarks] of Object.entries(bookmarks)) {
      if (!Array.isArray(userBookmarks)) continue;
      for (const bookmark of userBookmarks) {
        if (bookmark.sharedSearchId && !sharedIds.has(bookmark.sharedSearchId)) {
          issues.push({
            type: "orphaned_reference",
            file: "bookmarks.json",
            userId,
            bookmark: bookmark.title || bookmark.url,
            reference: bookmark.sharedSearchId,
          });
        }
      }
    }
  }

  return { issues, count: issues.length };
}

/**
 * Check for data consistency issues.
 */
export function checkDataConsistency() {
  const issues = [];

  // Check if user references in history exist in users
  const history = readJSON(path.join(ROOT, "search_history.json"));
  const users = readJSON(path.join(ROOT, "users.json"));

  if (Array.isArray(history) && users && typeof users === "object") {
    const userIds = new Set();
    if (Array.isArray(users)) {
      users.forEach((u) => userIds.add(u.id));
    } else {
      Object.keys(users).forEach((id) => userIds.add(id));
    }

    const historyUserIds = new Set(history.filter((h) => h && h.userId).map((h) => h.userId));
    for (const userId of historyUserIds) {
      if (!userIds.has(userId)) {
        issues.push({
          type: "missing_user_reference",
          file: "search_history.json",
          userId,
          message: `History references user ${userId} not found in users`,
        });
      }
    }
  }

  // Check for null entries in arrays
  for (const file of DATA_FILES) {
    const data = readJSON(path.join(ROOT, file));
    if (Array.isArray(data)) {
      const nullCount = data.filter((item) => item === null || item === undefined).length;
      if (nullCount > 0) {
        issues.push({
          type: "null_entries",
          file,
          count: nullCount,
          message: `${file} contains ${nullCount} null/undefined entries`,
        });
      }
    }
  }

  return { issues, count: issues.length };
}

/**
 * Get overall data integrity report.
 */
export function getIntegrityReport() {
  const files = validateAllFiles();
  const orphaned = checkOrphanedReferences();
  const consistency = checkDataConsistency();

  const totalIssues = files.invalid + orphaned.count + consistency.count;

  return {
    status: totalIssues === 0 ? "healthy" : totalIssues < 5 ? "warning" : "critical",
    totalIssues,
    files: {
      total: files.total,
      valid: files.valid,
      invalid: files.invalid,
      missing: files.missing,
    },
    orphanedReferences: orphaned.count,
    consistencyIssues: consistency.count,
    details: {
      invalidFiles: files.results.filter((r) => !r.valid && r.exists),
      missingFiles: files.results.filter((r) => !r.exists),
      orphaned: orphaned.issues,
      consistency: consistency.issues,
    },
    checkedAt: Date.now(),
  };
}
