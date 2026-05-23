import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import systemResourceRoutes from "../routes/systemResources.js";
import {
  recordSnapshot,
  getCurrentResources,
  getResourceHistory,
  getResourceStats,
  getResourceAlerts,
  clearResourceData,
} from "../utils/systemResources.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "system_resource_data.json");

let dataBackup;

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
  app.use(systemResourceRoutes);
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

function saveWithRetry(filePath, data) {
  let retries = 5;
  while (retries-- > 0) {
    try { fs.writeFileSync(filePath, data); return; }
    catch (e) { if (e.code === "EBUSY") { /* retry */ } else throw e; }
  }
}

describe("System Resource Monitoring", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearResourceData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("getCurrentResources returns live snapshot", () => {
      const snapshot = getCurrentResources();
      expect(snapshot).toHaveProperty("cpu");
      expect(snapshot).toHaveProperty("memory");
      expect(snapshot).toHaveProperty("uptime");
      expect(snapshot).toHaveProperty("loadAverage");
      expect(snapshot.cpu).toHaveProperty("usage");
      expect(snapshot.cpu).toHaveProperty("cores");
      expect(snapshot.memory).toHaveProperty("total");
      expect(snapshot.memory).toHaveProperty("free");
      expect(snapshot.memory).toHaveProperty("usagePercent");
    });

    test("recordSnapshot stores a snapshot", () => {
      const snapshot = recordSnapshot();
      expect(snapshot).toHaveProperty("timestamp");
      expect(snapshot).toHaveProperty("cpu");
      expect(snapshot).toHaveProperty("memory");
    });

    test("getResourceHistory returns history", () => {
      recordSnapshot();
      recordSnapshot();
      const history = getResourceHistory({ minutes: 1 });
      expect(history.count).toBe(2);
      expect(history.samples.length).toBe(2);
      expect(history.samples[0]).toHaveProperty("cpuUsage");
      expect(history.samples[0]).toHaveProperty("memoryUsagePercent");
    });

    test("getResourceHistory handles empty data", () => {
      const history = getResourceHistory({ minutes: 1 });
      expect(history.count).toBe(0);
      expect(history.samples).toEqual([]);
    });

    test("getResourceStats returns stats", () => {
      recordSnapshot();
      const stats = getResourceStats({ minutes: 1 });
      expect(stats.count).toBe(1);
      expect(stats).toHaveProperty("cpu");
      expect(stats).toHaveProperty("memory");
      expect(stats).toHaveProperty("heap");
      expect(stats.cpu).toHaveProperty("min");
      expect(stats.cpu).toHaveProperty("max");
      expect(stats.cpu).toHaveProperty("avg");
    });

    test("getResourceStats handles empty data", () => {
      const stats = getResourceStats({ minutes: 1 });
      expect(stats.count).toBe(0);
      expect(stats.cpu.min).toBe(0);
    });

    test("getResourceAlerts checks thresholds", () => {
      // With very low thresholds, should trigger alerts
      const alerts = getResourceAlerts({
        cpuThreshold: 0,
        memoryThreshold: 0,
        heapThreshold: 0,
      });
      expect(alerts.count).toBeGreaterThan(0);
      expect(alerts.alerts[0]).toHaveProperty("type");
      expect(alerts.alerts[0]).toHaveProperty("severity");
    });

    test("getResourceAlerts returns no alerts when within thresholds", () => {
      const alerts = getResourceAlerts({
        cpuThreshold: 99,
        memoryThreshold: 99,
        heapThreshold: 10000,
      });
      expect(alerts.count).toBe(0);
    });

    test("clearResourceData clears all data", () => {
      recordSnapshot();
      clearResourceData();
      const history = getResourceHistory({ minutes: 1 });
      expect(history.count).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("GET /api/system-resources/current requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/system-resources/current", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/system-resources/current returns resources for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/system-resources/current", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("cpu");
      expect(body).toHaveProperty("memory");
    });

    test("POST /api/system-resources/snapshot requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/system-resources/snapshot", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/system-resources/snapshot records for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/system-resources/snapshot", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(201);
      expect(body).toHaveProperty("timestamp");
      expect(body).toHaveProperty("cpu");
    });

    test("GET /api/system-resources/history requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/system-resources/history", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/system-resources/history returns history for admin", async () => {
      recordSnapshot();
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/system-resources/history", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("samples");
    });

    test("GET /api/system-resources/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/system-resources/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/system-resources/stats returns stats for admin", async () => {
      recordSnapshot();
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/system-resources/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("cpu");
      expect(body).toHaveProperty("memory");
    });

    test("GET /api/system-resources/alerts requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/system-resources/alerts", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/system-resources/alerts returns alerts for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/system-resources/alerts", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("alerts");
      expect(body).toHaveProperty("snapshot");
    });

    test("DELETE /api/system-resources/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/system-resources/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/system-resources/clear clears for admin", async () => {
      recordSnapshot();
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/system-resources/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
