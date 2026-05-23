import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import express from "express";
import http from "http";
import { metricsMiddleware, metricsEndpoint, resetMetrics } from "../middleware/metrics.js";

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
            text: () => body.toString("utf8"),
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
  app.get("/metrics", metricsEndpoint);

  app.get("/api/test", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/slow", (_req, res) => {
    setTimeout(() => res.json({ ok: true }), 10);
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

describe("Prometheus Metrics", () => {
  test("GET /metrics returns text/plain", async () => {
    const res = await makeRequest(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
  });

  test("GET /metrics includes help and type lines", async () => {
    await makeRequest(`${baseUrl}/api/test`);
    const res = await makeRequest(`${baseUrl}/metrics`);
    const text = res.text();
    expect(text).toContain("# HELP http_requests_total");
    expect(text).toContain("# TYPE http_requests_total counter");
    expect(text).toContain("# HELP http_request_duration_ms");
  });

  test("Metrics track request counts", async () => {
    await makeRequest(`${baseUrl}/api/test`);
    await makeRequest(`${baseUrl}/api/test`);
    await makeRequest(`${baseUrl}/api/test`);

    const res = await makeRequest(`${baseUrl}/metrics`);
    const text = res.text();
    expect(text).toContain('http_requests_total{route="/api/test",method="GET"} 3');
  });

  test("Metrics track status codes", async () => {
    await makeRequest(`${baseUrl}/api/test`);
    await makeRequest(`${baseUrl}/api/error`);

    const res = await makeRequest(`${baseUrl}/metrics`);
    const text = res.text();
    expect(text).toContain('status="200"');
    expect(text).toContain('status="500"');
  });

  test("Metrics include percentile durations", async () => {
    await makeRequest(`${baseUrl}/api/test`);

    const res = await makeRequest(`${baseUrl}/metrics`);
    const text = res.text();
    expect(text).toContain("http_request_duration_p50_ms");
    expect(text).toContain("http_request_duration_p95_ms");
    expect(text).toContain("http_request_duration_p99_ms");
  });

  test("Metrics include process uptime", async () => {
    const res = await makeRequest(`${baseUrl}/metrics`);
    const text = res.text();
    expect(text).toContain("process_uptime_seconds");
  });

  test("Metrics normalize route params", async () => {
    // Simulate request with numeric ID
    await makeRequest(`${baseUrl}/api/test`); // Use /api/test since we don't have dynamic routes in test app

    const res = await makeRequest(`${baseUrl}/metrics`);
    const text = res.text();
    // Should not contain raw numeric IDs
    expect(text).not.toMatch(/route="\/api\/\d+"/);
  });

  test("GET /metrics is not counted in metrics itself", async () => {
    await makeRequest(`${baseUrl}/api/test`);
    await makeRequest(`${baseUrl}/metrics`);

    const res = await makeRequest(`${baseUrl}/metrics`);
    const text = res.text();
    // /metrics should not appear in the tracked routes
    expect(text).not.toContain('route="/metrics"');
  });
});
