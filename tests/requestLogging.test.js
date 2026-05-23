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
const LOG_FILE = path.join(__dirname, "..", "request_log.json");

let originalUsers;
let adminCookie;
let userCookie;
let server;
let baseUrl;

const { default: requestLoggingRoutes, logRequest } = await import("../routes/requestLogging.js");

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
  app.use(requestLoggingRoutes);
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

describe("Request Logging", () => {
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
    try { fs.unlinkSync(LOG_FILE); } catch {}
  });

  beforeEach(() => {
    // Retry write on Windows EBUSY errors
    for (let i = 0; i < 5; i++) {
      try {
        fs.writeFileSync(LOG_FILE, JSON.stringify({ entries: [] }));
        break;
      } catch (e) {
        if (e.code === "EBUSY" && i < 4) {
          // Wait a bit and retry
          const start = Date.now();
          while (Date.now() - start < 50) { /* busy wait */ }
        } else {
          throw e;
        }
      }
    }
  });

  test("logRequest helper writes entries", () => {
    logRequest({ method: "GET", path: "/api/test", statusCode: 200, duration: 42 });

    const data = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
    expect(data.entries.length).toBe(1);
    expect(data.entries[0].method).toBe("GET");
    expect(data.entries[0].path).toBe("/api/test");
    expect(data.entries[0].statusCode).toBe(200);
    expect(data.entries[0].duration).toBe(42);
  });

  test("logRequest trims to MAX_ENTRIES", () => {
    for (let i = 0; i < 1010; i++) {
      logRequest({ method: "GET", path: `/test/${i}`, statusCode: 200, duration: 10 });
    }

    const data = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
    expect(data.entries.length).toBeLessThanOrEqual(1000);
    expect(data.entries.length).toBeGreaterThan(750);
  });

  test("logRequest includes user info", () => {
    logRequest({ method: "POST", path: "/api/data", statusCode: 201, duration: 100, userId: 1, username: "admin", ip: "127.0.0.1" });

    const data = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
    expect(data.entries[0].username).toBe("admin");
    expect(data.entries[0].userId).toBe(1);
  });

  test("GET /api/admin/request-log requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/request-log`);
    expect(res.status).toBe(401);
  });

  test("GET /api/admin/request-log requires admin", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/request-log`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/admin/request-log returns entries", async () => {
    logRequest({ method: "GET", path: "/api/test1", statusCode: 200, duration: 10 });
    logRequest({ method: "POST", path: "/api/test2", statusCode: 201, duration: 50 });

    const res = await makeRequest(`${baseUrl}/api/admin/request-log`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries.length).toBe(2);
    expect(data.total).toBe(2);
  });

  test("GET /api/admin/request-log supports pagination", async () => {
    for (let i = 0; i < 10; i++) {
      logRequest({ method: "GET", path: `/test/${i}`, statusCode: 200, duration: 10 });
    }

    const res = await makeRequest(`${baseUrl}/api/admin/request-log?page=1&limit=3`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.entries.length).toBe(3);
    expect(data.page).toBe(1);
    expect(data.total).toBe(10);
  });

  test("GET /api/admin/request-log supports search", async () => {
    logRequest({ method: "GET", path: "/api/users", statusCode: 200, duration: 10 });
    logRequest({ method: "GET", path: "/api/products", statusCode: 200, duration: 10 });

    const res = await makeRequest(`${baseUrl}/api/admin/request-log?search=users`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.entries.length).toBe(1);
    expect(data.entries[0].path).toContain("users");
  });

  test("GET /api/admin/request-log supports method filter", async () => {
    logRequest({ method: "GET", path: "/api/a", statusCode: 200, duration: 10 });
    logRequest({ method: "POST", path: "/api/b", statusCode: 201, duration: 50 });

    const res = await makeRequest(`${baseUrl}/api/admin/request-log?method=POST`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.entries.length).toBe(1);
    expect(data.entries[0].method).toBe("POST");
  });

  test("GET /api/admin/request-log/stats returns stats", async () => {
    logRequest({ method: "GET", path: "/api/a", statusCode: 200, duration: 100 });
    logRequest({ method: "GET", path: "/api/b", statusCode: 200, duration: 200 });
    logRequest({ method: "POST", path: "/api/c", statusCode: 201, duration: 50 });

    const res = await makeRequest(`${baseUrl}/api/admin/request-log/stats`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(3);
    expect(data.avgDuration).toBe(117);
    expect(data.byMethod.GET).toBe(2);
    expect(data.byMethod.POST).toBe(1);
    expect(data.slowest.path).toBe("/api/b");
  });

  test("DELETE /api/admin/request-log clears log", async () => {
    logRequest({ method: "GET", path: "/api/test", statusCode: 200, duration: 10 });

    const res = await makeRequest(`${baseUrl}/api/admin/request-log`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    const data = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
    expect(data.entries.length).toBe(0);
  });
});
