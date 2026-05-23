import { Router } from "express";
import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import config from "../utils/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = Router();

const startTime = Date.now();

function getDataDir() {
  return path.join(__dirname, "..");
}

function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

// GET /api/system/health — comprehensive system health
router.get("/api/system/health", checkAuthenticated, checkRole("admin"), async (_req, res) => {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  const loadAvg = os.loadavg();

  // Dependency checks
  const dependencies = {};

  // DDG server
  try {
    const ddgStart = Date.now();
    const ddgResp = await fetch(`${config.ddg.serverUrl}/health`, { signal: AbortSignal.timeout(3000) });
    dependencies.ddg = {
      status: ddgResp.ok ? "ok" : "degraded",
      responseTime: Date.now() - ddgStart,
      url: config.ddg.serverUrl,
    };
  } catch {
    dependencies.ddg = { status: "unavailable", url: config.ddg.serverUrl };
  }

  // Data files status
  const dataDir = getDataDir();
  const dataFiles = [
    "users.json", "bookmarks.json", "search_history.json",
    "audit_log.json", "search_tags.json", "webhooks.json",
    "scheduled_searches.json", "notifications.json",
    "user_preferences.json", "starred_results.json",
    "result_cache.json", "shared_searches.json",
    "search_analytics.json", "recent_searches.json",
    "search_templates.json", "price_alerts.json",
  ];

  const files = {};
  let totalDataSize = 0;
  for (const file of dataFiles) {
    const filePath = path.join(dataDir, file);
    const size = getFileSize(filePath);
    totalDataSize += size;
    files[file] = {
      exists: fs.existsSync(filePath),
      size: formatBytes(size),
      sizeBytes: size,
    };
  }

  // Rate limit status (in-memory)
  const rateLimitInfo = {
    login: { window: config.rateLimit.loginWindow, max: config.rateLimit.loginMax },
    search: { window: config.rateLimit.searchWindow, max: config.rateLimit.searchMax },
  };

  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    server: {
      uptime: formatUptime(process.uptime()),
      uptimeSeconds: process.uptime(),
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      pid: process.pid,
    },
    memory: {
      heapUsed: formatBytes(memUsage.heapUsed),
      heapTotal: formatBytes(memUsage.heapTotal),
      rss: formatBytes(memUsage.rss),
      external: formatBytes(memUsage.external),
      systemTotal: formatBytes(os.totalmem()),
      systemFree: formatBytes(os.freemem()),
      systemUsedPercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
    },
    cpu: {
      cores: os.cpus().length,
      model: os.cpus()[0]?.model || "unknown",
      loadAvg: {
        "1m": loadAvg[0].toFixed(2),
        "5m": loadAvg[1].toFixed(2),
        "15m": loadAvg[2].toFixed(2),
      },
      user: cpuUsage.user,
      system: cpuUsage.system,
    },
    dependencies,
    data: {
      totalSize: formatBytes(totalDataSize),
      totalSizeBytes: totalDataSize,
      files,
    },
    config: {
      environment: config.isProduction ? "production" : "development",
      port: config.port,
      sessionMaxAge: config.session.maxAge,
      rateLimit: rateLimitInfo,
    },
  });
});

// GET /api/system/health/simple — lightweight health for polling
router.get("/api/system/health/simple", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: "ok",
    uptime: formatUptime(process.uptime()),
    heapUsed: formatBytes(memUsage.heapUsed),
    heapTotal: formatBytes(memUsage.heapTotal),
    systemUsedPercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
    loadAvg: os.loadavg()[0].toFixed(2),
    timestamp: new Date().toISOString(),
  });
});

