// Performance dashboard routes — server metrics visualization

import { Router } from "express";
import os from "os";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";

const router = Router();

// Track request counts over time (last 60 data points, 1 per second)
const timeSeries = [];
const MAX_POINTS = 60;

let requestCount = 0;
let errorCount = 0;
let totalResponseTime = 0;
let responseCount = 0;

// Collect metrics every second
setInterval(() => {
  const mem = process.memoryUsage();
  timeSeries.push({
    timestamp: Date.now(),
    requests: requestCount,
    errors: errorCount,
    avgResponseTime: responseCount > 0 ? Math.round(totalResponseTime / responseCount) : 0,
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    rss: Math.round(mem.rss / 1024 / 1024),
    eventLoopLag: getEventLoopLag(),
  });

  if (timeSeries.length > MAX_POINTS) timeSeries.shift();

  // Reset counters
  requestCount = 0;
  errorCount = 0;
  totalResponseTime = 0;
  responseCount = 0;
}, 1000).unref();

let lastCheck = process.hrtime.bigint();
function getEventLoopLag() {
  const now = process.hrtime.bigint();
  const expectedNs = BigInt(1_000_000_000); // 1 second in nanoseconds
  const lag = Number(now - lastCheck - expectedNs) / 1e6; // ms
  lastCheck = now;
  return Math.max(0, Math.round(lag));
}

/**
 * Middleware to count requests for the dashboard.
 */
export function perfCountMiddleware(req, res, next) {
  const start = Date.now();
  requestCount++;

  res.on("finish", () => {
    const duration = Date.now() - start;
    totalResponseTime += duration;
    responseCount++;
    if (res.statusCode >= 400) errorCount++;
  });

  next();
}

/**
 * GET /api/performance/dashboard
 * Get performance dashboard data.
 */
router.get("/api/performance/dashboard", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const mem = process.memoryUsage();
  const cpus = os.cpus();

  res.json({
    server: {
      uptime: Math.round(process.uptime()),
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
    },
    memory: {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024),
      systemTotal: Math.round(os.totalmem() / 1024 / 1024),
      systemFree: Math.round(os.freemem() / 1024 / 1024),
    },
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model || "unknown",
      loadAvg: os.loadavg().map((l) => Math.round(l * 100) / 100),
    },
    timeSeries: timeSeries.slice(-30), // Last 30 seconds
  });
});

/**
 * GET /api/performance/summary
 * Get performance summary (non-admin users).
 */
router.get("/api/performance/summary", checkAuthenticated, (_req, res) => {
  const latest = timeSeries[timeSeries.length - 1];
  const mem = process.memoryUsage();

  res.json({
    uptime: Math.round(process.uptime()),
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    memoryUsagePercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
    loadAvg: os.loadavg()[0],
    recentRequests: latest?.requests || 0,
    recentErrors: latest?.errors || 0,
  });
});

export default router;
