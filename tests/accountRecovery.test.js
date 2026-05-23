import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_USERS_FILE = path.join(__dirname, "..", "users.json");
const TOKENS_FILE = path.join(__dirname, "..", "password_reset_tokens.json");

let originalUsers;
let server;
let baseUrl;

const { default: accountRecoveryRoutes } = await import("../routes/accountRecovery.js");

function makeRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || "GET",
      headers: options.headers || {},
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () =>
        resolve({ status: res.statusCode, json: () => Promise.resolve(JSON.parse(body)) })
      );
    });
    req.on("error", reject);
    if (options.body) req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: "test",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 86400000 },
  }));
  app.use(accountRecoveryRoutes);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

describe("Account Recovery", () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE))
      originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");

    const adminHash = await bcrypt.hash("Admin123!", 10);
    const userHash = await bcrypt.hash("Testpass1!", 10);
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify([
      {
        id: 1, username: "admin", password: adminHash,
        displayName: "Admin", role: "admin", features: [], createdAt: new Date().toISOString(),
      },
      {
        id: 2, username: "testuser", password: userHash,
        displayName: "Test User", role: "user", features: [], createdAt: new Date().toISOString(),
      },
    ], null, 2));

    const app = createTestApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
    if (originalUsers !== undefined) fs.writeFileSync(TEST_USERS_FILE, originalUsers);
    try { fs.unlinkSync(TOKENS_FILE); } catch {}
  });

  beforeEach(() => {
    try { fs.unlinkSync(TOKENS_FILE); } catch {}
  });

  test("POST /api/forgot-password requires username", async () => {
    const res = await makeRequest(`${baseUrl}/api/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/forgot-password returns success for existing user", async () => {
    const res = await makeRequest(`${baseUrl}/api/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.token).toBeDefined();
    expect(data.expiresIn).toBe("1 hour");
  });

  test("POST /api/forgot-password returns success for non-existing user (prevent enumeration)", async () => {
    const res = await makeRequest(`${baseUrl}/api/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nonexistent" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.token).toBeUndefined();
  });

  test("POST /api/forgot-password invalidates previous tokens", async () => {
    // Request first token
    const res1 = await makeRequest(`${baseUrl}/api/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser" }),
    });
    const data1 = await res1.json();

    // Request second token
    const res2 = await makeRequest(`${baseUrl}/api/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser" }),
    });
    const data2 = await res2.json();

    // First token should no longer work
    const validateRes = await makeRequest(`${baseUrl}/api/reset-password/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: data1.token }),
    });
    const validateData = await validateRes.json();
    expect(validateData.valid).toBe(false);

    // Second token should work
    const validateRes2 = await makeRequest(`${baseUrl}/api/reset-password/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: data2.token }),
    });
    const validateData2 = await validateRes2.json();
    expect(validateData2.valid).toBe(true);
  });

  test("POST /api/reset-password/validate validates token", async () => {
    // Request token
    const forgotRes = await makeRequest(`${baseUrl}/api/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser" }),
    });
    const { token } = await forgotRes.json();

    // Validate token
    const res = await makeRequest(`${baseUrl}/api/reset-password/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.valid).toBe(true);
    expect(data.username).toBe("testuser");
  });

  test("POST /api/reset-password/validate rejects invalid token", async () => {
    const res = await makeRequest(`${baseUrl}/api/reset-password/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "invalidtoken" }),
    });
    const data = await res.json();
    expect(data.valid).toBe(false);
  });

  test("POST /api/reset-password resets password with valid token", async () => {
    // Request token
    const forgotRes = await makeRequest(`${baseUrl}/api/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser" }),
    });
    const { token } = await forgotRes.json();

    // Reset password
    const res = await makeRequest(`${baseUrl}/api/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "Newpass123!" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    // Verify token is consumed
    const validateRes = await makeRequest(`${baseUrl}/api/reset-password/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const validateData = await validateRes.json();
    expect(validateData.valid).toBe(false);

    // Verify new password works
    const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
    const user = users.find((u) => u.username === "testuser");
    expect(bcrypt.compareSync("Newpass123!", user.password)).toBe(true);
  });

  test("POST /api/reset-password rejects weak password", async () => {
    // Request token
    const forgotRes = await makeRequest(`${baseUrl}/api/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser" }),
    });
    const { token } = await forgotRes.json();

    // Try weak password
    const res = await makeRequest(`${baseUrl}/api/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "weak" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/reset-password rejects invalid token", async () => {
    const res = await makeRequest(`${baseUrl}/api/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "invalidtoken", newPassword: "Newpass123!" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid or expired");
  });

  test("POST /api/reset-password requires token and password", async () => {
    const res1 = await makeRequest(`${baseUrl}/api/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: "Newpass123!" }),
    });
    expect(res1.status).toBe(400);

    const res2 = await makeRequest(`${baseUrl}/api/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "sometoken" }),
    });
    expect(res2.status).toBe(400);
  });
});
