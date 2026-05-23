import { describe, test, expect, beforeAll, afterAll, jest } from "@jest/globals";
import express from "express";
import session from "express-session";
import crypto from "crypto";
import http from "http";
import { rotateCsrfToken, generateCsrfToken, validateCsrfToken } from "../middleware/csrf.js";

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
          resolve({ status: res.statusCode, headers: res.headers, text: body, json: () => Promise.resolve(JSON.parse(body)) })
        );
      }
    );
    req.on("error", reject);
    if (options.body) req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));

  // Generate CSRF token on GET
  app.get("/api/csrf-token", generateCsrfToken, (req, res) => {
    res.json({ token: req.session.csrfToken });
  });

  // Simulate login with CSRF rotation
  app.post("/login", (req, res) => {
    req.session.isAuthenticated = true;
    req.session.user = { id: 1, username: "test" };
    // Rotate CSRF token after login
    rotateCsrfToken(req, res, () => {
      res.json({ success: true, csrfToken: req.session.csrfToken });
    });
  });

  // Simulate password change with CSRF rotation
  app.post("/api/change-password", (req, res) => {
    // Rotate CSRF token after password change
    rotateCsrfToken(req, res, () => {
      res.json({ success: true, csrfToken: req.session.csrfToken });
    });
  });

  // Protected endpoint requiring CSRF token
  app.post("/api/protected", validateCsrfToken, (req, res) => {
    res.json({ success: true });
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

describe("CSRF Token Rotation", () => {
  test("rotateCsrfToken generates new token in session", async () => {
    const loginRes = await makeRequest(`${baseUrl}/login`, { method: "POST", body: {} });
    const data = await loginRes.json();
    expect(data.success).toBe(true);
    expect(data.csrfToken).toBeDefined();
    expect(data.csrfToken.length).toBe(64); // 32 bytes = 64 hex chars
  });

  test("CSRF token changes after login", async () => {
    // Get initial token
    const tokenRes = await makeRequest(`${baseUrl}/api/csrf-token`);
    const { token: oldToken } = await tokenRes.json();

    // Login rotates token
    const loginRes = await makeRequest(`${baseUrl}/login`, { method: "POST", body: {} });
    const loginData = await loginRes.json();

    // New token should be different from old
    expect(loginData.csrfToken).not.toBe(oldToken);
  });

  test("CSRF token changes after password change", async () => {
    // Login first
    const loginRes = await makeRequest(`${baseUrl}/login`, { method: "POST", body: {} });
    const { csrfToken: token1 } = await loginRes.json();

    // Password change rotates token
    const changeRes = await makeRequest(`${baseUrl}/api/change-password`, { method: "POST", body: {} });
    const { csrfToken: token2 } = await changeRes.json();

    expect(token2).not.toBe(token1);
  });

  test("rotateCsrfToken function generates 32-byte hex token", () => {
    const session = { csrfToken: "old-token" };
    const req = { session };
    const mockNext = jest.fn();

    rotateCsrfToken(req, {}, mockNext);

    expect(session.csrfToken).not.toBe("old-token");
    expect(session.csrfToken.length).toBe(64);
    expect(mockNext).toHaveBeenCalled();
  });

  test("Multiple rotations produce unique tokens", () => {
    const tokens = new Set();
    for (let i = 0; i < 10; i++) {
      const session = {};
      rotateCsrfToken({ session }, {}, () => {});
      tokens.add(session.csrfToken);
    }
    expect(tokens.size).toBe(10);
  });
});
