import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import queryPerformanceRoutes from "../routes/queryPerformance.js";
import {
  recordQueryPerformance,
  getPerformanceStats,
  getSlowQueries,
  getQueryFrequency,
  getPerformanceTrends,
  clearPerformanceData,
} from "../utils/queryPerformance.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PERFORMANCE_FILE = path.join(__dirname, "..", "query_performance.json");

let performanceBackup;

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
  app.use(queryPerformanceRoutes);
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

describe("Query Performance", () => {
  beforeEach(() => {
    try { performanceBackup = fs.readFileSync(PERFORMANCE_FILE, "utf8"); } catch { performanceBackup = null; }
    clearPerformanceData();
  });

  afterEach(() => {
    if (performanceBackup) fs.writeFileSync(PERFORMANCE_FILE, performanceBackup);
    else { try { fs.unlinkSync(PERFORMANCE_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("recordQueryPerformance records entry", () => {
      const record = recordQueryPerformance({
        query: "hotel paris",
        engine: "ddg",
        duration: 500,
        resultCount: 10,
      });
      expect(record).toHaveProperty("id");
      expect(record.query).toBe("hotel paris");
      expect(record.engine).toBe("ddg");
      expect(record.duration).toBe(500);
    });

    test("getPerformanceStats returns stats", () => {
      recordQueryPerformance({ query: "hotel", engine: "ddg", duration: 100 });
      recordQueryPerformance({ query: "resort", engine: "google", duration: 200 });
      const stats = getPerformanceStats();
      expect(stats.totalQueries).toBe(2);
      expect(stats.avgDuration).toBe(150);
      expect(stats).toHaveProperty("p50Duration");
      expect(stats).toHaveProperty("p90Duration");
    });

    test("getPerformanceStats filters by engine", () => {
      recordQueryPerformance({ query: "hotel", engine: "ddg", duration: 100 });
      recordQueryPerformance({ query: "resort", engine: "google", duration: 200 });
      const stats = getPerformanceStats({ engine: "ddg" });
      expect(stats.totalQueries).toBe(1);
    });

    test("getPerformanceStats handles empty data", () => {
      const stats = getPerformanceStats();
      expect(stats.totalQueries).toBe(0);
      expect(stats.avgDuration).toBe(0);
    });

    test("getSlowQueries returns slow queries", () => {
      recordQueryPerformance({ query: "fast", engine: "ddg", duration: 100 });
      recordQueryPerformance({ query: "slow", engine: "ddg", duration: 2000 });
      const slowQueries = getSlowQueries({ threshold: 1000 });
      expect(slowQueries.length).toBe(1);
      expect(slowQueries[0].query).toBe("slow");
      expect(slowQueries[0].severity).toBeDefined();
    });

    test("getSlowQueries filters by engine", () => {
      recordQueryPerformance({ query: "slow ddg", engine: "ddg", duration: 2000 });
      recordQueryPerformance({ query: "slow google", engine: "google", duration: 2000 });
      const slowQueries = getSlowQueries({ engine: "ddg" });
      expect(slowQueries.length).toBe(1);
    });

    test("getQueryFrequency returns frequent queries", () => {
      recordQueryPerformance({ query: "hotel paris", engine: "ddg", duration: 100 });
      recordQueryPerformance({ query: "hotel paris", engine: "ddg", duration: 100 });
      recordQueryPerformance({ query: "hotel london", engine: "ddg", duration: 100 });
      const frequency = getQueryFrequency();
      expect(frequency.length).toBe(2);
      expect(frequency[0].query).toBe("hotel paris");
      expect(frequency[0].count).toBe(2);
    });

    test("getPerformanceTrends returns trends", () => {
      recordQueryPerformance({ query: "hotel", engine: "ddg", duration: 100 });
      recordQueryPerformance({ query: "resort", engine: "ddg", duration: 200 });
      const trends = getPerformanceTrends({ hours: 1 });
      expect(trends.length).toBeGreaterThan(0);
      expect(trends[0]).toHaveProperty("count");
      expect(trends[0]).toHaveProperty("avgDuration");
    });

    test("clearPerformanceData clears data", () => {
      recordQueryPerformance({ query: "hotel", engine: "ddg", duration: 100 });
      clearPerformanceData();
      const stats = getPerformanceStats();
      expect(stats.totalQueries).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("GET /api/performance/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/performance/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/performance/stats returns stats for admin", async () => {
      recordQueryPerformance({ query: "hotel", engine: "ddg", duration: 100 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/performance/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalQueries");
      expect(body).toHaveProperty("avgDuration");
    });

    test("GET /api/performance/slow returns slow queries", async () => {
      recordQueryPerformance({ query: "slow", engine: "ddg", duration: 2000 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/performance/slow", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("queries");
      expect(body.queries.length).toBe(1);
    });

    test("GET /api/performance/frequency returns frequency", async () => {
      recordQueryPerformance({ query: "hotel", engine: "ddg", duration: 100 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/performance/frequency", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("queries");
    });

    test("GET /api/performance/trends returns trends", async () => {
      recordQueryPerformance({ query: "hotel", engine: "ddg", duration: 100 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/performance/trends", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("trends");
    });

    test("POST /api/performance/record requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/performance/record", {
        method: "POST",
        body: { query: "hotel", engine: "ddg", duration: 100 },
      });
      expect(status).toBe(401);
    });

    test("POST /api/performance/record requires query, engine, duration", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/performance/record", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/performance/record records entry", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/performance/record", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { query: "hotel", engine: "ddg", duration: 100 },
      });
      expect(status).toBe(201);
      expect(body.query).toBe("hotel");
    });

    test("DELETE /api/performance/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/performance/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/performance/clear clears data for admin", async () => {
      recordQueryPerformance({ query: "hotel", engine: "ddg", duration: 100 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/performance/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
