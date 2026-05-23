// Request anomaly detection — detect unusual patterns in API usage
// Tracks request rates and flags anomalies using statistical methods

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "anomaly_data.json");
const MAX_ENTRIES = 50000;
const WINDOW_MS = 60 * 1000; // 1 minute windows

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { requests: [], alerts: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Record a request for anomaly tracking.
 */
export function recordRequest(entry) {
  const data = readJSON(DATA_FILE);
  if (!data.requests) data.requests = [];
  if (!data.alerts) data.alerts = [];

  const record = {
    endpoint: entry.endpoint || "unknown",
    method: entry.method || "GET",
    userId: entry.userId || null,
    ip: entry.ip || null,
    statusCode: entry.statusCode || 200,
    duration: entry.duration || 0,
    timestamp: Date.now(),
  };

  data.requests.unshift(record);

  if (data.requests.length > MAX_ENTRIES) {
    data.requests.length = MAX_ENTRIES;
  }

  writeJSON(DATA_FILE, data);
  return record;
}

/**
 * Calculate request rate per minute for a given time window.
 */
export function getRequestRate(options = {}) {
  const { minutes = 60, endpoint = null } = options;
  const data = readJSON(DATA_FILE);
  const requests = data.requests || [];
  const cutoff = Date.now() - minutes * 60 * 1000;

  let filtered = requests.filter((r) => r.timestamp > cutoff);
  if (endpoint) {
    filtered = filtered.filter((r) => r.endpoint === endpoint);
  }

  // Group by minute
  const buckets = {};
  for (const req of filtered) {
    const bucketKey = Math.floor(req.timestamp / WINDOW_MS) * WINDOW_MS;
    buckets[bucketKey] = (buckets[bucketKey] || 0) + 1;
  }

  const rates = Object.values(buckets);
  const avg = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;

  return {
    totalRequests: filtered.length,
    avgPerMinute: Math.round(avg),
    peakPerMinute: Math.max(...rates, 0),
    windowMinutes: minutes,
    endpoint,
  };
}

/**
 * Detect anomalies using z-score method.
 */
export function detectAnomalies(options = {}) {
  const { threshold = 2.5, lookbackMinutes = 60 } = options;
  const data = readJSON(DATA_FILE);
  const requests = data.requests || [];
  const cutoff = Date.now() - lookbackMinutes * 60 * 1000;

  const filtered = requests.filter((r) => r.timestamp > cutoff);

  // Group by endpoint and minute
  const endpointBuckets = {};
  for (const req of filtered) {
    const key = `${req.method} ${req.endpoint}`;
    const bucketKey = Math.floor(req.timestamp / WINDOW_MS) * WINDOW_MS;
    if (!endpointBuckets[key]) endpointBuckets[key] = {};
    endpointBuckets[key][bucketKey] = (endpointBuckets[key][bucketKey] || 0) + 1;
  }

  const anomalies = [];

  for (const [endpoint, buckets] of Object.entries(endpointBuckets)) {
    const counts = Object.values(buckets);
    if (counts.length < 3) continue;

    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) continue;

    // Check recent buckets for anomalies
    const bucketEntries = Object.entries(buckets).sort((a, b) => b[0] - a[0]);
    const recentBuckets = bucketEntries.slice(0, 5);

    for (const [timestamp, count] of recentBuckets) {
      const zScore = (count - mean) / stdDev;
      if (zScore > threshold) {
        anomalies.push({
          endpoint,
          timestamp: new Date(parseInt(timestamp)).toISOString(),
          count,
          mean: Math.round(mean * 10) / 10,
          stdDev: Math.round(stdDev * 10) / 10,
          zScore: Math.round(zScore * 100) / 100,
          severity: zScore > threshold * 2 ? "critical" : zScore > threshold * 1.5 ? "high" : "medium",
        });
      }
    }
  }

  return anomalies.sort((a, b) => b.zScore - a.zScore);
}

/**
 * Detect anomalies by IP address.
 */
export function detectIPAnomalies(options = {}) {
  const { threshold = 3, lookbackMinutes = 60, maxRequestsPerIP = 100 } = options;
  const data = readJSON(DATA_FILE);
  const requests = data.requests || [];
  const cutoff = Date.now() - lookbackMinutes * 60 * 1000;

  const filtered = requests.filter((r) => r.timestamp > cutoff && r.ip);

  // Count requests per IP
  const ipCounts = {};
  for (const req of filtered) {
    ipCounts[req.ip] = (ipCounts[req.ip] || 0) + 1;
  }

  const counts = Object.values(ipCounts);
  if (counts.length < 2) return [];

  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
  const stdDev = Math.sqrt(variance);

  const anomalies = [];

  for (const [ip, count] of Object.entries(ipCounts)) {
    if (count < maxRequestsPerIP) continue;

    const zScore = stdDev > 0 ? (count - mean) / stdDev : 0;

    if (zScore > threshold || count > maxRequestsPerIP) {
      anomalies.push({
        ip,
        requestCount: count,
        mean: Math.round(mean * 10) / 10,
        zScore: Math.round(zScore * 100) / 100,
        severity: count > maxRequestsPerIP * 2 ? "critical" : "high",
      });
    }
  }

  return anomalies.sort((a, b) => b.requestCount - a.requestCount);
}

/**
 * Get anomaly statistics.
 */
export function getAnomalyStats() {
  const data = readJSON(DATA_FILE);
  const requests = data.requests || [];
  const alerts = data.alerts || [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  const recentRequests = requests.filter((r) => r.timestamp > cutoff);
  const recentAlerts = alerts.filter((a) => a.timestamp > cutoff);

  // Endpoint breakdown
  const endpointCounts = {};
  for (const req of recentRequests) {
    const key = `${req.method} ${req.endpoint}`;
    endpointCounts[key] = (endpointCounts[key] || 0) + 1;
  }

  const topEndpoints = Object.entries(endpointCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([endpoint, count]) => ({ endpoint, count }));

  return {
    totalRequests: recentRequests.length,
    totalAlerts: recentAlerts.length,
    topEndpoints,
    trackedIPs: new Set(recentRequests.filter((r) => r.ip).map((r) => r.ip)).size,
    timeRange: "24h",
  };
}

/**
 * Clear anomaly data.
 */
export function clearAnomalyData() {
  writeJSON(DATA_FILE, { requests: [], alerts: [] });
}
