// API changelog tracking — track API changes and deprecations
// Maintains a log of API changes, deprecations, and version history

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
  return { entries: [], deprecations: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Add a changelog entry.
 */
export function addEntry(entry) {
  const data = readJSON(DATA_FILE);
  if (!data.entries) data.entries = [];
  if (!data.deprecations) data.deprecations = [];

  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: entry.type || "change", // change, addition, removal, fix
    endpoint: entry.endpoint || null,
    title: entry.title || "",
    description: entry.description || "",
    version: entry.version || "unreleased",
    breaking: entry.breaking || false,
    author: entry.author || "system",
    timestamp: Date.now(),
  };

  data.entries.unshift(record);

  if (data.entries.length > MAX_ENTRIES) {
    data.entries.length = MAX_ENTRIES;
  }

  writeJSON(DATA_FILE, data);
  return record;
}

/**
 * Get changelog entries with optional filtering.
 */
export function getEntries(options = {}) {
  const { type = null, endpoint = null, version = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let entries = data.entries || [];

  if (type) entries = entries.filter((e) => e.type === type);
  if (endpoint) entries = entries.filter((e) => e.endpoint && e.endpoint.includes(endpoint));
  if (version) entries = entries.filter((e) => e.version === version);

  return {
    entries: entries.slice(0, limit),
    total: entries.length,
  };
}

/**
 * Get a specific changelog entry by ID.
 */
export function getEntry(id) {
  const data = readJSON(DATA_FILE);
  return (data.entries || []).find((e) => e.id === id) || null;
}

/**
 * Add a deprecation notice.
 */
export function addDeprecation(entry) {
  const data = readJSON(DATA_FILE);
  if (!data.entries) data.entries = [];
  if (!data.deprecations) data.deprecations = [];

  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    endpoint: entry.endpoint,
    reason: entry.reason || "",
    removedIn: entry.removedIn || "TBD",
    alternative: entry.entry || null,
    deprecatedAt: Date.now(),
    sunsetDate: entry.sunsetDate || null,
  };

  data.deprecations.unshift(record);

  // Also add as changelog entry
  addEntry({
    type: "deprecation",
    endpoint: entry.endpoint,
    title: `Deprecated: ${entry.endpoint}`,
    description: entry.reason || "Endpoint deprecated",
    breaking: false,
  });

  writeJSON(DATA_FILE, data);
  return record;
}

/**
 * Get deprecation notices.
 */
export function getDeprecations(options = {}) {
  const { active = true } = options;
  const data = readJSON(DATA_FILE);
  const deprecations = data.deprecations || [];

  if (active) {
    const now = Date.now();
    return {
      deprecations: deprecations.filter((d) => !d.sunsetDate || new Date(d.sunsetDate).getTime() > now),
      total: deprecations.length,
    };
  }

  return { deprecations, total: deprecations.length };
}

/**
 * Check if an endpoint is deprecated.
 */
export function isDeprecated(endpoint) {
  const data = readJSON(DATA_FILE);
  return (data.deprecations || []).some((d) => d.endpoint === endpoint);
}

/**
 * Get changelog statistics.
 */
export function getChangelogStats() {
  const data = readJSON(DATA_FILE);
  const entries = data.entries || [];
  const deprecations = data.deprecations || [];

  const typeCounts = {};
  for (const entry of entries) {
    typeCounts[entry.type] = (typeCounts[entry.type] || 0) + 1;
  }

  const versionCounts = {};
  for (const entry of entries) {
    versionCounts[entry.version] = (versionCounts[entry.version] || 0) + 1;
  }

  const breakingChanges = entries.filter((e) => e.breaking).length;

  return {
    totalEntries: entries.length,
    totalDeprecations: deprecations.length,
    breakingChanges,
    byType: typeCounts,
    byVersion: versionCounts,
  };
}

/**
 * Clear changelog data.
 */
export function clearChangelog() {
  writeJSON(DATA_FILE, { entries: [], deprecations: [] });
}
