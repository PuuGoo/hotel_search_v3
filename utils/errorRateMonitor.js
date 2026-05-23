// Error rate monitoring — track error rates per endpoint with alerting
// Monitors HTTP error rates and triggers alerts when thresholds are exceeded

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "error_rate_data.json");
const MAX_ENTRIES = 100000;
const DEFAULT_ERROR_THRESHOLD = 5; // 5% error rate triggers alert
const WINDOW_MS = 60 * 1000; // 1 minute windows

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { errors: [], alerts: [], config: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Record an error response.
 */
export function recordError(entry) {
  const data = readJSON(DATA_FILE);
  if (!data.errors) data.errors = [];
  if (!data.alerts) data.alerts = [];

  const record = {
    endpoint: entry.endpoint || "unknown",
    method: entry.method || "GET",
    statusCode: entry.statusCode || 500,
    errorMessage: entry.errorMessage || "",
    userId: entry.userId || null,
    ip: entry.ip || null,
    timestamp: Date.now(),
  };

  data.errors.unshift(record);

  if (data.errors.length > MAX_ENTRIES) {
    data.errors.length = MAX_ENTRIES;
  }

  writeJSON(DATA_FILE, data);
  return record;
}

/**
 * Record a successful response (for calculating error rate).
 */
export function recordSuccess(entry) {
  const data = readJSON(DATA_FILE);
  if (!data.errors) data.errors = [];

  // We store successes with statusCode < 400
  const record = {
    endpoint: entry.endpoint || "unknown",
    method: entry.method || "GET",
    statusCode: entry.statusCode || 200,
    isSuccess: true,
    timestamp: Date.now(),
  };

  data.errors.unshift(record);

  if (data.errors.length > MAX_ENTRIES) {
    data.errors.length = MAX_ENTRIES;
  }

  writeJSON(DATA_FILE, data);
  return record;
}

/**
 * Get error rate for a time window.
 */
export function getErrorRate(options = {}) {
  const { minutes = 60, endpoint = null } = options;
  const data = readJSON(DATA_FILE);
  const entries = data.errors || [];
  const cutoff = Date.now() - minutes * 60 * 1000;

  let filtered = entries.filter((e) => e.timestamp > cutoff);
  if (endpoint) {
    filtered = filtered.filter((e) => e.endpoint === endpoint);
  }

  const total = filtered.length;
  const errors = filtered.filter((e) => !e.isSuccess && e.statusCode >= 400).length;
  const rate = total > 0 ? (errors / total) * 100 : 0;

  return {
    totalRequests: total,
    errorCount: errors,
    errorRate: Math.round(rate * 100) / 100,
    windowMinutes: minutes,
    endpoint,
  };
}

/**
 * Get error rates per endpoint.
 */
export function getErrorRatesByEndpoint(options = {}) {
  const { minutes = 60 } = options;
  const data = readJSON(DATA_FILE);
  const entries = data.errors || [];
  const cutoff = Date.now() - minutes * 60 * 1000;

  const filtered = entries.filter((e) => e.timestamp > cutoff);

  // Group by endpoint
  const endpointData = {};
  for (const entry of filtered) {
    const key = `${entry.method} ${entry.endpoint}`;
    if (!endpointData[key]) {
      endpointData[key] = { total: 0, errors: 0 };
    }
    endpointData[key].total++;
    if (!entry.isSuccess && entry.statusCode >= 400) {
      endpointData[key].errors++;
    }
  }

  const endpoints = Object.entries(endpointData)
    .map(([endpoint, stats]) => ({
      endpoint,
      totalRequests: stats.total,
      errorCount: stats.errors,
      errorRate: stats.total > 0 ? Math.round((stats.errors / stats.total) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.errorRate - a.errorRate);

  return { endpoints, windowMinutes: minutes };
}

/**
 * Check for error rate alerts.
 */
export function checkAlerts(options = {}) {
  const { threshold = DEFAULT_ERROR_THRESHOLD, minutes = 5 } = options;
  const data = readJSON(DATA_FILE);
  if (!data.alerts) data.alerts = [];

  const rates = getErrorRatesByEndpoint({ minutes });
  const alerts = [];

  for (const endpoint of rates.endpoints) {
    if (endpoint.errorRate > threshold && endpoint.totalRequests >= 5) {
      const alert = {
        endpoint: endpoint.endpoint,
        errorRate: endpoint.errorRate,
        threshold,
        errorCount: endpoint.errorCount,
        totalRequests: endpoint.totalRequests,
        severity: endpoint.errorRate > threshold * 2 ? "critical" : endpoint.errorRate > threshold * 1.5 ? "high" : "medium",
        timestamp: Date.now(),
      };
      alerts.push(alert);

      // Store alert
      data.alerts.unshift(alert);
    }
  }

  // Trim alerts
  if (data.alerts.length > 1000) {
    data.alerts.length = 1000;
  }

  writeJSON(DATA_FILE, data);
  return alerts;
}

/**
 * Get error statistics.
 */
export function getErrorStats(options = {}) {
  const { hours = 24 } = options;
  const data = readJSON(DATA_FILE);
  const errors = data.errors || [];
  const alerts = data.alerts || [];
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  const recentErrors = errors.filter((e) => e.timestamp > cutoff && !e.isSuccess && e.statusCode >= 400);
  const recentAlerts = alerts.filter((a) => a.timestamp > cutoff);

  // Error breakdown by status code
  const statusCodeCounts = {};
  for (const err of recentErrors) {
    const code = err.statusCode || 500;
    statusCodeCounts[code] = (statusCodeCounts[code] || 0) + 1;
  }

  const topStatusCodes = Object.entries(statusCodeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, count]) => ({ statusCode: parseInt(code), count }));

  // Error breakdown by endpoint
  const endpointCounts = {};
  for (const err of recentErrors) {
    const key = `${err.method} ${err.endpoint}`;
    endpointCounts[key] = (endpointCounts[key] || 0) + 1;
  }

  const topErrorEndpoints = Object.entries(endpointCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([endpoint, count]) => ({ endpoint, count }));

  return {
    totalErrors: recentErrors.length,
    totalAlerts: recentAlerts.length,
    topStatusCodes,
    topErrorEndpoints,
    timeRange: `${hours}h`,
  };
}

/**
 * Clear error rate data.
 */
export function clearErrorData() {
  writeJSON(DATA_FILE, { errors: [], alerts: [], config: {} });
}
