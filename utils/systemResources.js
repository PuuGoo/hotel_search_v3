// System resource monitoring — track CPU, memory, disk usage over time
// Samples system metrics and stores history for trend analysis

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "system_resource_data.json");
const MAX_SAMPLES = 10000;

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

/**
 * Take a snapshot of current system resources.
 */
export function takeSnapshot() {
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpus = os.cpus();

  // Calculate CPU usage from idle vs total times
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times)) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  const cpuUsage = totalTick > 0 ? Math.round(((totalTick - totalIdle) / totalTick) * 10000) / 100 : 0;

  const snapshot = {
    timestamp: Date.now(),
    cpu: {
      usage: cpuUsage,
      cores: cpus.length,
      model: cpus[0]?.model || "unknown",
    },
    memory: {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
      usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 10000) / 100,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
    },
    uptime: os.uptime(),
    loadAverage: os.loadavg(),
    platform: os.platform(),
  };

  return snapshot;
}

/**
 * Record a system resource snapshot.
 */
export function recordSnapshot() {
  const data = readJSON(DATA_FILE);
  if (!data.samples) data.samples = [];

  const snapshot = takeSnapshot();
  data.samples.unshift(snapshot);

  if (data.samples.length > MAX_SAMPLES) {
    data.samples.length = MAX_SAMPLES;
  }

  writeJSON(DATA_FILE, data);
  return snapshot;
}

/**
 * Get current system resources (live, no storage).
 */
export function getCurrentResources() {
  return takeSnapshot();
}

/**
 * Get resource history with optional time filtering.
 */
export function getResourceHistory(options = {}) {
  const { minutes = 60 } = options;
  const data = readJSON(DATA_FILE);
  const cutoff = Date.now() - minutes * 60 * 1000;

  const samples = (data.samples || []).filter((s) => s.timestamp > cutoff);

  return {
    samples: samples.map((s) => ({
      timestamp: s.timestamp,
      cpuUsage: s.cpu.usage,
      memoryUsagePercent: s.memory.usagePercent,
      memoryUsedMB: Math.round(s.memory.used / 1024 / 1024),
      heapUsedMB: Math.round(s.memory.heapUsed / 1024 / 1024),
      loadAverage: s.loadAverage[0],
    })),
    count: samples.length,
    windowMinutes: minutes,
  };
}

/**
 * Get resource statistics (min/max/avg) over a time window.
 */
export function getResourceStats(options = {}) {
  const { minutes = 60 } = options;
  const data = readJSON(DATA_FILE);
  const cutoff = Date.now() - minutes * 60 * 1000;

  const samples = (data.samples || []).filter((s) => s.timestamp > cutoff);

  if (samples.length === 0) {
    return {
      count: 0,
      cpu: { min: 0, max: 0, avg: 0 },
      memory: { min: 0, max: 0, avg: 0 },
      heap: { min: 0, max: 0, avg: 0 },
      windowMinutes: minutes,
    };
  }

  const cpuValues = samples.map((s) => s.cpu.usage);
  const memValues = samples.map((s) => s.memory.usagePercent);
  const heapValues = samples.map((s) => Math.round(s.memory.heapUsed / 1024 / 1024));

  const stats = (arr) => ({
    min: Math.min(...arr),
    max: Math.max(...arr),
    avg: Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100,
  });

  return {
    count: samples.length,
    cpu: stats(cpuValues),
    memory: stats(memValues),
    heap: stats(heapValues),
    latest: {
      cpuUsage: samples[0].cpu.usage,
      memoryUsagePercent: samples[0].memory.usagePercent,
      heapUsedMB: Math.round(samples[0].memory.heapUsed / 1024 / 1024),
      uptime: samples[0].uptime,
    },
    windowMinutes: minutes,
  };
}

/**
 * Get resource alerts — when thresholds are exceeded.
 */
export function getResourceAlerts(options = {}) {
  const { cpuThreshold = 90, memoryThreshold = 90, heapThreshold = 500 } = options;
  const snapshot = takeSnapshot();
  const alerts = [];

  if (snapshot.cpu.usage > cpuThreshold) {
    alerts.push({
      type: "cpu",
      value: snapshot.cpu.usage,
      threshold: cpuThreshold,
      severity: snapshot.cpu.usage > cpuThreshold * 1.1 ? "critical" : "warning",
      message: `CPU usage at ${snapshot.cpu.usage}%`,
    });
  }

  if (snapshot.memory.usagePercent > memoryThreshold) {
    alerts.push({
      type: "memory",
      value: snapshot.memory.usagePercent,
      threshold: memoryThreshold,
      severity: snapshot.memory.usagePercent > memoryThreshold * 1.05 ? "critical" : "warning",
      message: `Memory usage at ${snapshot.memory.usagePercent}%`,
    });
  }

  const heapMB = Math.round(snapshot.memory.heapUsed / 1024 / 1024);
  if (heapMB > heapThreshold) {
    alerts.push({
      type: "heap",
      value: heapMB,
      threshold: heapThreshold,
      severity: heapMB > heapThreshold * 1.5 ? "critical" : "warning",
      message: `Heap usage at ${heapMB}MB`,
    });
  }

  return {
    alerts,
    count: alerts.length,
    snapshot: {
      cpuUsage: snapshot.cpu.usage,
      memoryUsagePercent: snapshot.memory.usagePercent,
      heapUsedMB: heapMB,
    },
  };
}

/**
 * Clear resource data.
 */
export function clearResourceData() {
  writeJSON(DATA_FILE, { samples: [], config: {} });
}
