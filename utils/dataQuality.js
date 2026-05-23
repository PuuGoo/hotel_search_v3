// Data quality checks — validate data quality at each pipeline stage

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "data_quality.json");
const MAX_CHECKS = 100;
const MAX_RESULTS = 1000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { checks: [], results: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Create a data quality check definition.
 */
export function createCheck(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.checks) data.checks = [];
  if (data.checks.length >= MAX_CHECKS) {
    return { error: "Max checks reached" };
  }

  const check = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name || "Unnamed Check",
    description: options.description || "",
    type: options.type, // "not_null", "unique", "range", "regex", "enum", "custom"
    field: options.field,
    config: options.config || {}, // { min, max, pattern, values, fn }
    enabled: options.enabled !== false,
    createdBy: options.userId || "system",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastRun: null,
    runCount: 0,
    passCount: 0,
    failCount: 0,
  };

  data.checks.unshift(check);
  writeJSON(DATA_FILE, data);
  return check;
}

/**
 * Get all checks.
 */
export function getChecks(options = {}) {
  const { enabled = null } = options;
  const data = readJSON(DATA_FILE);
  let checks = data.checks || [];

  if (enabled !== null) {
    checks = checks.filter((c) => c.enabled === enabled);
  }

  return checks.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    type: c.type,
    field: c.field,
    enabled: c.enabled,
    lastRun: c.lastRun,
    runCount: c.runCount,
    passCount: c.passCount,
    failCount: c.failCount,
    passRate: c.runCount > 0 ? Math.round((c.passCount / c.runCount) * 100) : 0,
    createdAt: c.createdAt,
  }));
}

/**
 * Get a specific check.
 */
export function getCheck(checkId) {
  const data = readJSON(DATA_FILE);
  return (data.checks || []).find((c) => c.id === checkId) || null;
}

/**
 * Update a check.
 */
export function updateCheck(checkId, updates) {
  const data = readJSON(DATA_FILE);
  const check = (data.checks || []).find((c) => c.id === checkId);
  if (!check) return null;

  for (const [key, value] of Object.entries(updates)) {
    if (key !== "id" && key !== "createdBy" && key !== "createdAt" && key !== "runCount" && key !== "passCount" && key !== "failCount") {
      check[key] = value;
    }
  }
  check.updatedAt = Date.now();

  writeJSON(DATA_FILE, data);
  return check;
}

/**
 * Delete a check.
 */
export function deleteCheck(checkId) {
  const data = readJSON(DATA_FILE);
  const index = (data.checks || []).findIndex((c) => c.id === checkId);
  if (index === -1) return false;

  data.checks.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Run a quality check against data.
 */
export function runCheck(checkId, records) {
  const data = readJSON(DATA_FILE);
  if (!data.results) data.results = [];

  const check = (data.checks || []).find((c) => c.id === checkId);
  if (!check) return { error: "Check not found" };
  if (!check.enabled) return { error: "Check is disabled" };
  if (!Array.isArray(records)) return { error: "Records must be an array" };

  const failures = [];
  let passed = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const value = record[check.field];
    let valid = true;

    switch (check.type) {
      case "not_null":
        valid = value !== null && value !== undefined && value !== "";
        break;
      case "unique": {
        const seen = new Set();
        const values = records.map((r) => r[check.field]);
        valid = !values.some((v, idx) => values.indexOf(v) !== idx);
        if (i > 0) continue; // Only check once
        break;
      }
      case "range":
        valid = typeof value === "number" &&
          (check.config.min === undefined || value >= check.config.min) &&
          (check.config.max === undefined || value <= check.config.max);
        break;
      case "regex":
        valid = typeof value === "string" && new RegExp(check.config.pattern).test(value);
        break;
      case "enum":
        valid = (check.config.values || []).includes(value);
        break;
      case "custom":
        valid = true; // Custom checks are validated externally
        break;
      default:
        valid = true;
    }

    if (!valid) {
      failures.push({ index: i, field: check.field, value });
    } else {
      passed++;
    }
  }

  const result = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    checkId,
    checkName: check.name,
    checkType: check.type,
    field: check.field,
    totalRecords: records.length,
    passed,
    failed: failures.length,
    passRate: records.length > 0 ? Math.round((passed / records.length) * 100) : 0,
    failures: failures.slice(0, 20), // Cap failure details
    timestamp: Date.now(),
  };

  // Update check stats
  check.lastRun = Date.now();
  check.runCount++;
  if (failures.length === 0) {
    check.passCount++;
  } else {
    check.failCount++;
  }

  data.results.unshift(result);
  if (data.results.length > MAX_RESULTS) data.results.length = MAX_RESULTS;

  writeJSON(DATA_FILE, data);
  return result;
}

/**
 * Run all enabled checks against data.
 */
export function runAllChecks(records) {
  const data = readJSON(DATA_FILE);
  const checks = (data.checks || []).filter((c) => c.enabled);
  const results = [];

  for (const check of checks) {
    const result = runCheck(check.id, records);
    if (!result.error) results.push(result);
  }

  return {
    results,
    totalChecks: results.length,
    passed: results.filter((r) => r.failed === 0).length,
    failed: results.filter((r) => r.failed > 0).length,
  };
}

/**
 * Get check results.
 */
export function getResults(options = {}) {
  const { checkId = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let results = data.results || [];

  if (checkId) results = results.filter((r) => r.checkId === checkId);

  return { results: results.slice(0, limit), total: results.length };
}

/**
 * Get quality statistics.
 */
export function getQualityStats() {
  const data = readJSON(DATA_FILE);
  const checks = data.checks || [];
  const results = data.results || [];

  const overallPassRate = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.passRate, 0) / results.length)
    : 0;

  return {
    totalChecks: checks.length,
    enabledChecks: checks.filter((c) => c.enabled).length,
    totalResults: results.length,
    overallPassRate,
    checksRun: checks.filter((c) => c.runCount > 0).length,
  };
}

/**
 * Clear quality data.
 */
export function clearQualityData() {
  writeJSON(DATA_FILE, { checks: [], results: [] });
}
