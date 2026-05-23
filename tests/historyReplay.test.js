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
let originalHistory;
let adminCookie;
let server;
let baseUrl;

const { default: historyReplayRoutes } = await import("../routes/historyReplay.js");

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
  app.use(historyReplayRoutes);
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

describe("History Replay", () => {
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

    // Create test history data
    fs.writeFileSync(
      HISTORY_FILE,
      JSON.stringify([
        { id: "h1", userId: 1, query: "hotel đà nẵng", engine: "tavily", resultCount: 10, timestamp: "2026-05-20T10:00:00Z", params: {} },
        { id: "h2", userId: 1, query: "hotel đà nẵng", engine: "google", resultCount: 8, timestamp: "2026-05-20T11:00:00Z", params: {} },
        { id: "h3", userId: 1, query: "resort nha trang", engine: "tavily", resultCount: 5, timestamp: "2026-05-19T09:00:00Z", params: { limit: 50 } },
        { id: "h4", userId: 2, query: "other user search", engine: "tavily", resultCount: 3, timestamp: "2026-05-20T12:00:00Z", params: {} },
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

  test("GET /api/history/replayable requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/history/replayable`);
    expect(res.status).toBe(401);
  });

  test("GET /api/history/replayable returns deduplicated history", async () => {
    const res = await makeRequest(`${baseUrl}/api/history/replayable`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // "hotel đà nẵng" appears twice (tavily + google) but should be deduplicated to 2 entries
    // "resort nha trang" is 1 entry. Total: 3 (not 4, because dedup by query+engine)
    expect(data.length).toBe(3);
    // Most recent first
    expect(data[0].query).toBe("hotel đà nẵng");
    expect(data[0].engine).toBe("google");
  });

  test("GET /api/history/replayable excludes other users", async () => {
    const res = await makeRequest(`${baseUrl}/api/history/replayable`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.every((d) => d.query !== "other user search")).toBe(true);
  });

  test("GET /api/history/replay/:id returns search params", async () => {
    const res = await makeRequest(`${baseUrl}/api/history/replay/h1`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.query).toBe("hotel đà nẵng");
    expect(data.engine).toBe("tavily");
    expect(data.originalTimestamp).toBe("2026-05-20T10:00:00Z");
  });

  test("GET /api/history/replay/:id returns 404 for nonexistent", async () => {
    const res = await makeRequest(`${baseUrl}/api/history/replay/nonexistent`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("GET /api/history/replay/:id returns 404 for other user's history", async () => {
    const res = await makeRequest(`${baseUrl}/api/history/replay/h4`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });
});
