import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import errorRateRoutes from "../routes/errorRateMonitor.js";
import {
  recordError,
  recordSuccess,
  getErrorRate,
  getErrorRatesByEndpoint,
  checkAlerts,
  getErrorStats,
  clearErrorData,
} from "../utils/errorRateMonitor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "error_rate_data.json");

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
  app.use(errorRateRoutes);
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

describe("Error Rate Monitor", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearErrorData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("recordError records an error", () => {
      const record = recordError({
        endpoint: "/api/search",
        method: "GET",
        statusCode: 500,
        errorMessage: "Internal error",
        userId: "user1",
        ip: "127.0.0.1",
      });
      expect(record).toHaveProperty("endpoint", "/api/search");
      expect(record).toHaveProperty("statusCode", 500);
      expect(record).toHaveProperty("timestamp");
    });

    test("recordSuccess records a success", () => {
      const record = recordSuccess({
        endpoint: "/api/search",
        method: "GET",
        statusCode: 200,
      });
      expect(record).toHaveProperty("isSuccess", true);
      expect(record).toHaveProperty("statusCode", 200);
    });

    test("getErrorRate calculates error rate", () => {
      recordError({ endpoint: "/api/search", statusCode: 500 });
      recordError({ endpoint: "/api/search", statusCode: 500 });
      recordSuccess({ endpoint: "/api/search", statusCode: 200 });
      recordSuccess({ endpoint: "/api/search", statusCode: 200 });
      recordSuccess({ endpoint: "/api/search", statusCode: 200 });

      const rate = getErrorRate({ minutes: 1 });
      expect(rate.totalRequests).toBe(5);
      expect(rate.errorCount).toBe(2);
      expect(rate.errorRate).toBe(40);
    });

    test("getErrorRate filters by endpoint", () => {
      recordError({ endpoint: "/api/search", statusCode: 500 });
      recordSuccess({ endpoint: "/api/bookmarks", statusCode: 200 });

      const searchRate = getErrorRate({ minutes: 1, endpoint: "/api/search" });
      expect(searchRate.totalRequests).toBe(1);
      expect(searchRate.errorCount).toBe(1);
    });

    test("getErrorRate handles empty data", () => {
      const rate = getErrorRate({ minutes: 1 });
      expect(rate.totalRequests).toBe(0);
      expect(rate.errorCount).toBe(0);
      expect(rate.errorRate).toBe(0);
    });

    test("getErrorRatesByEndpoint groups by endpoint", () => {
      recordError({ endpoint: "/api/search", method: "GET", statusCode: 500 });
      recordError({ endpoint: "/api/search", method: "GET", statusCode: 500 });
      recordSuccess({ endpoint: "/api/search", method: "GET", statusCode: 200 });
      recordSuccess({ endpoint: "/api/bookmarks", method: "GET", statusCode: 200 });

      const rates = getErrorRatesByEndpoint({ minutes: 1 });
      expect(rates.endpoints.length).toBe(2);
      const searchEndpoint = rates.endpoints.find((e) => e.endpoint.includes("/api/search"));
      expect(searchEndpoint.errorRate).toBeCloseTo(66.67, 0);
    });

    test("getErrorRatesByEndpoint returns empty for no data", () => {
      const rates = getErrorRatesByEndpoint({ minutes: 1 });
      expect(rates.endpoints).toEqual([]);
    });

    test("checkAlerts triggers alerts when threshold exceeded", () => {
      // 80% error rate with 10 requests
      for (let i = 0; i < 8; i++) recordError({ endpoint: "/api/test", statusCode: 500 });
      for (let i = 0; i < 2; i++) recordSuccess({ endpoint: "/api/test", statusCode: 200 });

      const alerts = checkAlerts({ threshold: 5, minutes: 1 });
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0]).toHaveProperty("severity");
      expect(alerts[0].endpoint).toContain("/api/test");
    });

    test("checkAlerts returns empty when below threshold", () => {
      recordError({ endpoint: "/api/test", statusCode: 500 });
      for (let i = 0; i < 20; i++) recordSuccess({ endpoint: "/api/test", statusCode: 200 });

      const alerts = checkAlerts({ threshold: 10, minutes: 1 });
      expect(alerts.length).toBe(0);
    });

    test("checkAlerts assigns severity levels", () => {
      // 100% error rate
      for (let i = 0; i < 10; i++) recordError({ endpoint: "/api/critical", statusCode: 500 });

      const alerts = checkAlerts({ threshold: 5, minutes: 1 });
      expect(alerts.length).toBeGreaterThan(0);
      expect(["medium", "high", "critical"]).toContain(alerts[0].severity);
    });

    test("getErrorStats returns stats", () => {
      recordError({ endpoint: "/api/search", statusCode: 500 });
      recordError({ endpoint: "/api/search", statusCode: 404 });
      recordSuccess({ endpoint: "/api/search", statusCode: 200 });

      const stats = getErrorStats({ hours: 1 });
      expect(stats.totalErrors).toBe(2);
      expect(stats.topStatusCodes.length).toBeGreaterThan(0);
      expect(stats.topErrorEndpoints.length).toBeGreaterThan(0);
    });

    test("getErrorStats handles empty data", () => {
      const stats = getErrorStats({ hours: 1 });
      expect(stats.totalErrors).toBe(0);
      expect(stats.totalAlerts).toBe(0);
    });

    test("clearErrorData clears all data", () => {
      recordError({ endpoint: "/api/search", statusCode: 500 });
      clearErrorData();
      const rate = getErrorRate({ minutes: 1 });
      expect(rate.totalRequests).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/error-rate/record-error requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/error-rate/record-error", {
        method: "POST",
        body: { endpoint: "/api/search", statusCode: 500 },
      });
      expect(status).toBe(401);
    });

    test("POST /api/error-rate/record-error records error", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/error-rate/record-error", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { endpoint: "/api/search", method: "GET", statusCode: 500 },
      });
      expect(status).toBe(201);
      expect(body.endpoint).toBe("/api/search");
      expect(body.statusCode).toBe(500);
    });

    test("POST /api/error-rate/record-success requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/error-rate/record-success", {
        method: "POST",
        body: { endpoint: "/api/search", statusCode: 200 },
      });
      expect(status).toBe(401);
    });

    test("POST /api/error-rate/record-success records success", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/error-rate/record-success", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { endpoint: "/api/search", method: "GET", statusCode: 200 },
      });
      expect(status).toBe(201);
      expect(body.isSuccess).toBe(true);
    });

    test("GET /api/error-rate/rate requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/error-rate/rate", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/error-rate/rate returns rate for admin", async () => {
      recordError({ endpoint: "/api/search", statusCode: 500 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/error-rate/rate", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalRequests");
      expect(body).toHaveProperty("errorRate");
    });

    test("GET /api/error-rate/endpoints requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/error-rate/endpoints", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/error-rate/endpoints returns rates for admin", async () => {
      recordError({ endpoint: "/api/search", statusCode: 500 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/error-rate/endpoints", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("endpoints");
    });

    test("GET /api/error-rate/alerts requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/error-rate/alerts", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/error-rate/alerts returns alerts for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/error-rate/alerts", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("alerts");
    });

    test("GET /api/error-rate/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/error-rate/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/error-rate/stats returns stats for admin", async () => {
      recordError({ endpoint: "/api/search", statusCode: 500 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/error-rate/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalErrors");
    });

    test("DELETE /api/error-rate/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/error-rate/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/error-rate/clear clears for admin", async () => {
      recordError({ endpoint: "/api/search", statusCode: 500 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/error-rate/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
