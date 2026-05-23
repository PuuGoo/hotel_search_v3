import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated, readUsers } from "../middleware/auth.js";
import { logAudit } from "./audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Data files that may contain user-specific data
const DATA_SOURCES = [
  { file: "search_history.json", key: "byUser" },
  { file: "bookmarks.json", key: "byUser" },
  { file: "saved_searches.json", key: "byUser" },
  { file: "price_alerts.json", key: "byUser" },
  { file: "search_templates.json", key: "byUser" },
  { file: "notifications.json", key: "byUser" },
  { file: "webhooks.json", key: "byUser" },
  { file: "scheduled_searches.json", key: "byUser" },
  { file: "user_preferences.json", key: "byUser" },
  { file: "recent_searches.json", key: "byUser" },
  { file: "starred_results.json", key: "byUser" },
  { file: "result_notes.json", key: "byUser" },
  { file: "search_tags.json", key: "byUser" },
  { file: "result_cache.json", key: "byUser" },
];

function readFileSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {
    // File may not exist or be invalid
  }
  return null;
}

// GET /api/gdpr/export — export all data for the authenticated user
router.get("/api/gdpr/export", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const username = req.session.user.username;

  const exportData = {
    exportDate: new Date().toISOString(),
    user: {
      id: userId,
      username,
      displayName: req.session.user.displayName,
      role: req.session.user.role,
    },
    data: {},
  };

  // Get user profile from users.json
  const users = readUsers();
  const userProfile = users.find((u) => u.id === userId);
  if (userProfile) {
    exportData.data.profile = {
      id: userProfile.id,
      username: userProfile.username,
      displayName: userProfile.displayName,
      role: userProfile.role,
      createdAt: userProfile.createdAt,
      // Exclude password hash
    };
  }

  // Extract user data from each source
  for (const source of DATA_SOURCES) {
    const filePath = path.join(__dirname, "..", source.file);
    const fileData = readFileSafe(filePath);

    if (!fileData) continue;

    // Handle different data structures
    if (source.key === "byUser" && fileData[userId]) {
      exportData.data[source.file.replace(".json", "")] = fileData[userId];
    } else if (Array.isArray(fileData)) {
      // Some files store data as arrays with userId field
      const userItems = fileData.filter((item) => item.userId === userId);
      if (userItems.length > 0) {
        exportData.data[source.file.replace(".json", "")] = userItems;
      }
    }
  }

  // Check audit log for user's actions
  const auditFile = path.join(__dirname, "..", "audit_log.json");
  const auditData = readFileSafe(auditFile);
  if (auditData && Array.isArray(auditData.entries)) {
    const userAudit = auditData.entries.filter((e) => e.userId === userId);
    if (userAudit.length > 0) {
      exportData.data.auditLog = userAudit.slice(0, 1000); // Cap at 1000
    }
  }

  // Check search history (may use different structure)
  const historyFile = path.join(__dirname, "..", "search_history.json");
  const historyData = readFileSafe(historyFile);
  if (historyData && historyData[userId]) {
    exportData.data.searchHistory = historyData[userId];
  }

  logAudit("gdpr_export", {
    userId,
    username,
    ip: req.ip,
    dataSources: Object.keys(exportData.data).length,
  });

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="gdpr-export-${username}-${Date.now()}.json"`);
  res.json(exportData);
});

// GET /api/gdpr/data-summary — summary of what data exists for the user
router.get("/api/gdpr/data-summary", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const summary = {};

  for (const source of DATA_SOURCES) {
    const filePath = path.join(__dirname, "..", source.file);
    const fileData = readFileSafe(filePath);

    if (!fileData) {
      summary[source.file] = { exists: false, count: 0 };
      continue;
    }

    if (source.key === "byUser" && fileData[userId]) {
      const items = fileData[userId];
      summary[source.file] = {
        exists: true,
        count: Array.isArray(items) ? items.length : Object.keys(items).length,
      };
    } else if (Array.isArray(fileData)) {
      const count = fileData.filter((item) => item.userId === userId).length;
      summary[source.file] = { exists: count > 0, count };
    } else {
      summary[source.file] = { exists: false, count: 0 };
    }
  }

  res.json({ summary });
});

// POST /api/gdpr/delete-account — delete all user data (right to be forgotten)
router.post("/api/gdpr/delete-account", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const username = req.session.user.username;
  const { confirm } = req.body;

  if (confirm !== username) {
    return res.status(400).json({ error: `Type your username "${username}" to confirm deletion` });
  }

  let deletedCount = 0;

  // Remove user data from all sources
  for (const source of DATA_SOURCES) {
    const filePath = path.join(__dirname, "..", source.file);
    const fileData = readFileSafe(filePath);

    if (!fileData) continue;

    if (source.key === "byUser" && fileData[userId]) {
      const count = Array.isArray(fileData[userId]) ? fileData[userId].length : 1;
      delete fileData[userId];
      fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));
      deletedCount += count;
    } else if (Array.isArray(fileData)) {
      const before = fileData.length;
      const filtered = fileData.filter((item) => item.userId !== userId);
      if (filtered.length !== before) {
        fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2));
        deletedCount += before - filtered.length;
      }
    }
  }

  // Remove from users.json
  const users = readUsers();
  const userIndex = users.findIndex((u) => u.id === userId);
  if (userIndex !== -1) {
    users.splice(userIndex, 1);
    const usersPath = path.join(__dirname, "..", "users.json");
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
  }

  logAudit("gdpr_delete_account", {
    userId,
    username,
    ip: req.ip,
    deletedDataItems: deletedCount,
  });

  // Destroy session
  req.session.destroy(() => {
    res.json({ success: true, message: "Account and all associated data deleted", deletedItems: deletedCount });
  });
});

// GET /api/gdpr/export-bundle — export all data as structured JSON bundle
router.get("/api/gdpr/export-bundle", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const username = req.session.user.username;

  const bundle = {
    manifest: {
      exportDate: new Date().toISOString(),
      version: "1.0",
      format: "hotel-search-data-bundle",
    },
    user: {
      id: userId,
      username,
      displayName: req.session.user.displayName,
      role: req.session.user.role,
    },
    sections: {},
  };

  // Get user profile
  const users = readUsers();
  const userProfile = users.find((u) => u.id === userId);
  if (userProfile) {
    bundle.sections.profile = {
      data: {
        id: userProfile.id,
        username: userProfile.username,
        displayName: userProfile.displayName,
        role: userProfile.role,
        createdAt: userProfile.createdAt,
      },
      count: 1,
    };
  }

  // Extract user data from each source
  let totalItems = 0;
  for (const source of DATA_SOURCES) {
    const filePath = path.join(__dirname, "..", source.file);
    const fileData = readFileSafe(filePath);
    if (!fileData) continue;

    let items = null;
    if (source.key === "byUser" && fileData[userId]) {
      items = fileData[userId];
    } else if (Array.isArray(fileData)) {
      items = fileData.filter((item) => item.userId === userId);
    }

    if (items && (Array.isArray(items) ? items.length > 0 : Object.keys(items).length > 0)) {
      const key = source.file.replace(".json", "");
      const count = Array.isArray(items) ? items.length : 1;
      bundle.sections[key] = { data: items, count };
      totalItems += count;
    }
  }

  // Audit log
  const auditFile = path.join(__dirname, "..", "audit_log.json");
  const auditData = readFileSafe(auditFile);
  if (auditData && Array.isArray(auditData.entries)) {
    const userAudit = auditData.entries.filter((e) => e.userId === userId);
    if (userAudit.length > 0) {
      bundle.sections.auditLog = { data: userAudit.slice(0, 1000), count: userAudit.length };
      totalItems += userAudit.length;
    }
  }

  bundle.manifest.totalItems = totalItems;
  bundle.manifest.sections = Object.keys(bundle.sections);

  logAudit("data_export_bundle", { userId, username, ip: req.ip, sections: bundle.manifest.sections.length });

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="data-bundle-${username}-${Date.now()}.json"`);
  res.json(bundle);
});

export default router;
