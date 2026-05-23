import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
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

let originalUsers;
let adminCookie;
let userCookie;
let server;
let baseUrl;

const { default: rateLimitDashboardRoutes } = await import("../routes/rateLimitDashboard.js");

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
  app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
    const user = users.find((u) => u.username === username);
    if (user && (await bcrypt.compare(password, user.password))) {
      req.session.isAuthenticated = true;
      req.session.user = {
        id: user.id, username: user.username, role: user.role,
        displayName: user.displayName, features: user.features || [],
      };
      res.json({ success: true });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });
  app.use(rateLimitDashboardRoutes);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

async function loginAs(username, password) {
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}/login`);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: "POST", headers: { "Content-Type": "application/json" },
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve(res.headers["set-cookie"]));
    });
    req.write(JSON.stringify({ username, password }));
    req.end();
  });
}

describe("Rate Limit Dashboard", () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE))
      originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify([
      {
        id: 1, username: "admin", password: await bcrypt.hash("admin123", 10),
        displayName: "Admin", role: "admin", features: [], createdAt: new Date().toISOString(),
      },
      {
        id: 2, username: "user", password: await bcrypt.hash("user123", 10),
        displayName: "User", role: "user", features: [], createdAt: new Date().toISOString(),
      },
    ], null, 2));

    const app = createTestApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
    adminCookie = await loginAs("admin", "admin123");
    userCookie = await loginAs("user", "user123");
  });

  afterAll(() => {
    server?.close();
    if (originalUsers !== undefined) fs.writeFileSync(TEST_USERS_FILE, originalUsers);
  });

  test("GET /api/admin/rate-limits requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/rate-limits`);
    expect(res.status).toBe(401);
  });

  test("GET /api/admin/rate-limits requires admin", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/rate-limits`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/admin/rate-limits returns rate limit data", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/rate-limits`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("config");
    expect(data).toHaveProperty("login");
    expect(data).toHaveProperty("search");
    expect(data.config.login).toHaveProperty("max");
    expect(data.config.search).toHaveProperty("max");
  });

  test("GET /api/admin/rate-limits includes active entries", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/rate-limits`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.login).toHaveProperty("total");
    expect(data.login).toHaveProperty("entries");
    expect(data.search).toHaveProperty("total");
    expect(data.search).toHaveProperty("entries");
    expect(Array.isArray(data.login.entries)).toBe(true);
    expect(Array.isArray(data.search.entries)).toBe(true);
  });

  test("GET /api/rate-limit/status requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/rate-limit/status`);
    expect(res.status).toBe(401);
  });

  test("GET /api/rate-limit/status returns user status", async () => {
    const res = await makeRequest(`${baseUrl}/api/rate-limit/status`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("login");
    expect(data).toHaveProperty("search");
    expect(data.login).toHaveProperty("limit");
    expect(data.login).toHaveProperty("used");
    expect(data.login).toHaveProperty("remaining");
    expect(data.search).toHaveProperty("limit");
    expect(data.search).toHaveProperty("used");
    expect(data.search).toHaveProperty("remaining");
  });

  test("GET /api/rate-limit/status shows correct limits", async () => {
    const res = await makeRequest(`${baseUrl}/api/rate-limit/status`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.login.limit).toBeGreaterThan(0);
    expect(data.search.limit).toBeGreaterThan(0);
    expect(data.login.remaining).toBeLessThanOrEqual(data.login.limit);
    expect(data.search.remaining).toBeLessThanOrEqual(data.search.limit);
  });
});
