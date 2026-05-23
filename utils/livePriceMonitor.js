// Live price monitoring — continuous background price checks with instant alerts
// Manages price monitoring jobs and tracks price changes over time

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "live_price_data.json");
const MAX_MONITORS = 100;
const MAX_HISTORY = 5000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { monitors: [], history: [], alerts: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data));
  } catch { /* ignore */ }
}

// In-memory monitor state
const monitorTimers = new Map(); // monitorId -> interval

/**
 * Create a price monitor.
 */
export function createMonitor(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.monitors) data.monitors = [];
  if (data.monitors.length >= MAX_MONITORS) {
    return { error: "Max monitors reached" };
  }

  const monitor = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: options.userId || "anonymous",
    hotelName: options.hotelName || "",
    location: options.location || "",
    targetPrice: options.targetPrice || null,
    alertOnIncrease: options.alertOnIncrease !== false,
    alertOnDecrease: options.alertOnDecrease !== false,
    thresholdPercent: options.thresholdPercent || 5,
    enabled: true,
    lastCheck: null,
    lastPrice: null,
    priceHistory: [],
    createdAt: Date.now(),
  };

  data.monitors.unshift(monitor);
  writeJSON(DATA_FILE, data);

  return monitor;
}

/**
 * Get all monitors for a user.
 */
export function getMonitors(userId, options = {}) {
  const data = readJSON(DATA_FILE);
  let monitors = (data.monitors || []).filter((m) => m.userId === userId);

  if (options.enabled !== undefined) {
    monitors = monitors.filter((m) => m.enabled === options.enabled);
  }

  return monitors.map((m) => ({
    id: m.id,
    hotelName: m.hotelName,
    location: m.location,
    targetPrice: m.targetPrice,
    enabled: m.enabled,
    lastCheck: m.lastCheck,
    lastPrice: m.lastPrice,
    priceChange: m.priceHistory.length >= 2
      ? m.priceHistory[0].price - m.priceHistory[1].price
      : 0,
    createdAt: m.createdAt,
  }));
}

/**
 * Get a specific monitor.
 */
export function getMonitor(monitorId) {
  const data = readJSON(DATA_FILE);
  return (data.monitors || []).find((m) => m.id === monitorId) || null;
}

/**
 * Update a monitor.
 */
export function updateMonitor(monitorId, updates) {
  const data = readJSON(DATA_FILE);
  const monitor = (data.monitors || []).find((m) => m.id === monitorId);
  if (!monitor) return null;

  for (const [key, value] of Object.entries(updates)) {
    if (key !== "id" && key !== "userId" && key !== "createdAt") {
      monitor[key] = value;
    }
  }

  writeJSON(DATA_FILE, data);
  return monitor;
}

/**
 * Delete a monitor.
 */
export function deleteMonitor(monitorId) {
  const data = readJSON(DATA_FILE);
  const index = (data.monitors || []).findIndex((m) => m.id === monitorId);
  if (index === -1) return false;

  data.monitors.splice(index, 1);
  writeJSON(DATA_FILE, data);

  if (monitorTimers.has(monitorId)) {
    clearInterval(monitorTimers.get(monitorId));
    monitorTimers.delete(monitorId);
  }

  return true;
}

/**
 * Record a price check for a monitor.
 */
export function recordPriceCheck(monitorId, price, source = "manual") {
  const data = readJSON(DATA_FILE);
  if (!data.history) data.history = [];
  if (!data.alerts) data.alerts = [];

  const monitor = (data.monitors || []).find((m) => m.id === monitorId);
  if (!monitor) return null;

  const previousPrice = monitor.lastPrice;
  const priceChange = previousPrice !== null ? price - previousPrice : 0;
  const percentChange = previousPrice > 0 ? Math.round((priceChange / previousPrice) * 10000) / 100 : 0;

  // Update monitor
  monitor.lastCheck = Date.now();
  monitor.lastPrice = price;
  monitor.priceHistory.unshift({ price, timestamp: Date.now(), source });
  if (monitor.priceHistory.length > 100) monitor.priceHistory.length = 100;

  // Record in history
  const historyEntry = {
    monitorId,
    hotelName: monitor.hotelName,
    price,
    previousPrice,
    priceChange,
    percentChange,
    source,
    timestamp: Date.now(),
  };
  data.history.unshift(historyEntry);
  if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY;

  // Check for alerts
  const alerts = [];
  if (previousPrice !== null) {
    const absPercent = Math.abs(percentChange);

    if (monitor.alertOnDecrease && priceChange < 0 && absPercent >= monitor.thresholdPercent) {
      const alert = {
        type: "price_decrease",
        monitorId,
        hotelName: monitor.hotelName,
        previousPrice,
        newPrice: price,
        change: priceChange,
        percentChange,
        timestamp: Date.now(),
      };
      alerts.push(alert);
      data.alerts.unshift(alert);
    }

    if (monitor.alertOnIncrease && priceChange > 0 && absPercent >= monitor.thresholdPercent) {
      const alert = {
        type: "price_increase",
        monitorId,
        hotelName: monitor.hotelName,
        previousPrice,
        newPrice: price,
        change: priceChange,
        percentChange,
        timestamp: Date.now(),
      };
      alerts.push(alert);
      data.alerts.unshift(alert);
    }
  }

  // Target price check (works even on first check)
  if (monitor.targetPrice && price <= monitor.targetPrice) {
    const alert = {
      type: "target_reached",
      monitorId,
      hotelName: monitor.hotelName,
      targetPrice: monitor.targetPrice,
      currentPrice: price,
      timestamp: Date.now(),
    };
    alerts.push(alert);
    data.alerts.unshift(alert);
  }

  if (data.alerts.length > 1000) data.alerts.length = 1000;

  writeJSON(DATA_FILE, data);

  return { historyEntry, alerts };
}

/**
 * Get price history for a monitor.
 */
export function getPriceHistory(monitorId, options = {}) {
  const { limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  const history = (data.history || []).filter((h) => h.monitorId === monitorId);
  return { history: history.slice(0, limit), total: history.length };
}

/**
 * Get alerts.
 */
export function getAlerts(userId, options = {}) {
  const { limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  const monitors = (data.monitors || []).filter((m) => m.userId === userId);
  const monitorIds = new Set(monitors.map((m) => m.id));

  const alerts = (data.alerts || []).filter((a) => monitorIds.has(a.monitorId));
  return { alerts: alerts.slice(0, limit), total: alerts.length };
}

/**
 * Get monitoring statistics.
 */
export function getMonitorStats(userId) {
  const data = readJSON(DATA_FILE);
  const monitors = (data.monitors || []).filter((m) => m.userId === userId);
  const monitorIds = new Set(monitors.map((m) => m.id));

  const history = (data.history || []).filter((h) => monitorIds.has(h.monitorId));
  const alerts = (data.alerts || []).filter((a) => monitorIds.has(a.monitorId));

  return {
    totalMonitors: monitors.length,
    activeMonitors: monitors.filter((m) => m.enabled).length,
    totalChecks: history.length,
    totalAlerts: alerts.length,
    recentAlerts: alerts.slice(0, 5),
  };
}

/**
 * Clear all monitor data.
 */
export function clearMonitorData() {
  for (const timer of monitorTimers.values()) {
    clearInterval(timer);
  }
  monitorTimers.clear();
  writeJSON(DATA_FILE, { monitors: [], history: [], alerts: [] });
}
