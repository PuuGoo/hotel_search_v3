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
const CACHE_FILE = path.join(__dirname, "..", "result_cache.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: resultCacheRoutes } = await import("../routes/resultCache.js");

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
  app.use(resultCacheRoutes);
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

describe("Result Cache", () => {
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
      fs.unlinkSync(CACHE_FILE);
    } catch {}
  });

  beforeEach(() => {
    try {
      fs.unlinkSync(CACHE_FILE);
    } catch {}
  });

  test("POST /api/cache requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test", results: [] }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/cache stores results", async () => {
    const results = [{ title: "Hotel A", url: "https://a.com" }];
    const res = await makeRequest(`${baseUrl}/api/cache`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hotel đà nẵng", engine: "tavily", results }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.key).toBeDefined();
  });

  test("POST /api/cache rejects missing query", async () => {
    const res = await makeRequest(`${baseUrl}/api/cache`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ results: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/cache returns cached results", async () => {
    const results = [{ title: "Hotel A", url: "https://a.com" }];
    await makeRequest(`${baseUrl}/api/cache`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hotel test", engine: "tavily", results }),
    });

    const res = await makeRequest(
      `${baseUrl}/api/cache?query=${encodeURIComponent("hotel test")}&engine=tavily`,
      { headers: { cookie: adminCookie } }
    );
    const data = await res.json();
    expect(data.cached).toBe(true);
    expect(data.results).toEqual(results);
    expect(data.resultCount).toBe(1);
  });

  test("GET /api/cache returns cached:false for miss", async () => {
    const res = await makeRequest(
      `${baseUrl}/api/cache?query=${encodeURIComponent("not cached")}`,
      { headers: { cookie: adminCookie } }
    );
    const data = await res.json();
    expect(data.cached).toBe(false);
  });

  test("GET /api/cache returns expired for old entries", async () => {
    const results = [{ title: "Old" }];
    await makeRequest(`${baseUrl}/api/cache`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "old query", engine: "tavily", results }),
    });

    const res = await makeRequest(
      `${baseUrl}/api/cache?query=${encodeURIComponent("old query")}&engine=tavily&ttl=0`,
      { headers: { cookie: adminCookie } }
    );
    const data = await res.json();
    expect(data.cached).toBe(false);
    expect(data.expired).toBe(true);
  });

  test("GET /api/cache requires query param", async () => {
    const res = await makeRequest(`${baseUrl}/api/cache`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(400);
  });

  test("DELETE /api/cache clears all cache", async () => {
    await makeRequest(`${baseUrl}/api/cache`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test", results: [{ title: "A" }] }),
    });

    const res = await makeRequest(`${baseUrl}/api/cache`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    const stats = await makeRequest(`${baseUrl}/api/cache/stats`, {
      headers: { cookie: adminCookie },
    });
    const data = await stats.json();
    expect(data.total).toBe(0);
  });

  test("GET /api/cache/stats returns stats", async () => {
    await makeRequest(`${baseUrl}/api/cache`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "q1", engine: "tavily", results: [{ title: "A" }] }),
    });
    await makeRequest(`${baseUrl}/api/cache`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "q2", engine: "google", results: [{ title: "B" }, { title: "C" }] }),
    });

    const res = await makeRequest(`${baseUrl}/api/cache/stats`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.totalResults).toBe(3);
    expect(data.byEngine.tavily).toBe(1);
    expect(data.byEngine.google).toBe(1);
  });
});
