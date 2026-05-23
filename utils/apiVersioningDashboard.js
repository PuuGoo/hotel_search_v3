// API versioning dashboard — manage and monitor API versions

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "api_versioning.json");
const MAX_VERSIONS = 50;
const MAX_USAGE_RECORDS = 5000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { versions: [], usage: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Register an API version.
 */
export function registerVersion(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.versions) data.versions = [];

  const version = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    version: options.version,
    name: options.name || "",
    description: options.description || "",
    status: options.status || "active", // "active", "deprecated", "sunset", "retired"
    baseUrl: options.baseUrl || `/api/v${options.version}`,
    releasedAt: options.releasedAt || Date.now(),
    sunsetDate: options.sunsetDate || null,
    retiredAt: options.retiredAt || null,
    breaking: options.breaking || false,
    author: options.userId || "system",
    createdAt: Date.now(),
  };

  data.versions.unshift(version);
  if (data.versions.length > MAX_VERSIONS) data.versions.length = MAX_VERSIONS;

  writeJSON(DATA_FILE, data);
  return version;
}

/**
 * Get all versions.
 */
export function getVersions(options = {}) {
  const { status = null } = options;
  const data = readJSON(DATA_FILE);
  let versions = data.versions || [];

  if (status) versions = versions.filter((v) => v.status === status);

  return { versions, count: versions.length };
}

/**
 * Get a specific version.
 */
export function getVersion(versionId) {
  const data = readJSON(DATA_FILE);
  return (data.versions || []).find((v) => v.id === versionId) || null;
}

/**
 * Update a version.
 */
export function updateVersion(versionId, updates) {
  const data = readJSON(DATA_FILE);
  const index = (data.versions || []).findIndex((v) => v.id === versionId);
  if (index === -1) return null;

  data.versions[index] = { ...data.versions[index], ...updates, id: versionId };
  writeJSON(DATA_FILE, data);
  return data.versions[index];
}

/**
 * Delete a version.
 */
export function deleteVersion(versionId) {
  const data = readJSON(DATA_FILE);
  const index = (data.versions || []).findIndex((v) => v.id === versionId);
  if (index === -1) return false;

  data.versions.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Record version usage.
 */
export function recordVersionUsage(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.usage) data.usage = [];

  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    version: options.version,
    path: options.path,
    method: options.method || "GET",
    clientId: options.clientId || "anonymous",
    responseTime: options.responseTime || 0,
    statusCode: options.statusCode || 200,
    timestamp: Date.now(),
  };

  data.usage.unshift(record);
  if (data.usage.length > MAX_USAGE_RECORDS) data.usage.length = MAX_USAGE_RECORDS;

  writeJSON(DATA_FILE, data);
  return record;
}

/**
 * Get version usage records.
 */
export function getVersionUsage(options = {}) {
  const { version = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let usage = data.usage || [];

  if (version) usage = usage.filter((u) => u.version === version);

  return { records: usage.slice(0, limit), total: usage.length };
}

/**
 * Get usage breakdown by version.
 */
export function getUsageBreakdown() {
  const data = readJSON(DATA_FILE);
  const usage = data.usage || [];

  const breakdown = {};
  for (const record of usage) {
    if (!breakdown[record.version]) {
      breakdown[record.version] = { version: record.version, count: 0, errors: 0, totalTime: 0 };
    }
    breakdown[record.version].count++;
    breakdown[record.version].totalTime += record.responseTime;
    if (record.statusCode >= 400) breakdown[record.version].errors++;
  }

  return Object.values(breakdown)
    .sort((a, b) => b.count - a.count)
    .map((b) => ({
      version: b.version,
      count: b.count,
      errorRate: Math.round((b.errors / b.count) * 100),
      avgResponseTime: Math.round(b.totalTime / b.count),
    }));
}

/**
 * Get versioning statistics.
 */
export function getVersioningStats() {
  const data = readJSON(DATA_FILE);
  const versions = data.versions || [];
  const usage = data.usage || [];

  return {
    totalVersions: versions.length,
    active: versions.filter((v) => v.status === "active").length,
    deprecated: versions.filter((v) => v.status === "deprecated").length,
    sunset: versions.filter((v) => v.status === "sunset").length,
    retired: versions.filter((v) => v.status === "retired").length,
    totalUsageRecords: usage.length,
    uniqueClients: new Set(usage.map((u) => u.clientId)).size,
  };
}

/**
 * Process sunset — move past-sunset versions to sunset status.
 */
export function processSunsets() {
  const data = readJSON(DATA_FILE);
  const now = Date.now();
  let processed = 0;

  for (const v of data.versions || []) {
    if (v.status === "active" && v.sunsetDate && now >= v.sunsetDate) {
      v.status = "sunset";
      processed++;
    }
  }

  if (processed > 0) writeJSON(DATA_FILE, data);
  return { processed };
}

/**
 * Clear versioning data.
 */
export function clearVersioningData() {
  writeJSON(DATA_FILE, { versions: [], usage: [] });
}
