import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import express from "express";
import http from "http";
import { metricsMiddleware, performanceEndpoint, resetMetrics } from "../middleware/metrics.js";

let server;
let baseUrl;

function makeRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
            json: () => Promise.resolve(JSON.parse(body.toString("utf8"))),
          });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(metricsMiddleware);
  app.get("/api/performance", performanceEndpoint);

  app.get("/api/fast", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/slow", (_req, res) => {
    setTimeout(() => res.json({ ok: true }), 20);
  });

  app.get("/api/error", (_req, res) => {
    res.status(500).json({ error: "fail" });
  });

  return app;
}

beforeAll(async () => {
  const app = createTestApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetMetrics();
});

describe("Performance Profiling Endpoint", () => {
  test("GET /api/performance returns JSON", async () => {
    const res = await makeRequest(`${baseUrl}/api/performance`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.uptime).toBeDefined();
    expect(data.process).toBeDefined();
    expect(data.routes).toBeDefined();
    expect(data.summary).toBeDefined();
  });

  test("Includes process memory stats", async () => {
    const res = await makeRequest(`${baseUrl}/api/performance`);
    const data = await res.json();
    expect(data.process.heapUsed).toContain("MB");
    expect(data.process.heapTotal).toContain("MB");
    expect(data.process.rss).toContain("MB");
    expect(data.process.pid).toBe(process.pid);
    expect(data.process.nodeVersion).toBeDefined();
  });

  test("Tracks per-route latency percentiles", async () => {
    await makeRequest(`${baseUrl}/api/fast`);
    await makeRequest(`${baseUrl}/api/fast`);

    const res = await makeRequest(`${baseUrl}/api/performance`);
    const data = await res.json();

    const fastRoute = data.routes.find((r) => r.route === "/api/fast");
    expect(fastRoute).toBeDefined();
    expect(fastRoute.totalRequests).toBe(2);
    expect(fastRoute.latency.min).toBeGreaterThanOrEqual(0);
    expect(fastRoute.latency.max).toBeGreaterThanOrEqual(fastRoute.latency.min);
    expect(fastRoute.latency.p50).toBeGreaterThanOrEqual(0);
    expect(fastRoute.latency.p95).toBeGreaterThanOrEqual(fastRoute.latency.p50);
    expect(fastRoute.latency.p99).toBeGreaterThanOrEqual(fastRoute.latency.p95);
  });

  test("Tracks status codes per route", async () => {
    await makeRequest(`${baseUrl}/api/fast`);
    await makeRequest(`${baseUrl}/api/error`);

    const res = await makeRequest(`${baseUrl}/api/performance`);
    const data = await res.json();

    const errorRoute = data.routes.find((r) => r.route === "/api/error");
    expect(errorRoute).toBeDefined();
    expect(errorRoute.statusCodes["500"]).toBe(1);
  });

  test("Routes are sorted by total requests descending", async () => {
    await makeRequest(`${baseUrl}/api/fast`);
    await makeRequest(`${baseUrl}/api/fast`);
    await makeRequest(`${baseUrl}/api/fast`);
    await makeRequest(`${baseUrl}/api/slow`);

    const res = await makeRequest(`${baseUrl}/api/performance`);
    const data = await res.json();

    // /api/fast should come before /api/slow (3 > 1)
    const fastIdx = data.routes.findIndex((r) => r.route === "/api/fast");
    const slowIdx = data.routes.findIndex((r) => r.route === "/api/slow");
    expect(fastIdx).toBeLessThan(slowIdx);
  });

  test("Summary includes total route and request counts", async () => {
    await makeRequest(`${baseUrl}/api/fast`);
    await makeRequest(`${baseUrl}/api/slow`);

    const res = await makeRequest(`${baseUrl}/api/performance`);
    const data = await res.json();

    expect(data.summary.totalRoutes).toBeGreaterThanOrEqual(2);
    expect(data.summary.totalRequests).toBeGreaterThanOrEqual(2);
  });

  test("Uptime increases over time", async () => {
    const res1 = await makeRequest(`${baseUrl}/api/performance`);
    const data1 = await res1.json();
    expect(data1.uptime).toBeGreaterThanOrEqual(0);
  });
});
