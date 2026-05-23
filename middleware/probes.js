// Readiness and liveness probes for orchestration (Kubernetes, Docker, etc.)
// Liveness: is the process alive? (always 200 if running)
// Readiness: is the app ready to serve traffic? (checks dependencies)

import config from "../utils/config.js";

let isReady = false;
let startupTime = null;
const checks = new Map();

/**
 * Mark the application as ready after startup completes.
 */
export function markReady() {
  isReady = true;
  startupTime = Date.now();
}

/**
 * Register a readiness check.
 * @param {string} name - Check name
 * @param {Function} fn - Async function that returns { status: "ok"|"fail", detail?: string }
 */
export function registerCheck(name, fn) {
  checks.set(name, fn);
}

/**
 * Liveness probe handler — always returns 200 if the process is running.
 * Use for: Kubernetes livenessProbe
 */
export function livenessProbe(_req, res) {
  res.json({
    status: "alive",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Readiness probe handler — returns 200 only if all checks pass.
 * Use for: Kubernetes readinessProbe, load balancer health checks
 */
export async function readinessProbe(_req, res) {
  if (!isReady) {
    return res.status(503).json({
      status: "not_ready",
      message: "Application is still starting",
    });
  }

  const results = {};
  let allOk = true;

  for (const [name, fn] of checks) {
    try {
      const result = await fn();
      results[name] = result;
      if (result.status !== "ok") allOk = false;
    } catch (err) {
      results[name] = { status: "fail", detail: err.message };
      allOk = false;
    }
  }

  const statusCode = allOk ? 200 : 503;
  res.status(statusCode).json({
    status: allOk ? "ready" : "not_ready",
    startupTime,
    uptimeMs: startupTime ? Date.now() - startupTime : null,
    checks: results,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Startup probe handler — returns 200 once the app has started.
 * Use for: Kubernetes startupProbe (handles slow starts)
 */
export function startupProbe(_req, res) {
  if (isReady) {
    res.json({ status: "started", startupTime });
  } else {
    res.status(503).json({ status: "starting" });
  }
}

// Register default checks
registerCheck("memory", () => {
  const heapUsed = process.memoryUsage().heapUsed;
  const maxHeap = 1024 * 1024 * 1024; // 1GB threshold
  return {
    status: heapUsed < maxHeap ? "ok" : "warn",
    heapUsed: `${Math.round(heapUsed / 1024 / 1024)}MB`,
  };
});

registerCheck("event_loop", () => {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const lag = Number(process.hrtime.bigint() - start) / 1e6;
      resolve({
        status: lag < 100 ? "ok" : "warn",
        lagMs: Math.round(lag),
      });
    });
  });
});