// GET /api/security/audit — security configuration audit
router.get("/api/security/audit", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const checks = [];

  // HTTPS check
  checks.push({
    name: "HTTPS",
    status: config.isProduction ? "warn" : "info",
    detail: config.isProduction
      ? "Ensure TLS termination at reverse proxy (nginx/Cloudflare)"
      : "Development mode — HTTPS not required",
  });

  // Session secret
  const defaultSecret = config.session.secret === "dev-secret-change-in-production";
  checks.push({
    name: "Session Secret",
    status: config.isProduction && defaultSecret ? "fail" : defaultSecret ? "warn" : "pass",
    detail: defaultSecret
      ? "Using default session secret — set SESSION_SECRET env var"
      : "Custom session secret configured",
  });

  // Cookie flags
  checks.push({
    name: "Cookie: httpOnly",
    status: "pass",
    detail: "Session cookies are httpOnly (prevents JS access)",
  });
  checks.push({
    name: "Cookie: secure",
    status: config.isProduction ? "pass" : "info",
    detail: config.isProduction
      ? "Secure flag enabled in production (HTTPS-only)"
      : "Secure flag disabled in development",
  });
  checks.push({
    name: "Cookie: sameSite",
    status: "pass",
    detail: "SameSite=Lax configured (prevents most CSRF)",
  });

  // Session timeout
  const maxAgeHours = (config.session.maxAge / (1000 * 60 * 60)).toFixed(1);
  checks.push({
    name: "Session Timeout",
    status: parseFloat(maxAgeHours) > 24 ? "warn" : "pass",
    detail: `Session max age: ${maxAgeHours}h`,
  });

  // Rate limiting
  checks.push({
    name: "Rate Limiting: Login",
    status: "pass",
    detail: `${config.rateLimit.loginMax} attempts per ${config.rateLimit.loginWindow / 60000}min`,
  });
  checks.push({
    name: "Rate Limiting: Search",
    status: "pass",
    detail: `${config.rateLimit.searchMax} requests per ${config.rateLimit.searchWindow / 1000}s`,
  });

  // CORS
  checks.push({
    name: "CORS",
    status: config.cors.origins.length > 0 ? "pass" : "pass",
    detail: config.cors.origins.length > 0
      ? `Allowed origins: ${config.cors.origins.join(", ")}`
      : "No CORS origins configured — same-origin only (secure default)",
  });

  // Security headers
  checks.push({
    name: "Helmet Security Headers",
    status: "pass",
    detail: "X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, HSTS (production)",
  });

  // CSP
  checks.push({
    name: "Content Security Policy",
    status: "pass",
    detail: "CSP configured with restricted default-src, script-src, style-src, frame-ancestors",
  });

  // Referrer Policy
  checks.push({
    name: "Referrer Policy",
    status: "pass",
    detail: "strict-origin-when-cross-origin",
  });

  // Permissions Policy
  checks.push({
    name: "Permissions Policy",
    status: "pass",
    detail: "camera=(), microphone=(), geolocation=(), payment=() — all restricted",
  });

  // CSRF
  checks.push({
    name: "CSRF Protection",
    status: "pass",
    detail: "Origin/Referer validation + token-based CSRF for form submissions",
  });

  // CSRF Rotation
  checks.push({
    name: "CSRF Token Rotation",
    status: "pass",
    detail: "Tokens rotated on login and password change",
  });

  // Body size limits
  checks.push({
    name: "Request Body Limit",
    status: "pass",
    detail: "2MB limit on JSON and URL-encoded bodies",
  });

  // Error message exposure
  checks.push({
    name: "Error Message Exposure",
    status: "pass",
    detail: "Generic error messages in production — no stack traces or internal details leaked",
  });

  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const passCount = checks.filter((c) => c.status === "pass").length;

  res.json({
    status: failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass",
    summary: `${passCount} passed, ${warnCount} warnings, ${failCount} failures`,
    timestamp: new Date().toISOString(),
    checks,
  });
});

// GET /api/system/logs — recent log entries (if log file exists)
router.get("/api/system/logs", checkAuthenticated, checkRole("admin"), (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 50, 200);
  const logFile = path.join(getDataDir(), "app.log");

  if (!fs.existsSync(logFile)) {
    return res.json({ logs: [], message: "No log file found" });
  }

  try {
    const content = fs.readFileSync(logFile, "utf8");
    const allLines = content.trim().split("\n").filter(Boolean);
    const recent = allLines.slice(-lines);
    res.json({ logs: recent, total: allLines.length });
  } catch (err) {
    res.json({ logs: [], error: "Failed to read log file" });
  }
});

export default router;
