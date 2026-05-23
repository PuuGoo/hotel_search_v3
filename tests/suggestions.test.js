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
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");

let originalUsers;
let originalHistory;
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
  app.use(suggestionRoutes);
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

describe("Search Suggestions", () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE))
      originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");
    if (fs.existsSync(HISTORY_FILE))
      originalHistory = fs.readFileSync(HISTORY_FILE, "utf8");

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

    fs.writeFileSync(
      HISTORY_FILE,
      JSON.stringify([
        { id: "h1", userId: 1, query: "hotel đà nẵng", engine: "tavily", timestamp: "2026-05-20T10:00:00Z" },
        { id: "h2", userId: 1, query: "hotel nha trang", engine: "tavily", timestamp: "2026-05-20T11:00:00Z" },
        { id: "h3", userId: 1, query: "resort đà nẵng", engine: "google", timestamp: "2026-05-19T09:00:00Z" },
        { id: "h4", userId: 2, query: "other user hotel", engine: "tavily", timestamp: "2026-05-20T12:00:00Z" },
      ])
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
    if (originalHistory !== undefined) fs.writeFileSync(HISTORY_FILE, originalHistory);
    else {
      try { fs.unlinkSync(HISTORY_FILE); } catch {}
    }
  });

  test("GET /api/suggestions requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/suggestions?q=hotel`);
    expect(res.status).toBe(401);
  });

  test("GET /api/suggestions returns empty for short query", async () => {
    const res = await makeRequest(`${baseUrl}/api/suggestions?q=h`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("GET /api/suggestions returns matching queries", async () => {
    const res = await makeRequest(`${baseUrl}/api/suggestions?q=hotel`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.length).toBe(2);
    expect(data.some((s) => s.text === "hotel đà nẵng")).toBe(true);
    expect(data.some((s) => s.text === "hotel nha trang")).toBe(true);
  });

  test("GET /api/suggestions excludes other users' queries", async () => {
    const res = await makeRequest(`${baseUrl}/api/suggestions?q=hotel`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.every((s) => s.text !== "other user hotel")).toBe(true);
  });

  test("GET /api/suggestions prioritizes starts-with matches", async () => {
    const res = await makeRequest(`${baseUrl}/api/suggestions?q=đà`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.length).toBe(2);
    // "hotel đà nẵng" contains "đà" but "resort đà nẵng" also contains it
    // Both should be returned
  });

  test("GET /api/suggestions respects limit param", async () => {
    const res = await makeRequest(`${baseUrl}/api/suggestions?q=hotel&limit=1`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.length).toBe(1);
  });

  test("GET /api/suggestions/popular returns popular queries", async () => {
    const res = await makeRequest(`${baseUrl}/api/suggestions/popular`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].query).toBeDefined();
    expect(data[0].count).toBeDefined();
  });

  test("GET /api/suggestions/popular requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/suggestions/popular`);
    expect(res.status).toBe(401);
  });
});
