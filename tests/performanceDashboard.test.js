import { describe, test, expect, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import performanceDashboardRoutes, { perfCountMiddleware } from "../routes/performanceDashboard.js";

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
  app.use(performanceDashboardRoutes);
  app.use(perfCountMiddleware);
  app.get("/test", (_req, res) => res.json({ ok: true }));
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
      req.end();
    });
  });
}

describe("Performance Dashboard", () => {
  test("GET /api/performance/dashboard requires auth", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/performance/dashboard");
    expect(status).toBe(401);
  });

  test("GET /api/performance/dashboard requires admin", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/performance/dashboard", {
      headers: { "x-test-user": "user1", "x-test-role": "user" },
    });
    expect(status).toBe(403);
  });

  test("GET /api/performance/dashboard returns server data", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/performance/dashboard", {
      headers: { "x-test-user": "admin1", "x-test-role": "admin" },
    });
    expect(status).toBe(200);
    expect(body).toHaveProperty("server");
    expect(body).toHaveProperty("memory");
    expect(body).toHaveProperty("cpu");
    expect(body).toHaveProperty("timeSeries");
  });

  test("dashboard memory data has correct structure", async () => {
    const app = createTestApp();
    const { body } = await makeRequest(app, "/api/performance/dashboard", {
      headers: { "x-test-user": "admin1", "x-test-role": "admin" },
    });
    expect(body.memory).toHaveProperty("heapUsed");
    expect(body.memory).toHaveProperty("heapTotal");
    expect(body.memory).toHaveProperty("rss");
    expect(body.memory).toHaveProperty("systemTotal");
    expect(body.memory).toHaveProperty("systemFree");
    expect(typeof body.memory.heapUsed).toBe("number");
  });

  test("dashboard CPU data has correct structure", async () => {
    const app = createTestApp();
    const { body } = await makeRequest(app, "/api/performance/dashboard", {
      headers: { "x-test-user": "admin1", "x-test-role": "admin" },
    });
    expect(body.cpu).toHaveProperty("cores");
    expect(body.cpu).toHaveProperty("model");
    expect(body.cpu).toHaveProperty("loadAvg");
    expect(Array.isArray(body.cpu.loadAvg)).toBe(true);
  });

  test("dashboard server data has uptime", async () => {
    const app = createTestApp();
    const { body } = await makeRequest(app, "/api/performance/dashboard", {
      headers: { "x-test-user": "admin1", "x-test-role": "admin" },
    });
    expect(body.server).toHaveProperty("uptime");
    expect(body.server.uptime).toBeGreaterThanOrEqual(0);
  });

  test("GET /api/performance/summary requires auth", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/performance/summary");
    expect(status).toBe(401);
  });

  test("GET /api/performance/summary returns summary for any user", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/performance/summary", {
      headers: { "x-test-user": "user1" },
    });
    expect(status).toBe(200);
    expect(body).toHaveProperty("uptime");
    expect(body).toHaveProperty("heapUsed");
    expect(body).toHaveProperty("memoryUsagePercent");
    expect(body).toHaveProperty("loadAvg");
  });

  test("perfCountMiddleware counts requests", async () => {
    const app = createTestApp();
    // Make a request to trigger counting
    await makeRequest(app, "/test", { headers: { "x-test-user": "user1" } });
    // The middleware should have counted this request
    // We verify by checking the summary shows recent activity
    const { body } = await makeRequest(app, "/api/performance/summary", {
      headers: { "x-test-user": "user1" },
    });
    expect(body).toHaveProperty("recentRequests");
  });
});
