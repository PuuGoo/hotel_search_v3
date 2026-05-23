import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import healthScoreRoutes from "../routes/apiHealthScore.js";
import {
  computeHealthScore,
  recordHealthScore,
  getHealthHistory,
  getHealthTrend,
  getHealthStats,
  clearHealthData,
} from "../utils/apiHealthScore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "health_score_data.json");

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
  app.use(healthScoreRoutes);
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

describe("API Health Score", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearHealthData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("computeHealthScore returns perfect score for ideal metrics", () => {
      const score = computeHealthScore({
        errorRate: 0,
        p95ResponseTime: 100,
        uptimePercent: 100,
        memoryPercent: 30,
        cpuPercent: 10,
      });
      expect(score.score).toBe(100);
      expect(score.grade).toBe("A");
      expect(score.status).toBe("healthy");
    });

    test("computeHealthScore returns low score for bad metrics", () => {
      const score = computeHealthScore({
        errorRate: 15,
        p95ResponseTime: 3000,
        uptimePercent: 90,
        memoryPercent: 99,
        cpuPercent: 99,
      });
      expect(score.score).toBeLessThan(40);
      expect(score.grade).toBe("F");
      expect(score.status).toBe("critical");
    });

    test("computeHealthScore handles defaults", () => {
      const score = computeHealthScore({});
      expect(score.score).toBeGreaterThan(80);
      expect(score).toHaveProperty("components");
      expect(score).toHaveProperty("weights");
    });

    test("computeHealthScore returns component scores", () => {
      const score = computeHealthScore({ errorRate: 2, p95ResponseTime: 500 });
      expect(score.components).toHaveProperty("errorRate");
      expect(score.components).toHaveProperty("responseTime");
      expect(score.components).toHaveProperty("uptime");
      expect(score.components).toHaveProperty("saturation");
    });

    test("computeHealthScore assigns correct grades", () => {
      // A = 90+, B = 75-89, C = 60-74, D = 40-59, F = <40
      expect(computeHealthScore({ errorRate: 0, p95ResponseTime: 100, uptimePercent: 100, memoryPercent: 20, cpuPercent: 10 }).grade).toBe("A");
      expect(computeHealthScore({ errorRate: 3, p95ResponseTime: 800, uptimePercent: 99.5, memoryPercent: 70, cpuPercent: 60 }).grade).toMatch(/[A-C]/);
    });

    test("recordHealthScore stores snapshot", () => {
      const score = recordHealthScore({ errorRate: 1 });
      expect(score).toHaveProperty("score");
      expect(score).toHaveProperty("timestamp");
    });

    test("getHealthHistory returns history", () => {
      recordHealthScore({ errorRate: 1 });
      recordHealthScore({ errorRate: 2 });
      const history = getHealthHistory({ minutes: 1 });
      expect(history.count).toBe(2);
    });

    test("getHealthHistory handles empty data", () => {
      const history = getHealthHistory({ minutes: 1 });
      expect(history.count).toBe(0);
    });

    test("getHealthTrend returns trend", () => {
      for (let i = 0; i < 6; i++) recordHealthScore({ errorRate: i });
      const trend = getHealthTrend({ minutes: 1 });
      expect(trend).toHaveProperty("trend");
      expect(["improving", "stable", "declining"]).toContain(trend.trend);
    });

    test("getHealthTrend handles insufficient data", () => {
      recordHealthScore({ errorRate: 1 });
      const trend = getHealthTrend({ minutes: 1 });
      expect(trend.trend).toBe("stable");
      expect(trend.samples).toBe(1);
    });

    test("getHealthStats returns stats", () => {
      recordHealthScore({ errorRate: 1 });
      const stats = getHealthStats({ hours: 1 });
      expect(stats.count).toBe(1);
      expect(stats).toHaveProperty("min");
      expect(stats).toHaveProperty("max");
      expect(stats).toHaveProperty("avg");
      expect(stats).toHaveProperty("current");
    });

    test("getHealthStats handles empty data", () => {
      const stats = getHealthStats({ hours: 1 });
      expect(stats.count).toBe(0);
    });

    test("clearHealthData clears all data", () => {
      recordHealthScore({ errorRate: 1 });
      clearHealthData();
      const stats = getHealthStats({ hours: 1 });
      expect(stats.count).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("GET /api/health-score requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/health-score", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/health-score returns score for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/health-score", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("score");
      expect(body).toHaveProperty("grade");
    });

    test("POST /api/health-score/record requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/health-score/record", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
        body: { errorRate: 1 },
      });
      expect(status).toBe(403);
    });

    test("POST /api/health-score/record records for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/health-score/record", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
        body: { errorRate: 1 },
      });
      expect(status).toBe(201);
      expect(body).toHaveProperty("score");
    });

    test("GET /api/health-score/history requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/health-score/history", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/health-score/history returns history for admin", async () => {
      recordHealthScore({ errorRate: 1 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/health-score/history", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("history");
    });

    test("GET /api/health-score/trend requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/health-score/trend", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/health-score/trend returns trend for admin", async () => {
      recordHealthScore({ errorRate: 1 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/health-score/trend", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("trend");
    });

    test("GET /api/health-score/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/health-score/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/health-score/stats returns stats for admin", async () => {
      recordHealthScore({ errorRate: 1 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/health-score/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("count");
    });

    test("DELETE /api/health-score/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/health-score/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/health-score/clear clears for admin", async () => {
      recordHealthScore({ errorRate: 1 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/health-score/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
