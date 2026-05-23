import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import session from "express-session";
import http from "http";
import { CircuitBreaker } from "../utils/circuitBreaker.js";

let server;
let baseUrl;

function makeRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () =>
          resolve({ status: res.statusCode, json: () => Promise.resolve(JSON.parse(body)) })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));

  // Simulate admin auth
  app.use((req, _res, next) => {
    if (req.headers["x-test-auth"] === "admin") {
      req.session.isAuthenticated = true;
      req.session.user = { role: "admin" };
    }
    next();
  });

  // Simulate circuit breaker dashboard
  const breakers = new Map();

  // Create test breakers
  const healthyBreaker = new CircuitBreaker();
  const failedBreaker = new CircuitBreaker({ failureThreshold: 1 });
  failedBreaker.onFailure(); // Trip the breaker

  breakers.set("tavily", healthyBreaker);
  breakers.set("google", failedBreaker);

  app.get("/api/circuit-breakers", (req, res) => {
    if (!req.session.isAuthenticated) return res.status(401).json({ error: "Unauthorized" });
    if (req.session.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });

    const statuses = [];
    for (const [name, breaker] of breakers) {
      const stats = breaker.getStats();
      statuses.push({
        name,
        state: stats.state,
        failureCount: stats.failureCount,
        healthy: stats.state !== "open",
      });
    }

    const allHealthy = statuses.every((s) => s.healthy);
    res.json({
      status: allHealthy ? "ok" : "degraded",
      totalBreakers: statuses.length,
      healthy: statuses.filter((s) => s.healthy).length,
      unhealthy: statuses.filter((s) => !s.healthy).length,
      breakers: statuses,
    });
  });

  app.post("/api/circuit-breakers/:name/reset", (req, res) => {
    if (!req.session.isAuthenticated) return res.status(401).json({ error: "Unauthorized" });
    const breaker = breakers.get(req.params.name);
    if (!breaker) return res.status(404).json({ error: "Not found" });
    breaker.reset();
    res.json({ success: true, name: req.params.name, state: breaker.getState() });
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

describe("Circuit Breaker Dashboard", () => {
  test("requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/circuit-breakers`);
    expect(res.status).toBe(401);
  });

  test("returns circuit breaker statuses for admin", async () => {
    const res = await makeRequest(`${baseUrl}/api/circuit-breakers`, {
      headers: { "x-test-auth": "admin" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.totalBreakers).toBe(2);
    expect(data.breakers.length).toBe(2);
  });

  test("reports degraded when a breaker is open", async () => {
    const res = await makeRequest(`${baseUrl}/api/circuit-breakers`, {
      headers: { "x-test-auth": "admin" },
    });
    const data = await res.json();
    expect(data.status).toBe("degraded");
    expect(data.unhealthy).toBe(1);
    expect(data.healthy).toBe(1);
  });

  test("each breaker has required fields", async () => {
    const res = await makeRequest(`${baseUrl}/api/circuit-breakers`, {
      headers: { "x-test-auth": "admin" },
    });
    const data = await res.json();
    for (const breaker of data.breakers) {
      expect(breaker.name).toBeDefined();
      expect(breaker.state).toBeDefined();
      expect(typeof breaker.failureCount).toBe("number");
      expect(typeof breaker.healthy).toBe("boolean");
    }
  });

  test("reset endpoint resets a circuit breaker", async () => {
    const res = await makeRequest(`${baseUrl}/api/circuit-breakers/google/reset`, {
      method: "POST",
      headers: { "x-test-auth": "admin" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.state).toBe("closed");
  });

  test("reset returns 404 for unknown breaker", async () => {
    const res = await makeRequest(`${baseUrl}/api/circuit-breakers/unknown/reset`, {
      method: "POST",
      headers: { "x-test-auth": "admin" },
    });
    expect(res.status).toBe(404);
  });
});
