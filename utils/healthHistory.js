// Health check history — track and visualize uptime over time
// Records health check results with timestamps for historical analysis

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "health_history.json");

const MAX_ENTRIES = 1440; // 24 hours at 1 per minute
const CHECK_INTERVAL = 60000; // 1 minute

let intervalHandle = null;

function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch { /* ignore */ }
  return { entries: [], startedAt: new Date().toISOString() };
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/**
 * Record a health check result.
 */
export function recordHealthCheck(checks, overallStatus) {
  const data = readData();
  data.entries.push({
    timestamp: new Date().toISOString(),
    status: overallStatus,
    checks,
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    uptime: Math.round(process.uptime()),
  });

  // Keep last MAX_ENTRIES
  if (data.entries.length > MAX_ENTRIES) {
    data.entries = data.entries.slice(-MAX_ENTRIES);
  }

  writeData(data);
}

/**
 * Start periodic health checks.
 * @param {Function} healthCheckFn - async function that returns { status, checks }
 */
export function startHealthMonitoring(healthCheckFn) {
  stopHealthMonitoring();

  intervalHandle = setInterval(async () => {
    try {
      const result = await healthCheckFn();
      recordHealthCheck(result.checks, result.status);
    } catch {
      recordHealthCheck({ error: "Health check failed" }, "error");
    }
  }, CHECK_INTERVAL);

  if (intervalHandle.unref) intervalHandle.unref();
}

/**
 * Stop periodic health checks.
 */
export function stopHealthMonitoring() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/**
 * Get health history.
 * @param {number} hours - number of hours to look back (default 24)
 */
export function getHealthHistory(hours = 24) {
  const data = readData();
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const entries = data.entries.filter((e) => new Date(e.timestamp) > cutoff);
  const total = entries.length;
  const healthy = entries.filter((e) => e.status === "ok").length;
  const degraded = entries.filter((e) => e.status === "degraded").length;
  const down = entries.filter((e) => e.status === "error" || e.status === "down").length;

  const uptimePercent = total > 0 ? Math.round((healthy / total) * 10000) / 100 : 0;

  // Find downtime periods
  const downtimePeriods = [];
  let inDowntime = false;
  let downtimeStart = null;

  for (const entry of entries) {
    if (entry.status !== "ok" && !inDowntime) {
      inDowntime = true;
      downtimeStart = entry.timestamp;
    } else if (entry.status === "ok" && inDowntime) {
      inDowntime = false;
      downtimePeriods.push({
        start: downtimeStart,
        end: entry.timestamp,
        duration: Math.round((new Date(entry.timestamp) - new Date(downtimeStart)) / 60000),
      });
    }
  }

  if (inDowntime) {
    downtimePeriods.push({
      start: downtimeStart,
      end: null,
      ongoing: true,
      duration: Math.round((Date.now() - new Date(downtimeStart).getTime()) / 60000),
    });
  }

  return {
    period: `${hours} hours`,
    totalChecks: total,
    healthy,
    degraded,
    down,
    uptimePercent,
    downtimePeriods,
    recentEntries: entries.slice(-30),
    startedAt: data.startedAt,
  };
}

/**
 * Get current uptime status.
 */
export function getCurrentStatus() {
  const data = readData();
  const last = data.entries[data.entries.length - 1];
  return {
    currentStatus: last?.status || "unknown",
    lastCheck: last?.timestamp || null,
    memory: last?.memory || null,
    uptime: last?.uptime || null,
    totalChecks: data.entries.length,
    monitoringSince: data.startedAt,
  };
}
