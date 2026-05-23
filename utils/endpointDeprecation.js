// Endpoint deprecation manager — manage deprecated endpoints with sunset dates

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "endpoint_deprecation.json");
const MAX_ENTRIES = 200;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { deprecations: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Register an endpoint as deprecated.
 */
export function addDeprecation(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.deprecations) data.deprecations = [];

  const deprecation = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    method: options.method || "GET",
    path: options.path,
    deprecatedAt: options.deprecatedAt || Date.now(),
    sunsetDate: options.sunsetDate || null,
    replacement: options.replacement || null,
    reason: options.reason || "",
    version: options.version || null,
    status: "active", // "active", "sunset", "removed"
    author: options.userId || "system",
    createdAt: Date.now(),
  };

  data.deprecations.unshift(deprecation);
  if (data.deprecations.length > MAX_ENTRIES) data.deprecations.length = MAX_ENTRIES;

  writeJSON(DATA_FILE, data);
  return deprecation;
}

/**
 * Get all deprecations.
 */
export function getDeprecations(options = {}) {
  const { status = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let deprecations = data.deprecations || [];

  if (status) deprecations = deprecations.filter((d) => d.status === status);

  return { deprecations: deprecations.slice(0, limit), total: deprecations.length };
}

/**
 * Get a specific deprecation.
 */
export function getDeprecation(deprecationId) {
  const data = readJSON(DATA_FILE);
  return (data.deprecations || []).find((d) => d.id === deprecationId) || null;
}

/**
 * Update a deprecation.
 */
export function updateDeprecation(deprecationId, updates) {
  const data = readJSON(DATA_FILE);
  const index = (data.deprecations || []).findIndex((d) => d.id === deprecationId);
  if (index === -1) return null;

  data.deprecations[index] = { ...data.deprecations[index], ...updates, id: deprecationId };
  writeJSON(DATA_FILE, data);
  return data.deprecations[index];
}

/**
 * Delete a deprecation.
 */
export function deleteDeprecation(deprecationId) {
  const data = readJSON(DATA_FILE);
  const index = (data.deprecations || []).findIndex((d) => d.id === deprecationId);
  if (index === -1) return false;

  data.deprecations.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Check if a specific endpoint is deprecated.
 */
export function checkEndpoint(method, pathStr) {
  const data = readJSON(DATA_FILE);
  const deprecation = (data.deprecations || []).find(
    (d) => d.method === method && d.path === pathStr && d.status === "active"
  );
  if (!deprecation) return null;

  const now = Date.now();
  const isSunset = deprecation.sunsetDate && now >= deprecation.sunsetDate;

  return {
    deprecated: true,
    sunsetDate: deprecation.sunsetDate,
    isSunset,
    replacement: deprecation.replacement,
    reason: deprecation.reason,
    version: deprecation.version,
  };
}

/**
 * Get deprecation statistics.
 */
export function getDeprecationStats() {
  const data = readJSON(DATA_FILE);
  const deprecations = data.deprecations || [];
  const now = Date.now();

  return {
    total: deprecations.length,
    active: deprecations.filter((d) => d.status === "active").length,
    sunset: deprecations.filter((d) => d.status === "sunset").length,
    removed: deprecations.filter((d) => d.status === "removed").length,
    pastSunset: deprecations.filter((d) => d.sunsetDate && now >= d.sunsetDate && d.status === "active").length,
  };
}

/**
 * Process sunset — move past-sunset deprecations to sunset status.
 */
export function processSunsets() {
  const data = readJSON(DATA_FILE);
  const now = Date.now();
  let processed = 0;

  for (const d of data.deprecations || []) {
    if (d.status === "active" && d.sunsetDate && now >= d.sunsetDate) {
      d.status = "sunset";
      processed++;
    }
  }

  if (processed > 0) writeJSON(DATA_FILE, data);
  return { processed };
}

/**
 * Clear all deprecation data.
 */
export function clearDeprecationData() {
  writeJSON(DATA_FILE, { deprecations: [] });
}
