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
const USAGE_FILE = path.join(__dirname, "..", "api_usage.json");

let originalUsers;
let adminCookie;
let userCookie;
let server;
let baseUrl;

const { default: apiUsageRoutes, trackApiCall, readUsage } = await import("../routes/apiUsage.js");

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
  app.use(apiUsageRoutes);
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

describe("API Usage Metrics", () => {
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
    try { fs.unlinkSync(USAGE_FILE); } catch {}
  });

  beforeEach(() => {
    fs.writeFileSync(USAGE_FILE, JSON.stringify({ totalCalls: 0, byEndpoint: {}, byUser: {}, byStatus: {}, byHour: {} }));
  });

  test("trackApiCall records usage data", () => {
    trackApiCall({ method: "GET", path: "/api/test", statusCode: 200, duration: 50, username: "admin" });

    const data = readUsage();
    expect(data.totalCalls).toBe(1);
    expect(data.byEndpoint["GET /api/test"].count).toBe(1);
    expect(data.byUser.admin.count).toBe(1);
    expect(data.byStatus["2xx"]).toBe(1);
  });

  test("trackApiCall accumulates counts", () => {
    trackApiCall({ method: "GET", path: "/api/test", statusCode: 200, duration: 50 });
    trackApiCall({ method: "GET", path: "/api/test", statusCode: 200, duration: 30 });
    trackApiCall({ method: "POST", path: "/api/data", statusCode: 201, duration: 100 });

    const data = readUsage();
    expect(data.totalCalls).toBe(3);
    expect(data.byEndpoint["GET /api/test"].count).toBe(2);
    expect(data.byEndpoint["GET /api/test"].totalDuration).toBe(80);
    expect(data.byEndpoint["POST /api/data"].count).toBe(1);
  });

  test("trackApiCall tracks errors", () => {
    trackApiCall({ method: "GET", path: "/api/fail", statusCode: 500, duration: 10 });
    trackApiCall({ method: "GET", path: "/api/fail", statusCode: 200, duration: 10 });

    const data = readUsage();
    expect(data.byEndpoint["GET /api/fail"].errors).toBe(1);
    expect(data.byStatus["5xx"]).toBe(1);
    expect(data.byStatus["2xx"]).toBe(1);
  });

  test("trackApiCall tracks anonymous users", () => {
    trackApiCall({ method: "GET", path: "/api/public", statusCode: 200, duration: 10 });

    const data = readUsage();
    expect(data.byUser.anonymous.count).toBe(1);
  });

  test("GET /api/admin/api-usage requires admin", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/api-usage`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/admin/api-usage returns stats", async () => {
    trackApiCall({ method: "GET", path: "/api/test", statusCode: 200, duration: 50, username: "admin" });
    trackApiCall({ method: "POST", path: "/api/data", statusCode: 201, duration: 100, username: "user" });

    const res = await makeRequest(`${baseUrl}/api/admin/api-usage`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.totalCalls).toBe(2);
    expect(data.topEndpoints.length).toBe(2);
    expect(data.topUsers.length).toBe(2);
  });

  test("GET /api/admin/api-usage includes hourly trend", async () => {
    trackApiCall({ method: "GET", path: "/api/test", statusCode: 200, duration: 50 });

    const res = await makeRequest(`${baseUrl}/api/admin/api-usage`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.hourlyTrend.length).toBeGreaterThan(0);
    expect(data.hourlyTrend[data.hourlyTrend.length - 1].count).toBe(1);
  });

  test("GET /api/admin/api-usage calculates error rate per endpoint", async () => {
    trackApiCall({ method: "GET", path: "/api/bad", statusCode: 500, duration: 10 });
    trackApiCall({ method: "GET", path: "/api/bad", statusCode: 200, duration: 10 });
    trackApiCall({ method: "GET", path: "/api/bad", statusCode: 200, duration: 10 });

    const res = await makeRequest(`${baseUrl}/api/admin/api-usage`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    const endpoint = data.topEndpoints.find(e => e.endpoint === "GET /api/bad");
    expect(endpoint.errorRate).toBe(33);
  });

  test("DELETE /api/admin/api-usage resets data", async () => {
    trackApiCall({ method: "GET", path: "/api/test", statusCode: 200, duration: 50 });

    const res = await makeRequest(`${baseUrl}/api/admin/api-usage`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    const data = readUsage();
    expect(data.totalCalls).toBe(0);
  });
});
