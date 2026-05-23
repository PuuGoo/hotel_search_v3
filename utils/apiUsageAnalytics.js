// API usage analytics — track API usage patterns per client

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "api_usage_analytics.json");
const MAX_RECORDS = 5000;
const MAX_CLIENTS = 500;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { records: [], clients: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Record an API usage event.
 */
export function recordUsage(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.records) data.records = [];
  if (!data.clients) data.clients = {};

  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    clientId: options.clientId || "anonymous",
    method: options.method || "GET",
    path: options.path,
    statusCode: options.statusCode || 200,
    responseTime: options.responseTime || 0,
    timestamp: Date.now(),
  };

  data.records.unshift(record);
  if (data.records.length > MAX_RECORDS) data.records.length = MAX_RECORDS;

  // Update client stats
  const clientId = record.clientId;
  if (!data.clients[clientId]) {
    data.clients[clientId] = {
      id: clientId,
      firstSeen: Date.now(),
      totalRequests: 0,
      endpoints: {},
      errorCount: 0,
    };
    // Cap clients
    const clientKeys = Object.keys(data.clients);
    if (clientKeys.length > MAX_CLIENTS) {
      const oldest = clientKeys.sort((a, b) => data.clients[a].firstSeen - data.clients[b].firstSeen)[0];
      delete data.clients[oldest];
    }
  }

  const client = data.clients[clientId];
  client.totalRequests++;
  client.lastSeen = Date.now();
  client.endpoints[record.path] = (client.endpoints[record.path] || 0) + 1;
  if (record.statusCode >= 400) client.errorCount++;

  writeJSON(DATA_FILE, data);
  return record;
}

/**
 * Get usage records with optional filters.
 */
export function getUsageRecords(options = {}) {
  const { clientId = null, method = null, path: pathFilter = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let records = data.records || [];

  if (clientId) records = records.filter((r) => r.clientId === clientId);
  if (method) records = records.filter((r) => r.method === method);
  if (pathFilter) records = records.filter((r) => r.path === pathFilter);

  return { records: records.slice(0, limit), total: records.length };
}

/**
 * Get all clients.
 */
export function getClients() {
  const data = readJSON(DATA_FILE);
  return Object.values(data.clients || {});
}

/**
 * Get a specific client's stats.
 */
export function getClient(clientId) {
  const data = readJSON(DATA_FILE);
  return (data.clients || {})[clientId] || null;
}

/**
 * Get top endpoints by usage.
 */
export function getTopEndpoints(limit = 10) {
  const data = readJSON(DATA_FILE);
  const records = data.records || [];

  const endpointCounts = {};
  for (const record of records) {
    const key = `${record.method} ${record.path}`;
    if (!endpointCounts[key]) endpointCounts[key] = { method: record.method, path: record.path, count: 0, totalTime: 0, errors: 0 };
    endpointCounts[key].count++;
    endpointCounts[key].totalTime += record.responseTime;
    if (record.statusCode >= 400) endpointCounts[key].errors++;
  }

  return Object.values(endpointCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((e) => ({
      method: e.method,
      path: e.path,
      count: e.count,
      avgResponseTime: Math.round(e.totalTime / e.count),
      errorRate: Math.round((e.errors / e.count) * 100),
    }));
}

/**
 * Get top clients by usage.
 */
export function getTopClients(limit = 10) {
  const data = readJSON(DATA_FILE);
  const clients = Object.values(data.clients || {});

  return clients
    .sort((a, b) => b.totalRequests - a.totalRequests)
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      totalRequests: c.totalRequests,
      errorCount: c.errorCount,
      errorRate: Math.round((c.errorCount / c.totalRequests) * 100),
      topEndpoint: Object.entries(c.endpoints).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      firstSeen: c.firstSeen,
      lastSeen: c.lastSeen,
    }));
}

/**
 * Get usage over time (hourly buckets for last 24h).
 */
export function getUsageTimeline() {
  const data = readJSON(DATA_FILE);
  const records = data.records || [];
  const now = Date.now();
  const dayAgo = now - 86400000;

  const buckets = {};
  for (let i = 0; i < 24; i++) {
    const hourStart = dayAgo + i * 3600000;
    buckets[hourStart] = { timestamp: hourStart, count: 0, errors: 0 };
  }

  for (const record of records) {
    if (record.timestamp < dayAgo) continue;
    const bucketKey = Math.floor((record.timestamp - dayAgo) / 3600000) * 3600000 + dayAgo;
    if (buckets[bucketKey]) {
      buckets[bucketKey].count++;
      if (record.statusCode >= 400) buckets[bucketKey].errors++;
    }
  }

  return Object.values(buckets).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Get overall usage statistics.
 */
export function getUsageStats() {
  const data = readJSON(DATA_FILE);
  const records = data.records || [];
  const clients = data.clients || {};

  const totalRequests = records.length;
  const totalErrors = records.filter((r) => r.statusCode >= 400).length;
  const avgResponseTime = records.length > 0
    ? Math.round(records.reduce((sum, r) => sum + r.responseTime, 0) / records.length)
    : 0;

  const uniquePaths = new Set(records.map((r) => r.path)).size;
  const uniqueClients = Object.keys(clients).length;

  return {
    totalRequests,
    totalErrors,
    errorRate: totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 100) : 0,
    avgResponseTime,
    uniquePaths,
    uniqueClients,
  };
}

/**
 * Clear usage data.
 */
export function clearUsageData() {
  writeJSON(DATA_FILE, { records: [], clients: {} });
}
