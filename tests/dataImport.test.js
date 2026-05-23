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

const { default: dataImportRoutes } = await import("../routes/dataImport.js");

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
  app.use(express.json({ limit: "5mb" }));
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
  app.use(dataImportRoutes);
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

describe("Data Import", () => {
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
    try { fs.unlinkSync(HISTORY_FILE); } catch {}
    try { fs.unlinkSync(BOOKMARKS_FILE); } catch {}
  });

  beforeEach(() => {
    fs.writeFileSync(HISTORY_FILE, "{}");
    fs.writeFileSync(BOOKMARKS_FILE, "{}");
  });

  test("POST /api/import requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: {} }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/import imports search history", async () => {
    const res = await makeRequest(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          searchHistory: [
            { query: "hotel hanoi", engine: "tavily", timestamp: Date.now() },
            { query: "hotel saigon", engine: "google", timestamp: Date.now() },
          ],
        },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.results.searchHistory.imported).toBe(2);

    // Verify data persisted
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    expect(history[2].length).toBe(2);
  });

  test("POST /api/import imports bookmarks", async () => {
    const res = await makeRequest(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          bookmarks: [
            { url: "https://example.com", title: "Example", engine: "tavily" },
          ],
        },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.bookmarks.imported).toBe(1);
  });

  test("POST /api/import deduplicates entries", async () => {
    // Import first time
    await makeRequest(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          searchHistory: [
            { query: "hotel hanoi", engine: "tavily" },
          ],
        },
      }),
    });

    // Import same data again
    const res = await makeRequest(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          searchHistory: [
            { query: "hotel hanoi", engine: "tavily" },
            { query: "hotel danang", engine: "google" },
          ],
        },
      }),
    });
    const data = await res.json();
    expect(data.results.searchHistory.imported).toBe(1); // Only new entry

    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    expect(history[2].length).toBe(2);
  });

  test("POST /api/import merges with existing data", async () => {
    // Set existing data
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      2: [{ query: "existing", engine: "tavily" }],
    }));

    await makeRequest(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          searchHistory: [{ query: "new query", engine: "google" }],
        },
      }),
    });

    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    expect(history[2].length).toBe(2);
  });

  test("POST /api/import handles nested data format", async () => {
    const res = await makeRequest(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          data: {
            searchHistory: [{ query: "nested", engine: "tavily" }],
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.searchHistory.imported).toBe(1);
  });

  test("POST /api/import validates input", async () => {
    const res = await makeRequest(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ data: "invalid" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/import/preview shows what would be imported", async () => {
    const res = await makeRequest(`${baseUrl}/api/import/preview`, {
      method: "POST",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          searchHistory: [{ query: "test" }, { query: "test2" }],
          bookmarks: [{ url: "https://example.com" }],
        },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.preview.searchHistory.count).toBe(2);
    expect(data.preview.bookmarks.count).toBe(1);
    expect(data.totalSources).toBe(2);
  });

  test("Users import to their own data only", async () => {
    await makeRequest(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          searchHistory: [{ query: "user query", engine: "tavily" }],
        },
      }),
    });

    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    expect(history[2]).toBeDefined();
    expect(history[1]).toBeUndefined(); // Admin not affected
  });
});
