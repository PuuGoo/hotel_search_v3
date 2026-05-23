import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import anomalyRoutes from "../routes/anomalyDetection.js";
import {
  recordRequest,
  getRequestRate,
  detectAnomalies,
  detectIPAnomalies,
  getAnomalyStats,
  clearAnomalyData,
} from "../utils/anomalyDetection.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "anomaly_data.json");

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
  app.use(anomalyRoutes);
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

describe("Anomaly Detection", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearAnomalyData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("recordRequest records a request", () => {
      const record = recordRequest({
        endpoint: "/api/search",
        method: "GET",
        userId: "user1",
        ip: "127.0.0.1",
        statusCode: 200,
        duration: 150,
      });
      expect(record).toHaveProperty("endpoint");
      expect(record).toHaveProperty("timestamp");
    });

    test("getRequestRate returns rate", () => {
      recordRequest({ endpoint: "/api/search" });
      recordRequest({ endpoint: "/api/search" });
      const rate = getRequestRate({ minutes: 1 });
      expect(rate.totalRequests).toBe(2);
      expect(rate).toHaveProperty("avgPerMinute");
    });

    test("getRequestRate filters by endpoint", () => {
      recordRequest({ endpoint: "/api/search" });
      recordRequest({ endpoint: "/api/bookmarks" });
      const rate = getRequestRate({ minutes: 1, endpoint: "/api/search" });
      expect(rate.totalRequests).toBe(1);
    });

    test("getRequestRate handles empty data", () => {
      const rate = getRequestRate({ minutes: 1 });
      expect(rate.totalRequests).toBe(0);
    });

    test("detectAnomalies detects spike", () => {
      // Write historical data with multiple time windows
      const now = Date.now();
      const requests = [];
      // Normal traffic: 5 requests per minute for 10 minutes
      for (let m = 0; m < 10; m++) {
        for (let i = 0; i < 5; i++) {
          requests.push({
            endpoint: "/api/search",
            method: "GET",
            timestamp: now - (10 - m) * 60 * 1000 + i * 1000,
          });
        }
      }
      // Spike: 100 requests in the latest minute
      for (let i = 0; i < 100; i++) {
        requests.push({
          endpoint: "/api/search",
          method: "GET",
          timestamp: now - 1000 + i,
        });
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify({ requests, alerts: [] }));

      const anomalies = detectAnomalies({ threshold: 1.5, lookbackMinutes: 15 });
      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0]).toHaveProperty("zScore");
    });

    test("detectAnomalies returns empty for normal traffic", () => {
      for (let i = 0; i < 5; i++) {
        recordRequest({ endpoint: "/api/search" });
      }
      const anomalies = detectAnomalies({ threshold: 5 });
      expect(anomalies.length).toBe(0);
    });

    test("detectIPAnomalies detects high-volume IP", () => {
      // Write data directly to avoid file I/O overhead
      const requests = [];
      for (let i = 0; i < 200; i++) {
        requests.push({ ip: "192.168.1.1", endpoint: "/api/search", timestamp: Date.now() - i });
      }
      // Add some normal IPs
      for (let i = 0; i < 5; i++) {
        requests.push({ ip: "10.0.0.1", endpoint: "/api/search", timestamp: Date.now() - i });
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify({ requests, alerts: [] }));

      const anomalies = detectIPAnomalies({ maxRequestsPerIP: 50 });
      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0].ip).toBe("192.168.1.1");
    });

    test("detectIPAnomalies returns empty for normal IPs", () => {
      recordRequest({ ip: "127.0.0.1" });
      const anomalies = detectIPAnomalies({ maxRequestsPerIP: 100 });
      expect(anomalies.length).toBe(0);
    });

    test("getAnomalyStats returns stats", () => {
      recordRequest({ endpoint: "/api/search" });
      const stats = getAnomalyStats();
      expect(stats.totalRequests).toBeGreaterThan(0);
      expect(stats).toHaveProperty("topEndpoints");
    });

    test("clearAnomalyData clears data", () => {
      recordRequest({ endpoint: "/api/search" });
      clearAnomalyData();
      const stats = getAnomalyStats();
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/anomaly/record requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/anomaly/record", {
        method: "POST",
        body: { endpoint: "/api/search" },
      });
      expect(status).toBe(401);
    });

    test("POST /api/anomaly/record records request", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/anomaly/record", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { endpoint: "/api/search", method: "GET" },
      });
      expect(status).toBe(201);
      expect(body.endpoint).toBe("/api/search");
    });

    test("GET /api/anomaly/rate requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/anomaly/rate", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/anomaly/rate returns rate for admin", async () => {
      recordRequest({ endpoint: "/api/search" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/anomaly/rate", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalRequests");
    });

    test("GET /api/anomaly/detect requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/anomaly/detect", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/anomaly/detect returns anomalies for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/anomaly/detect", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("anomalies");
    });

    test("GET /api/anomaly/ips requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/anomaly/ips", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/anomaly/ips returns anomalies for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/anomaly/ips", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("anomalies");
    });

    test("GET /api/anomaly/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/anomaly/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/anomaly/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/anomaly/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalRequests");
    });

    test("DELETE /api/anomaly/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/anomaly/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/anomaly/clear clears for admin", async () => {
      recordRequest({ endpoint: "/api/search" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/anomaly/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
