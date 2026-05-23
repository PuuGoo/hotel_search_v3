import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import devToolsRoutes from "../routes/devTools.js";
import { getTrace, getRecentTraces, getTraceStats, clearTraces } from "../middleware/pipelineTrace.js";
import { getAdaptiveStatus, adaptiveRateLimit, getServerLoad } from "../middleware/adaptiveRateLimit.js";
import { recordHealthCheck, getHealthHistory, getCurrentStatus, startHealthMonitoring, stopHealthMonitoring } from "../utils/healthHistory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HEALTH_FILE = path.join(__dirname, "..", "health_history.json");

let healthBackup;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    if (req.headers["x-test-user"]) {
      req.session.isAuthenticated = true;
      req.session.user = { id: req.headers["x-test-user"], role: req.headers["x-test-role"] || "user" };
    }
    next();
  });
  app.use(devToolsRoutes);
  return app;
}

function makeRequest(app, urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const req = http.request(
        { hostname: "localhost", port, path: urlPath, method: options.method || "GET", headers: { ...options.headers } },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            server.close();
            try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
            catch { resolve({ status: res.statusCode, body }); }
          });
        }
      );
      req.on("error", (err) => { server.close(); reject(err); });
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    });
  });
}

describe("Dev Tools", () => {
  beforeEach(() => {
    try { healthBackup = fs.readFileSync(HEALTH_FILE, "utf8"); } catch { healthBackup = null; }
    clearTraces();
  });

  afterEach(() => {
    stopHealthMonitoring();
    if (healthBackup) fs.writeFileSync(HEALTH_FILE, healthBackup);
    else { try { fs.unlinkSync(HEALTH_FILE); } catch { /* */ } }
  });

  describe("Pipeline Trace", () => {
    test("getRecentTraces returns empty initially", () => {
      const traces = getRecentTraces();
      expect(traces).toEqual([]);
    });

    test("getTraceStats returns stats", () => {
      const stats = getTraceStats();
      expect(stats.count).toBe(0);
      expect(stats.avgDuration).toBe(0);
    });

    test("clearTraces clears all", () => {
      clearTraces();
      expect(getRecentTraces().length).toBe(0);
    });
  });

  describe("Adaptive Rate Limit", () => {
    test("getServerLoad returns load metrics", () => {
      const load = getServerLoad();
      expect(load).toHaveProperty("cpu");
      expect(load).toHaveProperty("memory");
      expect(load).toHaveProperty("loadAvg");
      expect(load).toHaveProperty("cpuCount");
      expect(typeof load.cpu).toBe("number");
    });

    test("getAdaptiveStatus returns status", () => {
      const status = getAdaptiveStatus();
      expect(status).toHaveProperty("load");
      expect(status).toHaveProperty("baseMax");
      expect(status).toHaveProperty("currentMax");
      expect(status).toHaveProperty("throttled");
      expect(status).toHaveProperty("reduction");
    });

    test("adaptiveRateLimit middleware allows requests under limit", async () => {
      const app = express();
      app.use(adaptiveRateLimit({ baseMax: 10, windowMs: 60000 }));
      app.get("/test", (_req, res) => res.json({ ok: true }));

      const { status } = await makeRequest(app, "/test");
      expect(status).toBe(200);
    });

    test("adaptiveRateLimit blocks when exceeded", async () => {
      const app = express();
      app.use(adaptiveRateLimit({ baseMax: 2, windowMs: 60000 }));
      app.get("/test", (_req, res) => res.json({ ok: true }));

      // Make 3 requests quickly
      await makeRequest(app, "/test");
      await makeRequest(app, "/test");
      const { status } = await makeRequest(app, "/test");
      expect(status).toBe(429);
    });
  });

  describe("Health History", () => {
    test("recordHealthCheck stores entry", () => {
      fs.writeFileSync(HEALTH_FILE, JSON.stringify({ entries: [], startedAt: new Date().toISOString() }));
      recordHealthCheck({ server: { status: "ok" } }, "ok");
      const history = getHealthHistory();
      expect(history.totalChecks).toBeGreaterThan(0);
    });

    test("getHealthHistory returns history", () => {
      fs.writeFileSync(HEALTH_FILE, JSON.stringify({
        entries: [
          { timestamp: new Date().toISOString(), status: "ok", checks: {}, memory: 50, uptime: 100 },
        ],
        startedAt: new Date().toISOString(),
      }));
      const history = getHealthHistory(24);
      expect(history).toHaveProperty("uptimePercent");
      expect(history).toHaveProperty("totalChecks");
      expect(history).toHaveProperty("downtimePeriods");
    });

    test("getCurrentStatus returns current", () => {
      fs.writeFileSync(HEALTH_FILE, JSON.stringify({
        entries: [{ timestamp: new Date().toISOString(), status: "ok", memory: 50, uptime: 100 }],
        startedAt: new Date().toISOString(),
      }));
      const status = getCurrentStatus();
      expect(status.currentStatus).toBe("ok");
    });

    test("health history handles empty data", () => {
      const history = getHealthHistory();
      expect(history.totalChecks).toBe(0);
      expect(history.uptimePercent).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("GET /api/dev/traces requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/dev/traces", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/dev/traces returns traces for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/dev/traces", {
        headers: { "x-test-user": "admin1", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("traces");
      expect(body).toHaveProperty("stats");
    });

    test("GET /api/dev/health-history requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/dev/health-history", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/dev/health-status requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/dev/health-status");
      expect(status).toBe(401);
    });

    test("GET /api/dev/rate-limit-status requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/dev/rate-limit-status", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/dev/rate-limit-status returns status for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/dev/rate-limit-status", {
        headers: { "x-test-user": "admin1", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("load");
      expect(body).toHaveProperty("currentMax");
    });
  });
});
