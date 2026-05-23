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

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: suggestionRoutes } = await import("../routes/suggestions.js");

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
    if (options.body)
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
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
      req.session.user = { id: user.id, username: user.username, role: user.role, displayName: user.displayName, features: user.features || [] };
      res.json({ success: true });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });
  app.use(suggestionRoutes);
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

beforeAll(async () => {
  if (fs.existsSync(TEST_USERS_FILE))
    originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");

  const adminHash = await bcrypt.hash("Admin123!", 10);
  fs.writeFileSync(TEST_USERS_FILE, JSON.stringify([{
    id: 1, username: "admin", password: adminHash,
    displayName: "Admin", role: "admin", features: [], createdAt: new Date().toISOString(),
  }], null, 2));

  const app = createTestApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
  adminCookie = await loginAs("admin", "Admin123!");
});

afterAll((done) => {
  if (originalUsers !== undefined) fs.writeFileSync(TEST_USERS_FILE, originalUsers);
  try { fs.unlinkSync(HISTORY_FILE); } catch {}
  server.close(done);
});

beforeEach(() => {
  if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
});

function writeHistory(data) {
  // suggestions.js expects flat array with userId field
  // Convert from { userId: [entries] } to flat array
  const flat = [];
  for (const [userId, entries] of Object.entries(data)) {
    for (const entry of entries) {
      flat.push({ ...entry, userId: Number(userId) });
    }
  }
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(flat, null, 2));
}

