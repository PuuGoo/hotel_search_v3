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
const PREFS_FILE = path.join(__dirname, "..", "notification_preferences.json");

let originalUsers;
let adminCookie;
let userCookie;
let server;
let baseUrl;

const { default: notificationPreferencesRoutes, getUserNotifPrefs } = await import("../routes/notificationPreferences.js");

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
  app.use(notificationPreferencesRoutes);
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

describe("Notification Preferences", () => {
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
    try { fs.unlinkSync(PREFS_FILE); } catch {}
  });

  beforeEach(() => {
    fs.writeFileSync(PREFS_FILE, "{}");
  });

  test("getUserNotifPrefs returns defaults for new user", () => {
    const prefs = getUserNotifPrefs(999);
    expect(prefs.priceAlerts).toBe(true);
    expect(prefs.emailDigest).toBe(false);
    expect(prefs.digestFrequency).toBe("daily");
  });

  test("GET /api/notification-preferences returns defaults", async () => {
    const res = await makeRequest(`${baseUrl}/api/notification-preferences`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.preferences.priceAlerts).toBe(true);
    expect(data.preferences.emailDigest).toBe(false);
  });

  test("GET /api/notification-preferences requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/notification-preferences`);
    expect(res.status).toBe(401);
  });

  test("PUT /api/notification-preferences updates preferences", async () => {
    const res = await makeRequest(`${baseUrl}/api/notification-preferences`, {
      method: "PUT",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        preferences: { priceAlerts: false, emailDigest: true, digestFrequency: "weekly" },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.preferences.priceAlerts).toBe(false);
    expect(data.preferences.emailDigest).toBe(true);
    expect(data.preferences.digestFrequency).toBe("weekly");
    // Other defaults preserved
    expect(data.preferences.systemNotifications).toBe(true);
  });

  test("PUT /api/notification-preferences ignores unknown fields", async () => {
    const res = await makeRequest(`${baseUrl}/api/notification-preferences`, {
      method: "PUT",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        preferences: { priceAlerts: false, unknownField: "test" },
      }),
    });
    const data = await res.json();
    expect(data.preferences.unknownField).toBeUndefined();
  });

  test("PUT /api/notification-preferences validates digestFrequency", async () => {
    const res = await makeRequest(`${baseUrl}/api/notification-preferences`, {
      method: "PUT",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        preferences: { digestFrequency: "invalid" },
      }),
    });
    const data = await res.json();
    expect(data.preferences.digestFrequency).toBe("daily");
  });

  test("POST /api/notification-preferences/reset resets to defaults", async () => {
    // Set custom prefs
    await makeRequest(`${baseUrl}/api/notification-preferences`, {
      method: "PUT",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ preferences: { priceAlerts: false } }),
    });

    // Reset
    const res = await makeRequest(`${baseUrl}/api/notification-preferences/reset`, {
      method: "POST",
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.preferences.priceAlerts).toBe(true);
  });

  test("Preferences are per-user", async () => {
    // User sets prefs
    await makeRequest(`${baseUrl}/api/notification-preferences`, {
      method: "PUT",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ preferences: { priceAlerts: false } }),
    });

    // Admin should still have defaults
    const res = await makeRequest(`${baseUrl}/api/notification-preferences`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.preferences.priceAlerts).toBe(true);
  });
});
