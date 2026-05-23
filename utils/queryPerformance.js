// Query performance analytics — track slow queries and optimize
// Monitors query execution times and identifies bottlenecks

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PERFORMANCE_FILE = path.join(__dirname, "..", "query_performance.json");
const MAX_ENTRIES = 10000;
const SLOW_QUERY_THRESHOLD = 1000; // 1 second

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { entries: [], stats: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Record a query performance entry.
 */
export function recordQueryPerformance(entry) {
  const data = readJSON(PERFORMANCE_FILE);
  if (!data.entries) data.entries = [];

  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    query: entry.query || "",
    engine: entry.engine || "unknown",
    duration: entry.duration || 0,
    resultCount: entry.resultCount || 0,
    userId: entry.userId || null,
    cached: entry.cached || false,
    timestamp: Date.now(),
  };

  data.entries.unshift(record);

  // Trim to max entries
  if (data.entries.length > MAX_ENTRIES) {
    data.entries.length = MAX_ENTRIES;
  }

  writeJSON(PERFORMANCE_FILE, data);
  return record;
}

/**
 * Get query performance statistics.
 */
export function getPerformanceStats(options = {}) {
  const { hours = 24, engine = null } = options;

  const data = readJSON(PERFORMANCE_FILE);
  const entries = data.entries || [];
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  let filtered = entries.filter((e) => e.timestamp > cutoff);
  if (engine) {
    filtered = filtered.filter((e) => e.engine === engine);
  }

  if (filtered.length === 0) {
    return {
      totalQueries: 0,
      avgDuration: 0,
      p50Duration: 0,
      p90Duration: 0,
      p99Duration: 0,
      slowQueries: 0,
      cacheHitRate: 0,
      byEngine: {},
      slowestQueries: [],
    };
  }

  // Calculate duration percentiles
  const durations = filtered.map((e) => e.duration).sort((a, b) => a - b);
  const avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  const p50Duration = durations[Math.floor(durations.length * 0.5)] || 0;
  const p90Duration = durations[Math.floor(durations.length * 0.9)] || 0;
  const p99Duration = durations[Math.floor(durations.length * 0.99)] || 0;

  // Count slow queries
  const slowQueries = filtered.filter((e) => e.duration > SLOW_QUERY_THRESHOLD).length;

  // Cache hit rate
  const cached = filtered.filter((e) => e.cached).length;
  const cacheHitRate = Math.round((cached / filtered.length) * 100);

  // By engine
  const byEngine = {};
  for (const entry of filtered) {
    if (!byEngine[entry.engine]) {
      byEngine[entry.engine] = { count: 0, totalDuration: 0, slowCount: 0 };
    }
    byEngine[entry.engine].count++;
    byEngine[entry.engine].totalDuration += entry.duration;
    if (entry.duration > SLOW_QUERY_THRESHOLD) {
      byEngine[entry.engine].slowCount++;
    }
  }

  // Calculate avg per engine
  for (const engine of Object.keys(byEngine)) {
    byEngine[engine].avgDuration = Math.round(byEngine[engine].totalDuration / byEngine[engine].count);
  }

  // Slowest queries
  const slowestQueries = [...filtered]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10)
    .map((e) => ({
      query: e.query,
      engine: e.engine,
      duration: e.duration,
      timestamp: e.timestamp,
    }));

  return {
    totalQueries: filtered.length,
    avgDuration,
    p50Duration,
    p90Duration,
    p99Duration,
    slowQueries,
    slowQueryRate: Math.round((slowQueries / filtered.length) * 100),
    cacheHitRate,
    byEngine,
    slowestQueries,
    timeRange: { hours, from: new Date(cutoff).toISOString(), to: new Date().toISOString() },
  };
}

/**
 * Get slow query details.
 */
export function getSlowQueries(options = {}) {
  const { threshold = SLOW_QUERY_THRESHOLD, limit = 50, engine = null } = options;

  const data = readJSON(PERFORMANCE_FILE);
  const entries = data.entries || [];

  let slowQueries = entries.filter((e) => e.duration > threshold);
  if (engine) {
    slowQueries = slowQueries.filter((e) => e.engine === engine);
  }

  return slowQueries
    .sort((a, b) => b.duration - a.duration)
    .slice(0, limit)
    .map((e) => ({
      ...e,
      isSlow: true,
      severity: e.duration > threshold * 3 ? "critical" : e.duration > threshold * 2 ? "high" : "medium",
    }));
}

/**
 * Get query frequency analysis.
 */
export function getQueryFrequency(options = {}) {
  const { hours = 24, limit = 20 } = options;

  const data = readJSON(PERFORMANCE_FILE);
  const entries = data.entries || [];
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  const recent = entries.filter((e) => e.timestamp > cutoff);

  // Count query frequency
  const queryCounts = {};
  for (const entry of recent) {
    if (entry.query) {
      const q = entry.query.toLowerCase().trim();
      if (!queryCounts[q]) {
        queryCounts[q] = { count: 0, totalDuration: 0, engines: new Set() };
      }
      queryCounts[q].count++;
      queryCounts[q].totalDuration += entry.duration;
      queryCounts[q].engines.add(entry.engine);
    }
  }

  return Object.entries(queryCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([query, stats]) => ({
      query,
      count: stats.count,
      avgDuration: Math.round(stats.totalDuration / stats.count),
      engines: [...stats.engines],
    }));
}

/**
 * Get performance trends over time.
 */
export function getPerformanceTrends(options = {}) {
  const { hours = 24, interval = "hour" } = options;

  const data = readJSON(PERFORMANCE_FILE);
  const entries = data.entries || [];
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  const recent = entries.filter((e) => e.timestamp > cutoff);

  // Group by interval
  const intervalMs = interval === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const buckets = {};

  for (const entry of recent) {
    const bucketKey = Math.floor(entry.timestamp / intervalMs) * intervalMs;
    if (!buckets[bucketKey]) {
      buckets[bucketKey] = { count: 0, totalDuration: 0, slowCount: 0 };
    }
    buckets[bucketKey].count++;
    buckets[bucketKey].totalDuration += entry.duration;
    if (entry.duration > SLOW_QUERY_THRESHOLD) {
      buckets[bucketKey].slowCount++;
    }
  }

  return Object.entries(buckets)
    .sort((a, b) => a[0] - b[0])
    .map(([timestamp, stats]) => ({
      timestamp: new Date(parseInt(timestamp)).toISOString(),
      count: stats.count,
      avgDuration: Math.round(stats.totalDuration / stats.count),
      slowCount: stats.slowCount,
    }));
}

/**
 * Clear performance data.
 */
export function clearPerformanceData() {
  writeJSON(PERFORMANCE_FILE, { entries: [], stats: {} });
}
