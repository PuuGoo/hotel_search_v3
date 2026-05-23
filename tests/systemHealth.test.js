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

const { default: systemHealthRoutes } = await import("../routes/systemHealth.js");

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
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.displayName,
        features: user.features || [],
      };
      res.json({ success: true });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });
  app.use(systemHealthRoutes);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

async function loginAs(username, password) {
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}/login`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve(res.headers["set-cookie"]));
    });
    req.write(JSON.stringify({ username, password }));
    req.end();
  });
}

describe("System Health", () => {
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

  test("GET /api/system/health requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/system/health`);
    expect(res.status).toBe(401);
  });

  test("GET /api/system/health requires admin role", async () => {
    const res = await makeRequest(`${baseUrl}/api/system/health`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/system/health returns full health data", async () => {
    const res = await makeRequest(`${baseUrl}/api/system/health`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data).toHaveProperty("server");
    expect(data).toHaveProperty("memory");
    expect(data).toHaveProperty("cpu");
    expect(data).toHaveProperty("dependencies");
    expect(data).toHaveProperty("data");
    expect(data).toHaveProperty("config");
  });

  test("GET /api/system/health includes server info", async () => {
    const res = await makeRequest(`${baseUrl}/api/system/health`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.server).toHaveProperty("uptime");
    expect(data.server).toHaveProperty("nodeVersion");
    expect(data.server).toHaveProperty("platform");
    expect(data.server).toHaveProperty("pid");
  });

  test("GET /api/system/health includes memory info", async () => {
    const res = await makeRequest(`${baseUrl}/api/system/health`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.memory).toHaveProperty("heapUsed");
    expect(data.memory).toHaveProperty("heapTotal");
    expect(data.memory).toHaveProperty("rss");
    expect(data.memory).toHaveProperty("systemTotal");
    expect(data.memory).toHaveProperty("systemUsedPercent");
  });

  test("GET /api/system/health includes CPU info", async () => {
    const res = await makeRequest(`${baseUrl}/api/system/health`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.cpu).toHaveProperty("cores");
    expect(data.cpu).toHaveProperty("loadAvg");
    expect(data.cpu.loadAvg).toHaveProperty("1m");
  });

  test("GET /api/system/health includes data files", async () => {
    const res = await makeRequest(`${baseUrl}/api/system/health`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.data).toHaveProperty("totalSize");
    expect(data.data).toHaveProperty("files");
    expect("users.json" in data.data.files).toBe(true);
  });

  test("GET /api/system/health/simple returns lightweight data", async () => {
    const res = await makeRequest(`${baseUrl}/api/system/health/simple`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data).toHaveProperty("uptime");
    expect(data).toHaveProperty("heapUsed");
    expect(data).toHaveProperty("systemUsedPercent");
    expect(data).toHaveProperty("loadAvg");
    // Should NOT have full server/cpu/data details
    expect(data).not.toHaveProperty("server");
    expect(data).not.toHaveProperty("cpu");
  });

  test("GET /api/system/health/simple requires admin", async () => {
    const res = await makeRequest(`${baseUrl}/api/system/health/simple`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/system/logs returns logs", async () => {
    const res = await makeRequest(`${baseUrl}/api/system/logs`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("logs");
    expect(Array.isArray(data.logs)).toBe(true);
  });

  test("GET /api/system/logs accepts lines parameter", async () => {
    const res = await makeRequest(`${baseUrl}/api/system/logs?lines=10`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.logs.length).toBeLessThanOrEqual(10);
  });
});