describe("Smart Suggestions API", () => {
  test("GET /api/suggestions/smart returns empty for no history", async () => {
    const res = await makeRequest(`${baseUrl}/api/suggestions/smart`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  test("GET /api/suggestions/smart requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/suggestions/smart`);
    expect(res.status).toBe(401);
  });

  test("GET /api/suggestions/smart returns recent queries", async () => {
    const now = Date.now();
    writeHistory({
      "1": [
        { id: 1, query: "hotel hanoi", engine: "tavily", resultCount: 5, timestamp: now - 1000 },
        { id: 2, query: "resort da nang", engine: "google", resultCount: 3, timestamp: now - 2000 },
      ],
    });

    const res = await makeRequest(`${baseUrl}/api/suggestions/smart`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2);
    expect(data.some((s) => s.text === "hotel hanoi")).toBe(true);
    expect(data.some((s) => s.reason === "recent")).toBe(true);
  });

  test("GET /api/suggestions/smart returns frequent queries", async () => {
    const now = Date.now();
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;
    writeHistory({
      "1": [
        { id: 1, query: "luxury hotel", engine: "tavily", resultCount: 5, timestamp: twoWeeksAgo - 1000 },
        { id: 2, query: "luxury hotel", engine: "google", resultCount: 3, timestamp: twoWeeksAgo - 2000 },
        { id: 3, query: "luxury hotel", engine: "ddg", resultCount: 2, timestamp: twoWeeksAgo - 3000 },
        { id: 4, query: "budget hotel", engine: "tavily", resultCount: 1, timestamp: twoWeeksAgo - 4000 },
      ],
    });

    const res = await makeRequest(`${baseUrl}/api/suggestions/smart`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    const frequent = data.filter((s) => s.reason === "frequent");
    expect(frequent.length).toBeGreaterThan(0);
    expect(frequent.some((s) => s.text === "luxury hotel")).toBe(true);
  });

  test("GET /api/suggestions/smart with query returns related queries", async () => {
    const now = Date.now();
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;
    // Add 6+ distinct frequent queries to push hanoi queries out of top-5 frequent
    const entries = [
      { id: 1, query: "popular beach resort", engine: "tavily", resultCount: 1, timestamp: twoWeeksAgo - 1000 },
      { id: 2, query: "popular beach resort", engine: "google", resultCount: 1, timestamp: twoWeeksAgo - 2000 },
      { id: 3, query: "luxury spa hotel", engine: "tavily", resultCount: 1, timestamp: twoWeeksAgo - 3000 },
      { id: 4, query: "luxury spa hotel", engine: "google", resultCount: 1, timestamp: twoWeeksAgo - 4000 },
      { id: 5, query: "budget hostel", engine: "tavily", resultCount: 1, timestamp: twoWeeksAgo - 5000 },
      { id: 6, query: "budget hostel", engine: "google", resultCount: 1, timestamp: twoWeeksAgo - 6000 },
      { id: 7, query: "city center apartment", engine: "tavily", resultCount: 1, timestamp: twoWeeksAgo - 7000 },
      { id: 8, query: "beachfront villa", engine: "tavily", resultCount: 1, timestamp: twoWeeksAgo - 8000 },
      { id: 9, query: "mountain cabin", engine: "tavily", resultCount: 1, timestamp: twoWeeksAgo - 9000 },
      { id: 10, query: "hanoi old quarter hotel", engine: "tavily", resultCount: 5, timestamp: twoWeeksAgo - 20000 },
      { id: 11, query: "hanoi center hotel", engine: "google", resultCount: 3, timestamp: twoWeeksAgo - 21000 },
      { id: 12, query: "saigon luxury resort", engine: "ddg", resultCount: 2, timestamp: twoWeeksAgo - 22000 },
    ];
    writeHistory({ "1": entries });

    const res = await makeRequest(`${baseUrl}/api/suggestions/smart?q=hotel hanoi`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.length).toBeGreaterThan(0);
    const related = data.filter((s) => s.reason === "related");
    expect(related.length).toBeGreaterThan(0);
    expect(related.some((s) => s.text.includes("hanoi"))).toBe(true);
  });

  test("GET /api/suggestions/smart respects limit parameter", async () => {
    const now = Date.now();
    const entries = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1, query: `query ${i}`, engine: "tavily", resultCount: 1, timestamp: now - i * 1000,
    }));
    writeHistory({ "1": entries });

    const res = await makeRequest(`${baseUrl}/api/suggestions/smart?limit=3`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.length).toBeLessThanOrEqual(3);
  });

  test("GET /api/suggestions/smart includes trending from all users", async () => {
    const now = Date.now();
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;
    writeHistory({
      "1": [
        { id: 1, query: "old query", engine: "tavily", resultCount: 1, timestamp: twoWeeksAgo },
      ],
      "2": [
        { id: 2, query: "trending hotel", engine: "google", resultCount: 1, timestamp: now - 2000 },
      ],
      "3": [
        { id: 3, query: "trending hotel", engine: "ddg", resultCount: 1, timestamp: now - 3000 },
      ],
    });

    const res = await makeRequest(`${baseUrl}/api/suggestions/smart`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    const trending = data.filter((s) => s.reason === "trending");
    expect(trending.some((s) => s.text === "trending hotel")).toBe(true);
  });

  test("GET /api/suggestions/smart deduplicates suggestions", async () => {
    const now = Date.now();
    writeHistory({
      "1": [
        { id: 1, query: "same query", engine: "tavily", resultCount: 5, timestamp: now - 1000 },
        { id: 2, query: "same query", engine: "google", resultCount: 3, timestamp: now - 2000 },
        { id: 3, query: "same query", engine: "ddg", resultCount: 2, timestamp: now - 3000 },
      ],
    });

    const res = await makeRequest(`${baseUrl}/api/suggestions/smart`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    const sameQueries = data.filter((s) => s.text === "same query");
    expect(sameQueries).toHaveLength(1);
  });

  test("GET /api/suggestions/smart scores suggestions correctly", async () => {
    const now = Date.now();
    writeHistory({
      "1": [
        { id: 1, query: "recent query", engine: "tavily", resultCount: 1, timestamp: now - 1000 },
        { id: 2, query: "frequent query", engine: "tavily", resultCount: 1, timestamp: now - 100000 },
        { id: 3, query: "frequent query", engine: "google", resultCount: 1, timestamp: now - 200000 },
        { id: 4, query: "frequent query", engine: "ddg", resultCount: 1, timestamp: now - 300000 },
      ],
    });

    const res = await makeRequest(`${baseUrl}/api/suggestions/smart`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2);
    // Recent should score higher
    const recentIdx = data.findIndex((s) => s.text === "recent query");
    const frequentIdx = data.findIndex((s) => s.text === "frequent query");
    expect(recentIdx).toBeLessThan(frequentIdx);
  });
});
