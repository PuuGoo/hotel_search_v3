import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import responseTimeRoutes from "../routes/responseTimePercentiles.js";
import {
  recordResponseTime,
  getPercentiles,
  getPercentilesByEndpoint,
  getSlowEndpoints,
  getResponseTimeStats,
  clearResponseTimeData,
} from "../utils/responseTimePercentiles.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "response_time_data.json");

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
  app.use(responseTimeRoutes);
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

describe("Response Time Percentiles", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearResponseTimeData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("recordResponseTime records a sample", () => {
      const record = recordResponseTime({
        endpoint: "/api/search",
        method: "GET",
        statusCode: 200,
        duration: 150,
      });
      expect(record).toHaveProperty("endpoint", "/api/search");
      expect(record).toHaveProperty("duration", 150);
      expect(record).toHaveProperty("timestamp");
    });

    test("getPercentiles computes correct percentiles", () => {
      // Record 100 samples with known durations
      for (let i = 1; i <= 100; i++) {
        recordResponseTime({ endpoint: "/api/test", duration: i * 10 });
      }
      const result = getPercentiles({ endpoint: "/api/test", minutes: 60 });
      expect(result.count).toBe(100);
      expect(result.p50).toBe(500);
      expect(result.p95).toBe(950);
      expect(result.p99).toBe(990);
      expect(result.min).toBe(10);
      expect(result.max).toBe(1000);
    });

    test("getPercentiles handles empty data", () => {
      const result = getPercentiles({ minutes: 1 });
      expect(result.count).toBe(0);
      expect(result.p50).toBe(0);
      expect(result.p99).toBe(0);
    });

    test("getPercentiles filters by endpoint", () => {
      recordResponseTime({ endpoint: "/api/search", duration: 100 });
      recordResponseTime({ endpoint: "/api/bookmarks", duration: 5000 });

      const result = getPercentiles({ endpoint: "/api/search", minutes: 1 });
      expect(result.count).toBe(1);
      expect(result.avg).toBe(100);
    });

    test("getPercentilesByEndpoint groups by endpoint", () => {
      recordResponseTime({ endpoint: "/api/search", method: "GET", duration: 100 });
      recordResponseTime({ endpoint: "/api/search", method: "GET", duration: 200 });
      recordResponseTime({ endpoint: "/api/bookmarks", method: "GET", duration: 500 });

      const result = getPercentilesByEndpoint({ minutes: 1 });
      expect(result.endpoints.length).toBe(2);
      const search = result.endpoints.find((e) => e.endpoint.includes("/api/search"));
      expect(search.count).toBe(2);
    });

    test("getPercentilesByEndpoint returns empty for no data", () => {
      const result = getPercentilesByEndpoint({ minutes: 1 });
      expect(result.endpoints).toEqual([]);
    });

    test("getSlowEndpoints finds slow endpoints", () => {
      for (let i = 0; i < 50; i++) {
        recordResponseTime({ endpoint: "/api/slow", duration: 2000 + i });
      }
      recordResponseTime({ endpoint: "/api/fast", duration: 10 });

      const result = getSlowEndpoints({ thresholdMs: 1000, minutes: 1 });
      expect(result.slowEndpoints.length).toBe(1);
      expect(result.slowEndpoints[0].endpoint).toContain("/api/slow");
    });

    test("getSlowEndpoints returns empty when all fast", () => {
      recordResponseTime({ endpoint: "/api/fast", duration: 50 });

      const result = getSlowEndpoints({ thresholdMs: 1000, minutes: 1 });
      expect(result.slowEndpoints.length).toBe(0);
    });

    test("getResponseTimeStats returns summary", () => {
      recordResponseTime({ endpoint: "/api/test", duration: 100, statusCode: 200 });
      recordResponseTime({ endpoint: "/api/test", duration: 200, statusCode: 500 });

      const stats = getResponseTimeStats({ hours: 1 });
      expect(stats.totalSamples).toBe(2);
      expect(stats.overall.p50).toBeGreaterThan(0);
      expect(stats.statusDistribution).toHaveProperty("2xx");
      expect(stats.statusDistribution).toHaveProperty("5xx");
    });

    test("getResponseTimeStats handles empty data", () => {
      const stats = getResponseTimeStats({ hours: 1 });
      expect(stats.totalSamples).toBe(0);
      expect(stats.overall.p50).toBe(0);
    });

    test("clearResponseTimeData clears all data", () => {
      recordResponseTime({ endpoint: "/api/test", duration: 100 });
      clearResponseTimeData();
      const result = getPercentiles({ minutes: 1 });
      expect(result.count).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/response-time/record requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/response-time/record", {
        method: "POST",
        body: { endpoint: "/api/test", duration: 100 },
      });
      expect(status).toBe(401);
    });

    test("POST /api/response-time/record records sample", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/response-time/record", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { endpoint: "/api/test", method: "GET", statusCode: 200, duration: 150 },
      });
      expect(status).toBe(201);
      expect(body.duration).toBe(150);
    });

    test("GET /api/response-time/percentiles requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/response-time/percentiles", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/response-time/percentiles returns percentiles for admin", async () => {
      recordResponseTime({ endpoint: "/api/test", duration: 100 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/response-time/percentiles", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("p50");
      expect(body).toHaveProperty("p95");
      expect(body).toHaveProperty("p99");
    });

    test("GET /api/response-time/by-endpoint requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/response-time/by-endpoint", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/response-time/by-endpoint returns data for admin", async () => {
      recordResponseTime({ endpoint: "/api/test", duration: 100 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/response-time/by-endpoint", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("endpoints");
    });

    test("GET /api/response-time/slow requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/response-time/slow", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/response-time/slow returns data for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/response-time/slow", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("slowEndpoints");
    });

    test("GET /api/response-time/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/response-time/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/response-time/stats returns stats for admin", async () => {
      recordResponseTime({ endpoint: "/api/test", duration: 100 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/response-time/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalSamples");
    });

    test("DELETE /api/response-time/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/response-time/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/response-time/clear clears for admin", async () => {
      recordResponseTime({ endpoint: "/api/test", duration: 100 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/response-time/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
