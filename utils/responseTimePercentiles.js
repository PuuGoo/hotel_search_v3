// Response time percentiles — track p50/p95/p99 per route
// Stores response time samples and computes percentiles for monitoring

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "response_time_data.json");
const MAX_SAMPLES = 50000;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { samples: [], config: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data));
  } catch { /* ignore */ }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Record a response time sample.
 */
export function recordResponseTime(entry) {
  const data = readJSON(DATA_FILE);
  if (!data.samples) data.samples = [];

  const record = {
    endpoint: entry.endpoint || "unknown",
    method: entry.method || "GET",
    statusCode: entry.statusCode || 200,
    duration: entry.duration || 0,
    timestamp: Date.now(),
  };

  data.samples.unshift(record);

  if (data.samples.length > MAX_SAMPLES) {
    data.samples.length = MAX_SAMPLES;
  }

  writeJSON(DATA_FILE, data);
  return record;
}

/**
 * Get response time percentiles for a specific endpoint or overall.
 */
export function getPercentiles(options = {}) {
  const { endpoint = null, minutes = 60 } = options;
  const data = readJSON(DATA_FILE);
  const cutoff = Date.now() - minutes * 60 * 1000;

  let samples = (data.samples || []).filter((s) => s.timestamp > cutoff);
  if (endpoint) {
    samples = samples.filter((s) => s.endpoint === endpoint);
  }

  const durations = samples.map((s) => s.duration).sort((a, b) => a - b);

  return {
    endpoint: endpoint || "all",
    count: durations.length,
    p50: percentile(durations, 50),
    p75: percentile(durations, 75),
    p90: percentile(durations, 90),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    min: durations.length > 0 ? durations[0] : 0,
    max: durations.length > 0 ? durations[durations.length - 1] : 0,
    avg: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    windowMinutes: minutes,
  };
}

/**
 * Get percentiles grouped by endpoint.
 */
export function getPercentilesByEndpoint(options = {}) {
  const { minutes = 60 } = options;
  const data = readJSON(DATA_FILE);
  const cutoff = Date.now() - minutes * 60 * 1000;

  const filtered = (data.samples || []).filter((s) => s.timestamp > cutoff);

  const grouped = {};
  for (const sample of filtered) {
    const key = `${sample.method} ${sample.endpoint}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(sample.duration);
  }

  const endpoints = Object.entries(grouped)
    .map(([endpoint, durations]) => {
      durations.sort((a, b) => a - b);
      return {
        endpoint,
        count: durations.length,
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        p99: percentile(durations, 99),
        avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      };
    })
    .sort((a, b) => b.p99 - a.p99);

  return { endpoints, windowMinutes: minutes };
}

/**
 * Get slow endpoints (p95 above threshold).
 */
export function getSlowEndpoints(options = {}) {
  const { thresholdMs = 1000, minutes = 60 } = options;
  const rates = getPercentilesByEndpoint({ minutes });

  return {
    slowEndpoints: rates.endpoints.filter((e) => e.p95 > thresholdMs),
    thresholdMs,
    windowMinutes: minutes,
  };
}

/**
 * Get response time statistics summary.
 */
export function getResponseTimeStats(options = {}) {
  const { hours = 24 } = options;
  const data = readJSON(DATA_FILE);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const samples = (data.samples || []).filter((s) => s.timestamp > cutoff);

  const durations = samples.map((s) => s.duration).sort((a, b) => a - b);

  // Status code distribution
  const statusCounts = {};
  for (const s of samples) {
    const bucket = `${Math.floor(s.statusCode / 100)}xx`;
    statusCounts[bucket] = (statusCounts[bucket] || 0) + 1;
  }

  return {
    totalSamples: samples.length,
    overall: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      avg: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    },
    statusDistribution: statusCounts,
    timeRange: `${hours}h`,
  };
}

/**
 * Clear response time data.
 */
export function clearResponseTimeData() {
  writeJSON(DATA_FILE, { samples: [], config: {} });
}
