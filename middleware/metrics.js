/**
 * Prometheus-compatible metrics middleware.
 * Tracks request count, duration, and status codes per route.
 * Exposes metrics at /metrics endpoint.
 */

const metrics = {
  requests: new Map(), // route -> { total, byStatus, durations }
  startTime: Date.now(),
};

function normalizeRoute(route) {
  // Normalize route params to placeholders: /api/bookmarks/123 -> /api/bookmarks/:id
  return route
    .replace(/\/\d+/g, "/:id")
    .replace(/\/[a-f0-9]{16}/g, "/:token");
}

export function metricsMiddleware(req, res, next) {
  if (req.path === "/metrics") return next();

  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    const route = normalizeRoute(req.path);
    const method = req.method;
    const status = res.statusCode;
    const key = `${method} ${route}`;

    if (!metrics.requests.has(key)) {
      metrics.requests.set(key, { total: 0, byStatus: {}, durations: [] });
    }

    const entry = metrics.requests.get(key);
    entry.total++;
    entry.byStatus[status] = (entry.byStatus[status] || 0) + 1;

    // Keep last 1000 durations per route for percentile calculation
    entry.durations.push(durationMs);
    if (entry.durations.length > 1000) {
      entry.durations.shift();
    }
  });

  next();
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function metricsEndpoint(_req, res) {
  const lines = [];
  const uptime = (Date.now() - metrics.startTime) / 1000;

  lines.push("# HELP http_requests_total Total number of HTTP requests");
  lines.push("# TYPE http_requests_total counter");

  lines.push("# HELP http_request_duration_ms Request duration in milliseconds");
  lines.push("# TYPE http_request_duration_ms summary");

  lines.push("# HELP http_request_duration_p50_ms 50th percentile request duration");
  lines.push("# TYPE http_request_duration_p50_ms gauge");

  lines.push("# HELP http_request_duration_p95_ms 95th percentile request duration");
  lines.push("# TYPE http_request_duration_p95_ms gauge");

  lines.push("# HELP http_request_duration_p99_ms 99th percentile request duration");
  lines.push("# TYPE http_request_duration_p99_ms gauge");

  lines.push(`# HELP process_uptime_seconds Process uptime in seconds`);
  lines.push(`# TYPE process_uptime_seconds gauge`);
  lines.push(`process_uptime_seconds ${uptime.toFixed(2)}`);

  for (const [key, entry] of metrics.requests) {
    const labels = `route="${key.split(" ")[1]}",method="${key.split(" ")[0]}"`;

    lines.push(`http_requests_total{${labels}} ${entry.total}`);

    for (const [status, count] of Object.entries(entry.byStatus)) {
      lines.push(`http_requests_total{${labels},status="${status}"} ${count}`);
    }

    const p50 = percentile(entry.durations, 50);
    const p95 = percentile(entry.durations, 95);
    const p99 = percentile(entry.durations, 99);

    lines.push(`http_request_duration_p50_ms{${labels}} ${p50.toFixed(2)}`);
    lines.push(`http_request_duration_p95_ms{${labels}} ${p95.toFixed(2)}`);
    lines.push(`http_request_duration_p99_ms{${labels}} ${p99.toFixed(2)}`);
  }

  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(lines.join("\n") + "\n");
}

export function resetMetrics() {
  metrics.requests.clear();
  metrics.startTime = Date.now();
}

/**
 * Performance profiling endpoint — returns JSON with per-route stats and process metrics.
 */
export function performanceEndpoint(_req, res) {
  const uptime = (Date.now() - metrics.startTime) / 1000;
  const mem = process.memoryUsage();

  const routes = [];
  for (const [key, entry] of metrics.requests) {
    const [method, route] = key.split(" ");
    const sorted = [...entry.durations].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    routes.push({
      method,
      route,
      totalRequests: entry.total,
      statusCodes: entry.byStatus,
      latency: {
        min: sorted.length > 0 ? +sorted[0].toFixed(2) : 0,
        max: sorted.length > 0 ? +sorted[sorted.length - 1].toFixed(2) : 0,
        avg: sorted.length > 0 ? +(sum / sorted.length).toFixed(2) : 0,
        p50: +percentile(sorted, 50).toFixed(2),
        p95: +percentile(sorted, 95).toFixed(2),
        p99: +percentile(sorted, 99).toFixed(2),
      },
    });
  }

  // Sort by total requests descending
  routes.sort((a, b) => b.totalRequests - a.totalRequests);

  res.json({
    uptime: +uptime.toFixed(2),
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      heapUsed: +(mem.heapUsed / 1024 / 1024).toFixed(2) + " MB",
      heapTotal: +(mem.heapTotal / 1024 / 1024).toFixed(2) + " MB",
      rss: +(mem.rss / 1024 / 1024).toFixed(2) + " MB",
      external: +(mem.external / 1024 / 1024).toFixed(2) + " MB",
    },
    routes,
    summary: {
      totalRoutes: routes.length,
      totalRequests: routes.reduce((sum, r) => sum + r.totalRequests, 0),
    },
  });
}
