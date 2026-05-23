// Adaptive rate limiting — adjust limits based on server load
// When server is under stress, reduce allowed request rates

import os from "os";

/**
 * Create an adaptive rate limiter that adjusts limits based on server load.
 * @param {Object} options
 * @param {number} options.baseMax - base max requests per window
 * @param {number} options.windowMs - time window in ms
 * @param {number} options.loadThreshold - CPU load threshold to start throttling (default 0.8)
 * @param {number} options.memoryThreshold - memory usage threshold (default 0.85)
 * @param {Function} options.keyGenerator - function to extract key from req
 * @returns {Function} Express middleware
 */
export function adaptiveRateLimit(options = {}) {
  const {
    baseMax = 100,
    windowMs = 60000,
    loadThreshold = 0.8,
    memoryThreshold = 0.85,
    keyGenerator = (req) => req.ip || req.connection?.remoteAddress || "unknown",
  } = options;

  const hits = new Map(); // key -> { count, resetAt }

  // Clean expired entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of hits) {
      if (now > val.resetAt) hits.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();
    const load = getServerLoad();

    // Calculate adaptive max based on server load
    let currentMax = baseMax;
    if (load.cpu > loadThreshold) {
      const factor = 1 - ((load.cpu - loadThreshold) / (1 - loadThreshold));
      currentMax = Math.max(1, Math.floor(baseMax * factor));
    }
    if (load.memory > memoryThreshold) {
      currentMax = Math.max(1, Math.floor(currentMax * 0.5));
    }

    // Get or create hit record
    if (!hits.has(key) || now > hits.get(key).resetAt) {
      hits.set(key, { count: 0, resetAt: now + windowMs });
    }

    const record = hits.get(key);
    record.count++;

    // Set rate limit headers
    const remaining = Math.max(0, currentMax - record.count);
    res.setHeader("X-RateLimit-Limit", currentMax);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetAt / 1000));
    res.setHeader("X-RateLimit-Adaptive", load.cpu > loadThreshold || load.memory > memoryThreshold ? "true" : "false");

    if (record.count > currentMax) {
      res.setHeader("Retry-After", Math.ceil((record.resetAt - now) / 1000));
      return res.status(429).json({
        error: "Too many requests",
        retryAfter: Math.ceil((record.resetAt - now) / 1000),
        limit: currentMax,
        adaptive: true,
      });
    }

    next();
  };
}

/**
 * Get current server load metrics.
 */
export function getServerLoad() {
  const cpus = os.cpus();
  const loadAvg = os.loadavg()[0]; // 1-minute average
  const cpuCount = cpus.length;
  const cpu = Math.min(1, loadAvg / cpuCount);

  const mem = process.memoryUsage();
  const memory = mem.heapUsed / mem.heapTotal;

  return {
    cpu: Math.round(cpu * 100) / 100,
    memory: Math.round(memory * 100) / 100,
    loadAvg: Math.round(loadAvg * 100) / 100,
    cpuCount,
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
  };
}

/**
 * Get adaptive rate limit status for monitoring.
 */
export function getAdaptiveStatus(options = {}) {
  const { baseMax = 100, loadThreshold = 0.8, memoryThreshold = 0.85 } = options;
  const load = getServerLoad();

  let currentMax = baseMax;
  let throttled = false;

  if (load.cpu > loadThreshold) {
    const factor = 1 - ((load.cpu - loadThreshold) / (1 - loadThreshold));
    currentMax = Math.max(1, Math.floor(baseMax * factor));
    throttled = true;
  }
  if (load.memory > memoryThreshold) {
    currentMax = Math.max(1, Math.floor(currentMax * 0.5));
    throttled = true;
  }

  return {
    load,
    baseMax,
    currentMax,
    throttled,
    reduction: throttled ? Math.round((1 - currentMax / baseMax) * 100) : 0,
  };
}
