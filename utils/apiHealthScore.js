// API health score — compute overall API health from error rates, response times, uptime
// Aggregates multiple metrics into a single 0-100 health score

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "health_score_data.json");
const MAX_HISTORY = 1000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { history: [], config: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data));
  } catch { /* ignore */ }
}

// Weight factors for each component
const WEIGHTS = {
  errorRate: 0.35,      // 35% — most critical
  responseTime: 0.25,   // 25% — user experience
  uptime: 0.20,         // 20% — availability
  saturation: 0.20,     // 20% — resource pressure
};

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function scoreErrorRate(errorRate) {
  // 0% error = 100, 5% = 50, 10%+ = 0
  if (errorRate <= 0) return 100;
  if (errorRate >= 10) return 0;
  return Math.round(100 - (errorRate / 10) * 100);
}

function scoreResponseTime(p95Ms) {
  // <200ms = 100, 500ms = 75, 1000ms = 50, 2000ms+ = 0
  if (p95Ms <= 200) return 100;
  if (p95Ms >= 2000) return 0;
  return Math.round(100 - ((p95Ms - 200) / 1800) * 100);
}

function scoreUptime(uptimePercent) {
  // 100% = 100, 99.9% = 90, 99% = 50, 95% = 0
  if (uptimePercent >= 100) return 100;
  if (uptimePercent <= 95) return 0;
  return Math.round(((uptimePercent - 95) / 5) * 100);
}

function scoreSaturation(memoryPercent, cpuPercent) {
  // Average of memory and CPU pressure (lower is better)
  const memScore = memoryPercent <= 50 ? 100 : memoryPercent >= 95 ? 0 : Math.round(100 - ((memoryPercent - 50) / 45) * 100);
  const cpuScore = cpuPercent <= 30 ? 100 : cpuPercent >= 95 ? 0 : Math.round(100 - ((cpuPercent - 30) / 65) * 100);
  return Math.round((memScore + cpuScore) / 2);
}

/**
 * Compute API health score from metrics.
 * @param {Object} metrics - { errorRate, p95ResponseTime, uptimePercent, memoryPercent, cpuPercent }
 * @returns {Object} Health score with breakdown
 */
export function computeHealthScore(metrics = {}) {
  const {
    errorRate = 0,
    p95ResponseTime = 100,
    uptimePercent = 100,
    memoryPercent = 50,
    cpuPercent = 30,
  } = metrics;

  const scores = {
    errorRate: scoreErrorRate(errorRate),
    responseTime: scoreResponseTime(p95ResponseTime),
    uptime: scoreUptime(uptimePercent),
    saturation: scoreSaturation(memoryPercent, cpuPercent),
  };

  const overall = Math.round(
    scores.errorRate * WEIGHTS.errorRate +
    scores.responseTime * WEIGHTS.responseTime +
    scores.uptime * WEIGHTS.uptime +
    scores.saturation * WEIGHTS.saturation
  );

  const grade = overall >= 90 ? "A" : overall >= 75 ? "B" : overall >= 60 ? "C" : overall >= 40 ? "D" : "F";
  const status = overall >= 90 ? "healthy" : overall >= 75 ? "good" : overall >= 60 ? "degraded" : overall >= 40 ? "poor" : "critical";

  return {
    score: clamp(overall, 0, 100),
    grade,
    status,
    components: scores,
    weights: WEIGHTS,
    metrics: {
      errorRate,
      p95ResponseTime,
      uptimePercent,
      memoryPercent,
      cpuPercent,
    },
    timestamp: Date.now(),
  };
}

/**
 * Record a health score snapshot.
 */
export function recordHealthScore(metrics = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.history) data.history = [];

  const score = computeHealthScore(metrics);
  data.history.unshift(score);

  if (data.history.length > MAX_HISTORY) {
    data.history.length = MAX_HISTORY;
  }

  writeJSON(DATA_FILE, data);
  return score;
}

/**
 * Get health score history.
 */
export function getHealthHistory(options = {}) {
  const { minutes = 60 } = options;
  const data = readJSON(DATA_FILE);
  const cutoff = Date.now() - minutes * 60 * 1000;

  const history = (data.history || []).filter((h) => h.timestamp > cutoff);

  return {
    history: history.map((h) => ({
      score: h.score,
      grade: h.grade,
      status: h.status,
      timestamp: h.timestamp,
    })),
    count: history.length,
    windowMinutes: minutes,
  };
}

/**
 * Get health trend — improving, stable, or declining.
 */
export function getHealthTrend(options = {}) {
  const { minutes = 60 } = options;
  const data = readJSON(DATA_FILE);
  const cutoff = Date.now() - minutes * 60 * 1000;

  const history = (data.history || [])
    .filter((h) => h.timestamp > cutoff)
    .map((h) => h.score);

  if (history.length < 2) {
    return { trend: "stable", change: 0, samples: history.length };
  }

  const recent = history.slice(0, Math.floor(history.length / 3));
  const older = history.slice(Math.floor(history.length * 2 / 3));

  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  const change = Math.round((recentAvg - olderAvg) * 100) / 100;

  const trend = change > 5 ? "improving" : change < -5 ? "declining" : "stable";

  return {
    trend,
    change,
    recentAvg: Math.round(recentAvg),
    olderAvg: Math.round(olderAvg),
    samples: history.length,
  };
}

/**
 * Get health score statistics.
 */
export function getHealthStats(options = {}) {
  const { hours = 24 } = options;
  const data = readJSON(DATA_FILE);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  const scores = (data.history || [])
    .filter((h) => h.timestamp > cutoff)
    .map((h) => h.score);

  if (scores.length === 0) {
    return { count: 0, min: 0, max: 0, avg: 0, current: 0 };
  }

  const current = data.history[0]?.score || 0;

  return {
    count: scores.length,
    min: Math.min(...scores),
    max: Math.max(...scores),
    avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    current,
    timeRange: `${hours}h`,
  };
}

/**
 * Clear health score data.
 */
export function clearHealthData() {
  writeJSON(DATA_FILE, { history: [], config: {} });
}
