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
const ACTIVITY_FILE = path.join(__dirname, "..", "user_activity.json");

let originalUsers;
let adminCookie;
let userCookie;
let server;
let baseUrl;

const { default: userActivityRoutes, logActivity, readActivity } = await import("../routes/userActivity.js");

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
  app.use(userActivityRoutes);
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

describe("User Activity", () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE))
      originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");

    const adminHash = await bcrypt.hash("admin123", 10);
    const userHash = await bcrypt.hash("user123", 10);
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify([
      {
        id: 1, username: "admin", password: adminHash,
        displayName: "Admin", role: "admin", features: [], createdAt: new Date().toISOString(),
      },
      {
        id: 2, username: "user", password: userHash,
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
    try { fs.unlinkSync(ACTIVITY_FILE); } catch {}
  });

  beforeEach(() => {
    // Retry write on Windows EBUSY errors
    for (let i = 0; i < 5; i++) {
      try {
        fs.writeFileSync(ACTIVITY_FILE, "{}");
        break;
      } catch (e) {
        if (e.code === "EBUSY" && i < 4) {
          const start = Date.now();
          while (Date.now() - start < 50) { /* busy wait */ }
        } else {
          throw e;
        }
      }
    }
  });

  test("logActivity records activity", () => {
    logActivity(2, "search", { query: "hotel hanoi", engine: "tavily" });

    const data = readActivity();
    expect(data[2].length).toBe(1);
    expect(data[2][0].action).toBe("search");
    expect(data[2][0].details.query).toBe("hotel hanoi");
  });

  test("logActivity trims to MAX_ENTRIES", () => {
    for (let i = 0; i < 510; i++) {
      logActivity(2, "test", { index: i });
    }

    const data = readActivity();
    expect(data[2].length).toBe(500);
  });

  test("logActivity separates by user", () => {
    logActivity(1, "login", {});
    logActivity(2, "search", {});

    const data = readActivity();
    expect(data[1].length).toBe(1);
    expect(data[2].length).toBe(1);
    expect(data[1][0].action).toBe("login");
    expect(data[2][0].action).toBe("search");
  });

  test("GET /api/activity requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/activity`);
    expect(res.status).toBe(401);
  });

  test("GET /api/activity returns user activities", async () => {
    logActivity(2, "search", { query: "test" });
    logActivity(2, "bookmark", { url: "https://example.com" });

    const res = await makeRequest(`${baseUrl}/api/activity`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.activities.length).toBe(2);
    expect(data.total).toBe(2);
  });

  test("GET /api/activity supports pagination", async () => {
    for (let i = 0; i < 10; i++) {
      logActivity(2, "search", { index: i });
    }

    const res = await makeRequest(`${baseUrl}/api/activity?page=1&limit=3`, {
      headers: { cookie: userCookie },
    });
    const data = await res.json();
    expect(data.activities.length).toBe(3);
    expect(data.total).toBe(10);
  });

  test("GET /api/activity supports action filter", async () => {
    logActivity(2, "search", {});
    logActivity(2, "bookmark", {});
    logActivity(2, "search", {});

    const res = await makeRequest(`${baseUrl}/api/activity?action=search`, {
      headers: { cookie: userCookie },
    });
    const data = await res.json();
    expect(data.activities.length).toBe(2);
  });

  test("GET /api/activity/actions returns unique actions", async () => {
    logActivity(2, "search", {});
    logActivity(2, "bookmark", {});
    logActivity(2, "search", {});

    const res = await makeRequest(`${baseUrl}/api/activity/actions`, {
      headers: { cookie: userCookie },
    });
    const data = await res.json();
    expect(data.actions).toContain("search");
    expect(data.actions).toContain("bookmark");
    expect(data.actions.length).toBe(2);
  });

  test("GET /api/activity/stats returns stats", async () => {
    logActivity(2, "search", {});
    logActivity(2, "search", {});
    logActivity(2, "bookmark", {});

    const res = await makeRequest(`${baseUrl}/api/activity/stats`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(3);
    expect(data.byAction.search).toBe(2);
    expect(data.byAction.bookmark).toBe(1);
  });

  test("DELETE /api/activity clears user activity", async () => {
    logActivity(2, "search", {});
    logActivity(2, "bookmark", {});

    const res = await makeRequest(`${baseUrl}/api/activity`, {
      method: "DELETE",
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(200);

    const data = readActivity();
    expect(data[2]).toBeUndefined();
  });

  test("Users only see their own activity", async () => {
    logActivity(1, "admin-action", {});
    logActivity(2, "user-action", {});

    const res = await makeRequest(`${baseUrl}/api/activity`, {
      headers: { cookie: userCookie },
    });
    const data = await res.json();
    expect(data.activities.length).toBe(1);
    expect(data.activities[0].action).toBe("user-action");
  });
});
