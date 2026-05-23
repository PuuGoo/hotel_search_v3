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

const { default: dashboardRoutes } = await import("../routes/dashboard.js");

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
  app.use(dashboardRoutes);
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

function writeHistoryData(userId, entries) {
  const data = {};
  data[userId] = entries;
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
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

describe("Search Statistics API", () => {
  test("GET /api/dashboard/search-statistics returns empty data for new user", async () => {
    const res = await makeRequest(`${baseUrl}/api/dashboard/search-statistics`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.period.days).toBe(30);
    expect(data.summary.total).toBe(0);
    expect(data.summary.streak).toBe(0);
    expect(data.summary.avgQueryLength).toBe(0);
    expect(data.dailySearches).toHaveLength(30);
    expect(data.hourDistribution).toHaveLength(24);
    expect(data.dayOfWeekDistribution).toHaveLength(7);
  });

  test("GET /api/dashboard/search-statistics requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/dashboard/search-statistics`);
    expect(res.status).toBe(401);
  });

  test("GET /api/dashboard/search-statistics respects days parameter", async () => {
    const res = await makeRequest(`${baseUrl}/api/dashboard/search-statistics?days=7`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.period.days).toBe(7);
    expect(data.dailySearches).toHaveLength(7);
  });

  test("GET /api/dashboard/search-statistics clamps days to 1-90", async () => {
    // 0 is falsy so it defaults to 30
    const res1 = await makeRequest(`${baseUrl}/api/dashboard/search-statistics?days=0`, {
      headers: { Cookie: adminCookie },
    });
    const data1 = await res1.json();
    expect(data1.period.days).toBe(30);

    const res2 = await makeRequest(`${baseUrl}/api/dashboard/search-statistics?days=200`, {
      headers: { Cookie: adminCookie },
    });
    const data2 = await res2.json();
    expect(data2.period.days).toBe(90);

    const res3 = await makeRequest(`${baseUrl}/api/dashboard/search-statistics?days=1`, {
      headers: { Cookie: adminCookie },
    });
    const data3 = await res3.json();
    expect(data3.period.days).toBe(1);
  });

  test("GET /api/dashboard/search-statistics counts searches correctly", async () => {
    const now = Date.now();
    writeHistoryData("1", [
      { id: 1, query: "hotel hanoi", engine: "tavily", resultCount: 5, timestamp: now - 1000 },
      { id: 2, query: "resort da nang", engine: "google", resultCount: 3, timestamp: now - 2000 },
      { id: 3, query: "beach hotel", engine: "ddg", resultCount: 8, timestamp: now - 3000 },
      { id: 4, query: "luxury hotel", engine: "tavily", resultCount: 2, timestamp: now - 86400000 * 40 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/dashboard/search-statistics?days=30`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.summary.total).toBe(3); // 4th entry is > 30 days old
    expect(data.summary.byEngine.tavily).toBe(1);
    expect(data.summary.byEngine.google).toBe(1);
    expect(data.summary.byEngine.ddg).toBe(1);
  });

  test("GET /api/dashboard/search-statistics calculates avg query length", async () => {
    const now = Date.now();
    writeHistoryData("1", [
      { id: 1, query: "hotel", engine: "tavily", resultCount: 5, timestamp: now - 1000 },
      { id: 2, query: "beach resort", engine: "google", resultCount: 3, timestamp: now - 2000 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/dashboard/search-statistics`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.summary.avgQueryLength).toBe(9); // (5 + 12) / 2 = 8.5 -> 9
  });

  test("GET /api/dashboard/search-statistics populates hour distribution", async () => {
    const now = Date.now();
    const hour14 = new Date(now);
    hour14.setHours(14, 0, 0, 0);
    const hour14ts = hour14.getTime();

    writeHistoryData("1", [
      { id: 1, query: "test1", engine: "tavily", resultCount: 1, timestamp: hour14ts },
      { id: 2, query: "test2", engine: "tavily", resultCount: 1, timestamp: hour14ts + 100 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/dashboard/search-statistics`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.hourDistribution[14]).toBe(2);
  });

  test("GET /api/dashboard/search-statistics returns dailyByEngine data", async () => {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);

    writeHistoryData("1", [
      { id: 1, query: "a", engine: "tavily", resultCount: 1, timestamp: now - 1000 },
      { id: 2, query: "b", engine: "google", resultCount: 1, timestamp: now - 2000 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/dashboard/search-statistics`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.dailyByEngine[today]).toBeDefined();
    expect(data.dailyByEngine[today].tavily).toBe(1);
    expect(data.dailyByEngine[today].google).toBe(1);
    expect(data.dailyByEngine[today].ddg).toBe(0);
  });

  test("GET /api/dashboard/search-statistics returns weeklySearches", async () => {
    const res = await makeRequest(`${baseUrl}/api/dashboard/search-statistics?days=14`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.weeklySearches).toBeDefined();
    expect(data.weeklySearches.length).toBeGreaterThan(0);
  });

  test("GET /api/dashboard/search-statistics includes period info", async () => {
    const res = await makeRequest(`${baseUrl}/api/dashboard/search-statistics?days=7`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.period.from).toBeDefined();
    expect(data.period.to).toBeDefined();
    expect(data.generatedAt).toBeDefined();
  });
});
