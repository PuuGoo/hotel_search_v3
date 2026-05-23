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
const DATA_FILE = path.join(__dirname, "..", "search_analytics.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: analyticsRoutes } = await import("../routes/analytics.js");

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
  app.use(analyticsRoutes);
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

describe("Search Analytics", () => {
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
    try {
      fs.unlinkSync(DATA_FILE);
    } catch {}
  });

  beforeEach(() => {
    try {
      fs.unlinkSync(DATA_FILE);
    } catch {}
  });

  test("POST /api/analytics/track requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/analytics/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/analytics/track rejects missing query", async () => {
    const res = await makeRequest(`${baseUrl}/api/analytics/track`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ engine: "tavily" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/analytics/track records a search", async () => {
    const res = await makeRequest(`${baseUrl}/api/analytics/track`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hotel đà nẵng", engine: "tavily", resultCount: 10, duration: 500 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("GET /api/analytics/stats returns stats", async () => {
    await makeRequest(`${baseUrl}/api/analytics/track`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hotel a", engine: "tavily", resultCount: 5 }),
    });
    await makeRequest(`${baseUrl}/api/analytics/track`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hotel b", engine: "google", resultCount: 8 }),
    });

    const res = await makeRequest(`${baseUrl}/api/analytics/stats`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.totalSearches).toBe(2);
    expect(data.byEngine.tavily).toBe(1);
    expect(data.byEngine.google).toBe(1);
    expect(data.topQueries.length).toBeGreaterThan(0);
  });

  test("GET /api/analytics/stats requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/analytics/stats`);
    expect(res.status).toBe(401);
  });

  test("GET /api/analytics/hourly returns hourly distribution", async () => {
    await makeRequest(`${baseUrl}/api/analytics/track`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test", engine: "tavily" }),
    });

    const res = await makeRequest(`${baseUrl}/api/analytics/hourly`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(Array.isArray(data.hourly)).toBe(true);
    expect(data.hourly.length).toBe(24);
    expect(data.hourly.some((v) => v > 0)).toBe(true);
  });

  test("GET /api/analytics/trends returns trends", async () => {
    await makeRequest(`${baseUrl}/api/analytics/track`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test", engine: "tavily" }),
    });

    const res = await makeRequest(`${baseUrl}/api/analytics/trends`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(Array.isArray(data.trends)).toBe(true);
    expect(data.trends.length).toBeGreaterThanOrEqual(30);
  });

  test("GET /api/analytics/daily returns daily stats", async () => {
    await makeRequest(`${baseUrl}/api/analytics/track`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test", engine: "tavily" }),
    });

    const res = await makeRequest(`${baseUrl}/api/analytics/daily?days=7`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(typeof data).toBe("object");
    const today = new Date().toISOString().slice(0, 10);
    expect(data[today]).toBeDefined();
    expect(data[today].total).toBe(1);
  });

  test("DELETE /api/analytics clears all data", async () => {
    await makeRequest(`${baseUrl}/api/analytics/track`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test", engine: "tavily" }),
    });

    const res = await makeRequest(`${baseUrl}/api/analytics`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    const stats = await makeRequest(`${baseUrl}/api/analytics/stats`, {
      headers: { cookie: adminCookie },
    });
    const data = await stats.json();
    expect(data.totalSearches).toBe(0);
  });
});
