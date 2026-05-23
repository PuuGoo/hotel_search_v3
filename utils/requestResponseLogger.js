// Request/response logging — log full request/response bodies for debugging
// Stores recent request/response pairs for inspection

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "req_res_log.json");
const MAX_ENTRIES = 5000;
const MAX_BODY_SIZE = 10240; // 10KB per body

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { entries: [], config: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data));
  } catch { /* ignore */ }
}

function truncate(str, maxLen = MAX_BODY_SIZE) {
  if (!str) return null;
  if (typeof str !== "string") str = JSON.stringify(str);
  return str.length > maxLen ? str.slice(0, maxLen) + "...[truncated]" : str;
}

/**
 * Log a request/response pair.
 */
export function logEntry(entry) {
  const data = readJSON(DATA_FILE);
  if (!data.entries) data.entries = [];

  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
    request: {
      method: entry.method || "GET",
      path: entry.path || "/",
      query: entry.query || null,
      headers: entry.requestHeaders || null,
      body: truncate(entry.requestBody),
      ip: entry.ip || null,
      userId: entry.userId || null,
    },
    response: {
      statusCode: entry.statusCode || 200,
      headers: entry.responseHeaders || null,
      body: truncate(entry.responseBody),
      duration: entry.duration || 0,
    },
  };

  data.entries.unshift(record);

  if (data.entries.length > MAX_ENTRIES) {
    data.entries.length = MAX_ENTRIES;
  }

  writeJSON(DATA_FILE, data);
  return record;
}

/**
 * Get logged entries with filtering.
 */
export function getEntries(options = {}) {
  const { method = null, path = null, statusCode = null, limit = 50, offset = 0 } = options;
  const data = readJSON(DATA_FILE);
  let entries = data.entries || [];

  if (method) entries = entries.filter((e) => e.request.method === method.toUpperCase());
  if (path) entries = entries.filter((e) => e.request.path.includes(path));
  if (statusCode) entries = entries.filter((e) => e.response.statusCode === parseInt(statusCode));

  return {
    entries: entries.slice(offset, offset + limit),
    total: entries.length,
    limit,
    offset,
  };
}

/**
 * Get a specific log entry by ID.
 */
export function getEntry(id) {
  const data = readJSON(DATA_FILE);
  return (data.entries || []).find((e) => e.id === id) || null;
}

/**
 * Get logging statistics.
 */
export function getLogStats(options = {}) {
  const { minutes = 60 } = options;
  const data = readJSON(DATA_FILE);
  const cutoff = Date.now() - minutes * 60 * 1000;

  const entries = (data.entries || []).filter((e) => e.timestamp > cutoff);

  const methodCounts = {};
  const statusCounts = {};
  const pathCounts = {};
  let totalDuration = 0;

  for (const entry of entries) {
    methodCounts[entry.request.method] = (methodCounts[entry.request.method] || 0) + 1;
    const statusBucket = `${Math.floor(entry.response.statusCode / 100)}xx`;
    statusCounts[statusBucket] = (statusCounts[statusBucket] || 0) + 1;
    pathCounts[entry.request.path] = (pathCounts[entry.request.path] || 0) + 1;
    totalDuration += entry.response.duration || 0;
  }

  const topPaths = Object.entries(pathCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([p, count]) => ({ path: p, count }));

  return {
    totalEntries: entries.length,
    avgDuration: entries.length > 0 ? Math.round(totalDuration / entries.length) : 0,
    methodCounts,
    statusCounts,
    topPaths,
    windowMinutes: minutes,
  };
}

/**
 * Clear log data.
 */
export function clearLog() {
  writeJSON(DATA_FILE, { entries: [], config: {} });
}

/**
 * Get config (which paths to log, body logging enabled, etc.).
 */
export function getConfig() {
  const data = readJSON(DATA_FILE);
  return data.config || {};
}

/**
 * Update logging config.
 */
export function updateConfig(config) {
  const data = readJSON(DATA_FILE);
  data.config = { ...data.config, ...config };
  writeJSON(DATA_FILE, data);
  return data.config;
}
