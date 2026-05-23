import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USAGE_FILE = path.join(__dirname, "..", "api_usage.json");

const router = Router();

export function readUsage() {
  try {
    if (fs.existsSync(USAGE_FILE)) {
      return JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading API usage:", e.message);
  }
  return { totalCalls: 0, byEndpoint: {}, byUser: {}, byStatus: {}, byHour: {} };
}

export function writeUsage(data) {
  fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
}

export function trackApiCall(info) {
  try {
    const data = readUsage();

    data.totalCalls = (data.totalCalls || 0) + 1;

    // By endpoint
    const endpoint = `${info.method} ${info.path}`;
    if (!data.byEndpoint[endpoint]) {
      data.byEndpoint[endpoint] = { count: 0, totalDuration: 0, errors: 0 };
    }
    data.byEndpoint[endpoint].count++;
    data.byEndpoint[endpoint].totalDuration += info.duration || 0;
    if ((info.statusCode || 0) >= 400) {
      data.byEndpoint[endpoint].errors++;
    }

    // By user
    const user = info.username || "anonymous";
    if (!data.byUser[user]) {
      data.byUser[user] = { count: 0, lastSeen: Date.now() };
    }
    data.byUser[user].count++;
    data.byUser[user].lastSeen = Date.now();

    // By status
    const statusBucket = Math.floor((info.statusCode || 0) / 100) + "xx";
    data.byStatus[statusBucket] = (data.byStatus[statusBucket] || 0) + 1;

    // By hour (keep last 72 hours)
    const hourKey = new Date().toISOString().slice(0, 13); // "2026-05-23T14"
    data.byHour[hourKey] = (data.byHour[hourKey] || 0) + 1;

    // Trim old hourly data (keep 72 hours)
    const hours = Object.keys(data.byHour).sort();
    while (hours.length > 72) {
      delete data.byHour[hours.shift()];
    }

    // Trim endpoints to top 200
    const endpoints = Object.entries(data.byEndpoint);
    if (endpoints.length > 200) {
      const sorted = endpoints.sort(([, a], [, b]) => b.count - a.count).slice(0, 200);
      data.byEndpoint = Object.fromEntries(sorted);
    }

    // Trim users to top 200
    const users = Object.entries(data.byUser);
    if (users.length > 200) {
      const sorted = users.sort(([, a], [, b]) => b.count - a.count).slice(0, 200);
      data.byUser = Object.fromEntries(sorted);
    }

    writeUsage(data);
  } catch (e) {
    console.error("Error tracking API usage:", e.message);
  }
}

// GET /api/admin/api-usage — full usage stats
router.get("/api/admin/api-usage", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const data = readUsage();

  // Top endpoints
  const topEndpoints = Object.entries(data.byEndpoint || {})
    .map(([endpoint, info]) => ({
      endpoint,
      count: info.count,
      avgDuration: info.count ? Math.round(info.totalDuration / info.count) : 0,
      errors: info.errors,
      errorRate: info.count ? Math.round((info.errors / info.count) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  // Top users
  const topUsers = Object.entries(data.byUser || {})
    .map(([username, info]) => ({
      username,
      count: info.count,
      lastSeen: info.lastSeen,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  // Hourly trend (last 24 hours)
  const hourlyTrend = Object.entries(data.byHour || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-24)
    .map(([hour, count]) => ({ hour, count }));

  res.json({
    totalCalls: data.totalCalls || 0,
    topEndpoints,
    topUsers,
    byStatus: data.byStatus || {},
    hourlyTrend,
  });
});

// DELETE /api/admin/api-usage — reset usage data
router.delete("/api/admin/api-usage", checkAuthenticated, checkRole("admin"), (_req, res) => {
  writeUsage({ totalCalls: 0, byEndpoint: {}, byUser: {}, byStatus: {}, byHour: {} });
  res.json({ success: true });
});

export default router;
