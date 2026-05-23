// API changelog viewer — visual changelog with version history

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "api_changelog.json");
const MAX_ENTRIES = 500;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { entries: [], versions: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Add a changelog entry.
 */
export function addEntry(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.entries) data.entries = [];

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    version: options.version || "unreleased",
    type: options.type, // "added", "changed", "deprecated", "removed", "fixed", "security"
    title: options.title,
    description: options.description || "",
    endpoint: options.endpoint || null,
    breaking: options.breaking || false,
    author: options.userId || "system",
    timestamp: Date.now(),
  };

  data.entries.unshift(entry);
  if (data.entries.length > MAX_ENTRIES) data.entries.length = MAX_ENTRIES;

  writeJSON(DATA_FILE, data);
  return entry;
}

/**
 * Get changelog entries.
 */
export function getEntries(options = {}) {
  const { version = null, type = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let entries = data.entries || [];

  if (version) entries = entries.filter((e) => e.version === version);
  if (type) entries = entries.filter((e) => e.type === type);

  return { entries: entries.slice(0, limit), total: entries.length };
}

/**
 * Get a specific entry.
 */
export function getEntry(entryId) {
  const data = readJSON(DATA_FILE);
  return (data.entries || []).find((e) => e.id === entryId) || null;
}

/**
 * Delete an entry.
 */
export function deleteEntry(entryId) {
  const data = readJSON(DATA_FILE);
  const index = (data.entries || []).findIndex((e) => e.id === entryId);
  if (index === -1) return false;

  data.entries.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Create a version release.
 */
export function createVersion(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.versions) data.versions = [];

  const version = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    version: options.version,
    name: options.name || "",
    description: options.description || "",
    releasedAt: options.releasedAt || Date.now(),
    breaking: options.breaking || false,
    author: options.userId || "system",
  };

  data.versions.unshift(version);
  writeJSON(DATA_FILE, data);
  return version;
}

/**
 * Get all versions.
 */
export function getVersions() {
  const data = readJSON(DATA_FILE);
  return data.versions || [];
}

/**
 * Get changelog grouped by version.
 */
export function getGroupedChangelog(limit = 10) {
  const data = readJSON(DATA_FILE);
  const entries = data.entries || [];
  const versions = data.versions || [];

  const grouped = {};
  for (const entry of entries) {
    if (!grouped[entry.version]) grouped[entry.version] = [];
    grouped[entry.version].push(entry);
  }

  const result = Object.entries(grouped)
    .slice(0, limit)
    .map(([version, changes]) => {
      const versionInfo = versions.find((v) => v.version === version);
      return {
        version,
        name: versionInfo?.name || "",
        releasedAt: versionInfo?.releasedAt || null,
        breaking: changes.some((c) => c.breaking),
        changes: {
          added: changes.filter((c) => c.type === "added"),
          changed: changes.filter((c) => c.type === "changed"),
          deprecated: changes.filter((c) => c.type === "deprecated"),
          removed: changes.filter((c) => c.type === "removed"),
          fixed: changes.filter((c) => c.type === "fixed"),
          security: changes.filter((c) => c.type === "security"),
        },
      };
    });

  return result;
}

/**
 * Get changelog statistics.
 */
export function getChangelogStats() {
  const data = readJSON(DATA_FILE);
  const entries = data.entries || [];
  const versions = data.versions || [];

  const typeCounts = {};
  for (const entry of entries) {
    typeCounts[entry.type] = (typeCounts[entry.type] || 0) + 1;
  }

  return {
    totalEntries: entries.length,
    totalVersions: versions.length,
    breakingChanges: entries.filter((e) => e.breaking).length,
    typeCounts,
  };
}

/**
 * Clear changelog data.
 */
export function clearChangelogData() {
  writeJSON(DATA_FILE, { entries: [], versions: [] });
}
