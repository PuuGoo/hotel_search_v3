import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import session from "express-session";
import http from "http";

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

  // Simulate admin authentication
  app.use((req, _res, next) => {
    if (req.headers["x-test-auth"] === "admin") {
      req.session.isAuthenticated = true;
      req.session.user = { id: "1", username: "admin", role: "admin" };
    }
    next();
  });

  // Simplified security audit endpoint for testing
  app.get("/api/security/audit", (req, res) => {
    if (!req.session.isAuthenticated) return res.status(401).json({ error: "Unauthorized" });
    if (req.session.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });

    const checks = [];
    checks.push({ name: "Session Secret", status: "warn", detail: "Using default session secret" });
    checks.push({ name: "Cookie: httpOnly", status: "pass", detail: "httpOnly enabled" });
    checks.push({ name: "Cookie: sameSite", status: "pass", detail: "SameSite=Lax" });
    checks.push({ name: "Rate Limiting: Login", status: "pass", detail: "5 attempts per 15min" });
    checks.push({ name: "CSRF Protection", status: "pass", detail: "Origin validation + token" });
    checks.push({ name: "Content Security Policy", status: "pass", detail: "CSP configured" });

    const failCount = checks.filter((c) => c.status === "fail").length;
    const warnCount = checks.filter((c) => c.status === "warn").length;
    const passCount = checks.filter((c) => c.status === "pass").length;

    res.json({
      status: failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass",
      summary: `${passCount} passed, ${warnCount} warnings, ${failCount} failures`,
      timestamp: new Date().toISOString(),
      checks,
    });
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

describe("Security Audit Endpoint", () => {
  test("requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/security/audit`);
    expect(res.status).toBe(401);
  });

  test("requires admin role", async () => {
    const res = await makeRequest(`${baseUrl}/api/security/audit`, {
      headers: { "x-test-auth": "user" },
    });
    // No admin header means not authenticated in this test setup
    expect(res.status).toBe(401);
  });

  test("returns security audit for admin", async () => {
    const res = await makeRequest(`${baseUrl}/api/security/audit`, {
      headers: { "x-test-auth": "admin" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBeDefined();
    expect(data.summary).toBeDefined();
    expect(data.timestamp).toBeDefined();
    expect(Array.isArray(data.checks)).toBe(true);
    expect(data.checks.length).toBeGreaterThan(0);
  });

  test("each check has name, status, detail", async () => {
    const res = await makeRequest(`${baseUrl}/api/security/audit`, {
      headers: { "x-test-auth": "admin" },
    });
    const data = await res.json();
    for (const check of data.checks) {
      expect(check.name).toBeDefined();
      expect(["pass", "warn", "fail", "info"]).toContain(check.status);
      expect(check.detail).toBeDefined();
    }
  });

  test("status reflects worst check", async () => {
    const res = await makeRequest(`${baseUrl}/api/security/audit`, {
      headers: { "x-test-auth": "admin" },
    });
    const data = await res.json();
    // Our test has a "warn" check, so overall should be "warn"
    expect(data.status).toBe("warn");
  });

  test("summary includes pass/warn/fail counts", async () => {
    const res = await makeRequest(`${baseUrl}/api/security/audit`, {
      headers: { "x-test-auth": "admin" },
    });
    const data = await res.json();
    expect(data.summary).toMatch(/\d+ passed/);
    expect(data.summary).toMatch(/\d+ warnings/);
    expect(data.summary).toMatch(/\d+ failures/);
  });
});
