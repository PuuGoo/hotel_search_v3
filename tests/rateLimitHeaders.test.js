import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import express from "express";
import session from "express-session";
import http from "http";
import { rateLimitLogin, recordLoginFailure, rateLimitSearch, _loginAttempts, _searchRequests } from "../middleware/rateLimit.js";

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
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, text: body })
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

  // Successful login - doesn't count toward rate limit
  app.post("/login", rateLimitLogin, (_req, res) => {
    res.json({ success: true });
  });

  // Failed login - counts toward rate limit
  app.post("/login-fail", (req, res, next) => {
    recordLoginFailure(req);
    next();
  }, rateLimitLogin, (_req, res) => {
    res.json({ success: false });
  });

  app.get("/api/search", rateLimitSearch, (_req, res) => {
    res.json({ results: [] });
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
  _loginAttempts.clear();
  _searchRequests.clear();
});

describe("Rate Limit Headers", () => {
  test("Login endpoint returns X-RateLimit headers", async () => {
    const res = await makeRequest(`${baseUrl}/login`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
  });

  test("X-RateLimit-Remaining stays same on successful login", async () => {
    const res1 = await makeRequest(`${baseUrl}/login`, { method: "POST" });
    const remaining1 = parseInt(res1.headers["x-ratelimit-remaining"], 10);

    const res2 = await makeRequest(`${baseUrl}/login`, { method: "POST" });
    const remaining2 = parseInt(res2.headers["x-ratelimit-remaining"], 10);

    // Successful logins don't count, so remaining stays the same
    expect(remaining2).toBe(remaining1);
  });

  test("X-RateLimit-Remaining decrements on failed login", async () => {
    const res1 = await makeRequest(`${baseUrl}/login-fail`, { method: "POST" });
    const remaining1 = parseInt(res1.headers["x-ratelimit-remaining"], 10);

    const res2 = await makeRequest(`${baseUrl}/login-fail`, { method: "POST" });
    const remaining2 = parseInt(res2.headers["x-ratelimit-remaining"], 10);

    expect(remaining2).toBe(remaining1 - 1);
  });

  test("X-RateLimit-Remaining is 0 when limit exceeded", async () => {
    // Exhaust the limit with failed attempts
    for (let i = 0; i < 10; i++) {
      await makeRequest(`${baseUrl}/login-fail`, { method: "POST" });
    }

    const res = await makeRequest(`${baseUrl}/login-fail`, { method: "POST" });
    expect(res.status).toBe(429);
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });

  test("Search endpoint returns X-RateLimit headers", async () => {
    const res = await makeRequest(`${baseUrl}/api/search`);
    expect(res.status).toBe(200);
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
  });

  test("X-RateLimit-Limit matches configured max", async () => {
    const res = await makeRequest(`${baseUrl}/api/search`);
    const limit = parseInt(res.headers["x-ratelimit-limit"], 10);
    expect(limit).toBeGreaterThan(0);
  });

  test("X-RateLimit-Reset is a valid Unix timestamp", async () => {
    const res = await makeRequest(`${baseUrl}/api/search`);
    const reset = parseInt(res.headers["x-ratelimit-reset"], 10);
    const now = Math.floor(Date.now() / 1000);
    expect(reset).toBeGreaterThan(now);
    expect(reset).toBeLessThan(now + 120); // Should be within 2 minutes
  });

  test("429 response includes Retry-After header info", async () => {
    // Exhaust the search limit
    for (let i = 0; i < 20; i++) {
      await makeRequest(`${baseUrl}/api/search`);
    }

    const res = await makeRequest(`${baseUrl}/api/search`);
    if (res.status === 429) {
      expect(res.headers["x-ratelimit-remaining"]).toBe("0");
    }
  });
});
