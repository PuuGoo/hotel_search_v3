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
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");

let originalUsers;
let adminCookie;
let userCookie;
let server;
let baseUrl;

const { default: gdprExportRoutes } = await import("../routes/gdprExport.js");

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
  app.use(gdprExportRoutes);
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

describe("GDPR Data Export", () => {
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

    // Create test data
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      2: [
        { query: "hotel hanoi", engine: "tavily", timestamp: Date.now() },
        { query: "hotel saigon", engine: "google", timestamp: Date.now() },
      ],
    }));
    fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify({
      2: [
        { url: "https://example.com", title: "Example", engine: "tavily", timestamp: Date.now() },
      ],
    }));

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
    try { fs.unlinkSync(HISTORY_FILE); } catch {}
    try { fs.unlinkSync(BOOKMARKS_FILE); } catch {}
  });

  test("GET /api/gdpr/export requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/gdpr/export`);
    expect(res.status).toBe(401);
  });

  test("GET /api/gdpr/export returns user data", async () => {
    const res = await makeRequest(`${baseUrl}/api/gdpr/export`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.exportDate).toBeDefined();
    expect(data.user.username).toBe("user");
    expect(data.data.profile).toBeDefined();
    expect(data.data.profile.username).toBe("user");
    expect(data.data.profile.password).toBeUndefined(); // No password hash
  });

  test("GET /api/gdpr/export includes search history", async () => {
    const res = await makeRequest(`${baseUrl}/api/gdpr/export`, {
      headers: { cookie: userCookie },
    });
    const data = await res.json();
    expect(data.data.searchHistory).toBeDefined();
    expect(data.data.searchHistory.length).toBe(2);
  });

  test("GET /api/gdpr/export includes bookmarks", async () => {
    const res = await makeRequest(`${baseUrl}/api/gdpr/export`, {
      headers: { cookie: userCookie },
    });
    const data = await res.json();
    expect(data.data.bookmarks).toBeDefined();
    expect(data.data.bookmarks.length).toBe(1);
  });

  test("GET /api/gdpr/export excludes other users data", async () => {
    const res = await makeRequest(`${baseUrl}/api/gdpr/export`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    // Admin has no search history
    expect(data.data.searchHistory).toBeUndefined();
  });

  test("GET /api/gdpr/data-summary returns data summary", async () => {
    const res = await makeRequest(`${baseUrl}/api/gdpr/data-summary`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBeDefined();
    expect(data.summary["search_history.json"]).toBeDefined();
    expect(data.summary["search_history.json"].count).toBe(2);
  });

  test("POST /api/gdpr/delete-account requires confirmation", async () => {
    // Create a fresh user for deletion test
    const freshHash = await bcrypt.hash("fresh123", 10);
    const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
    users.push({
      id: 3, username: "to-delete", password: freshHash,
      displayName: "Delete Me", role: "user", features: [], createdAt: new Date().toISOString(),
    });
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(users, null, 2));

    const freshCookie = await loginAs("to-delete", "fresh123");

    const res = await makeRequest(`${baseUrl}/api/gdpr/delete-account`, {
      method: "POST",
      headers: { cookie: freshCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "wrong" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/gdpr/delete-account deletes account with correct confirmation", async () => {
    // Create a fresh user for deletion test
    const freshHash = await bcrypt.hash("del12345", 10);
    const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
    users.push({
      id: 4, username: "del-me", password: freshHash,
      displayName: "Delete", role: "user", features: [], createdAt: new Date().toISOString(),
    });
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(users, null, 2));

    const freshCookie = await loginAs("del-me", "del12345");

    const res = await makeRequest(`${baseUrl}/api/gdpr/delete-account`, {
      method: "POST",
      headers: { cookie: freshCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "del-me" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    // Verify user is deleted
    const afterUsers = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
    expect(afterUsers.find((u) => u.username === "del-me")).toBeUndefined();
  });
});
