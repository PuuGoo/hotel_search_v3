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

const DATA_FILES = {
  cache: path.join(__dirname, "..", "result_cache.json"),
  recentSearches: path.join(__dirname, "..", "recent_searches.json"),
  sharedSearches: path.join(__dirname, "..", "shared_searches.json"),
  analytics: path.join(__dirname, "..", "search_analytics.json"),
  notifications: path.join(__dirname, "..", "notifications.json"),
};

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: dataCleanupRoutes } = await import("../routes/dataCleanup.js");

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
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode, json: () => Promise.resolve(JSON.parse(body)) })
        );
      }
    );
    req.on("error", reject);
    if (options.body)
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: "test",
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, maxAge: 86400000 },
    })
  );
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
  app.use(dataCleanupRoutes);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

async function loginAs(username, password) {
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}/login`);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => resolve(res.headers["set-cookie"]));
      }
    );
    req.write(JSON.stringify({ username, password }));
    req.end();
  });
}

function cleanupFiles() {
  for (const f of Object.values(DATA_FILES)) {
    try { fs.unlinkSync(f); } catch {}
  }
}

describe("Data Cleanup", () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE))
      originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");
    fs.writeFileSync(
      TEST_USERS_FILE,
      JSON.stringify(
        [
          {
            id: 1,
            username: "admin",
            password: await bcrypt.hash("admin123", 10),
            displayName: "Admin",
            role: "admin",
            features: [],
            createdAt: new Date().toISOString(),
          },
        ],
        null,
        2
      )
    );
    const app = createTestApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
    adminCookie = await loginAs("admin", "admin123");
  });

  afterAll(() => {
    server?.close();
    if (originalUsers !== undefined) fs.writeFileSync(TEST_USERS_FILE, originalUsers);
    cleanupFiles();
  });

  beforeEach(() => {
    cleanupFiles();
  });

  test("GET /api/cleanup/stats requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/cleanup/stats`);
    expect(res.status).toBe(401);
  });

  test("GET /api/cleanup/stats returns stats", async () => {
    const res = await makeRequest(`${baseUrl}/api/cleanup/stats`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("cacheEntries");
    expect(data).toHaveProperty("recentSearches");
    expect(data).toHaveProperty("sharedSearches");
  });

  test("POST /api/cleanup/cache cleans expired cache", async () => {
    // Create cache with old entry
    const oldTime = new Date(Date.now() - 7200000).toISOString(); // 2 hours ago
    fs.writeFileSync(
      DATA_FILES.cache,
      JSON.stringify({
        key1: { query: "test", results: [], timestamp: oldTime },
        key2: { query: "new", results: [], timestamp: new Date().toISOString() },
      })
    );

    const res = await makeRequest(`${baseUrl}/api/cleanup/cache`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.cleaned).toBe(1);

    const cache = JSON.parse(fs.readFileSync(DATA_FILES.cache, "utf8"));
    expect(Object.keys(cache)).toHaveLength(1);
    expect(cache.key2).toBeDefined();
  });

  test("POST /api/cleanup/recent cleans old recent searches", async () => {
    const oldTime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(); // 31 days ago
    fs.writeFileSync(
      DATA_FILES.recentSearches,
      JSON.stringify([
        { id: "1", userId: 1, query: "old", timestamp: oldTime },
        { id: "2", userId: 1, query: "new", timestamp: new Date().toISOString() },
      ])
    );

    const res = await makeRequest(`${baseUrl}/api/cleanup/recent`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.cleaned).toBe(1);
  });

  test("POST /api/cleanup/shared cleans expired shared searches", async () => {
    const expiredTime = new Date(Date.now() - 86400000).toISOString(); // yesterday
    fs.writeFileSync(
      DATA_FILES.sharedSearches,
      JSON.stringify([
        { id: "1", token: "abc", expiresAt: expiredTime },
        { id: "2", token: "def", expiresAt: new Date(Date.now() + 86400000).toISOString() },
      ])
    );

    const res = await makeRequest(`${baseUrl}/api/cleanup/shared`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.cleaned).toBe(1);
  });

  test("POST /api/cleanup/notifications cleans read notifications", async () => {
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
    fs.writeFileSync(
      DATA_FILES.notifications,
      JSON.stringify([
        { id: "1", userId: 1, read: true, createdAt: oldTime },
        { id: "2", userId: 1, read: false, createdAt: oldTime },
        { id: "3", userId: 1, read: true, createdAt: new Date().toISOString() },
      ])
    );

    const res = await makeRequest(`${baseUrl}/api/cleanup/notifications`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ days: 7 }),
    });
    const data = await res.json();
    expect(data.cleaned).toBe(1);
  });

  test("POST /api/cleanup/all runs all cleanup", async () => {
    const oldTime = new Date(Date.now() - 7200000).toISOString();
    fs.writeFileSync(
      DATA_FILES.cache,
      JSON.stringify({ key1: { query: "old", results: [], timestamp: oldTime } })
    );
    fs.writeFileSync(
      DATA_FILES.sharedSearches,
      JSON.stringify([{ id: "1", token: "abc", expiresAt: oldTime }])
    );

    const res = await makeRequest(`${baseUrl}/api/cleanup/all`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.totalCleaned).toBeGreaterThan(0);
    expect(data.details).toHaveProperty("cache");
    expect(data.details).toHaveProperty("shared");
  });
});
