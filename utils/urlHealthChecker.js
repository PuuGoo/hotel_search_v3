// URL health checker — batch verify and monitor result URL accessibility
// Tracks URL health over time and provides degradation alerts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import https from "https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HEALTH_FILE = path.join(__dirname, "..", "url_health.json");
const MAX_ENTRIES = 10000;
const CHECK_TIMEOUT = 5000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { urls: {}, lastCheck: 0 };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Check a single URL's health.
 */
export function checkUrlHealth(url, options = {}) {
  const { timeout = CHECK_TIMEOUT } = options;

  return new Promise((resolve) => {
    const startTime = Date.now();
    const protocol = url.startsWith("https") ? https : http;

    const req = protocol.get(url, { timeout, headers: { "User-Agent": "HotelSearch-HealthCheck/1.0" } }, (res) => {
      const responseTime = Date.now() - startTime;
      resolve({
        url,
        status: res.statusCode,
        healthy: res.statusCode >= 200 && res.statusCode < 400,
        responseTime,
        redirectUrl: res.statusCode >= 300 && res.statusCode < 400 ? res.headers.location : null,
        checkedAt: Date.now(),
      });
      res.resume();
    });

    req.on("error", () => {
      resolve({
        url,
        status: 0,
        healthy: false,
        responseTime: Date.now() - startTime,
        error: "Connection failed",
        checkedAt: Date.now(),
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        url,
        status: 0,
        healthy: false,
        responseTime: Date.now() - startTime,
        error: "Timeout",
        checkedAt: Date.now(),
      });
    });
  });
}

/**
 * Batch check multiple URLs.
 */
export async function batchCheckUrls(urls, options = {}) {
  const { concurrency = 5 } = options;
  const results = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((url) => checkUrlHealth(url, options)));
    results.push(...batchResults);
  }

  // Update health history
  const data = readJSON(HEALTH_FILE);
  if (!data.urls) data.urls = {};

  for (const result of results) {
    if (!data.urls[result.url]) {
      data.urls[result.url] = { checks: [], lastHealthy: null, lastUnhealthy: null };
    }

    const urlData = data.urls[result.url];
    urlData.checks.unshift({
      status: result.status,
      healthy: result.healthy,
      responseTime: result.responseTime,
      checkedAt: result.checkedAt,
    });

    // Trim old checks
    if (urlData.checks.length > 50) {
      urlData.checks.length = 50;
    }

    if (result.healthy) {
      urlData.lastHealthy = result.checkedAt;
    } else {
      urlData.lastUnhealthy = result.checkedAt;
    }
  }

  data.lastCheck = Date.now();
  writeJSON(HEALTH_FILE, data);

  return results;
}

/**
 * Get health history for a URL.
 */
export function getUrlHealthHistory(url) {
  const data = readJSON(HEALTH_FILE);
  const urlData = (data.urls || {})[url];

  if (!urlData) return null;

  const checks = urlData.checks || [];
  const healthyCount = checks.filter((c) => c.healthy).length;
  const avgResponseTime = checks.length > 0
    ? Math.round(checks.reduce((sum, c) => sum + c.responseTime, 0) / checks.length)
    : 0;

  return {
    url,
    totalChecks: checks.length,
    healthyChecks: healthyCount,
    healthRate: checks.length > 0 ? Math.round((healthyCount / checks.length) * 100) : 0,
    avgResponseTime,
    lastHealthy: urlData.lastHealthy,
    lastUnhealthy: urlData.lastUnhealthy,
    recentChecks: checks.slice(0, 10),
  };
}

/**
 * Get overall health statistics.
 */
export function getHealthStats() {
  const data = readJSON(HEALTH_FILE);
  const urls = data.urls || {};
  const urlEntries = Object.entries(urls);

  if (urlEntries.length === 0) {
    return { totalUrls: 0, healthyUrls: 0, unhealthyUrls: 0, lastCheck: data.lastCheck };
  }

  let healthyUrls = 0;
  let unhealthyUrls = 0;
  const degrading = [];

  for (const [url, urlData] of urlEntries) {
    const recentChecks = (urlData.checks || []).slice(0, 5);
    if (recentChecks.length === 0) continue;

    const allHealthy = recentChecks.every((c) => c.healthy);
    const allUnhealthy = recentChecks.every((c) => !c.healthy);

    if (allHealthy) {
      healthyUrls++;
    } else if (allUnhealthy) {
      unhealthyUrls++;
    } else {
      // Degrading: mix of healthy and unhealthy
      degrading.push({
        url,
        healthRate: Math.round((recentChecks.filter((c) => c.healthy).length / recentChecks.length) * 100),
      });
    }
  }

  return {
    totalUrls: urlEntries.length,
    healthyUrls,
    unhealthyUrls,
    degradingUrls: degrading.length,
    degrading,
    lastCheck: data.lastCheck,
  };
}

/**
 * Clear health data.
 */
export function clearHealthData() {
  writeJSON(HEALTH_FILE, { urls: {}, lastCheck: 0 });
}
