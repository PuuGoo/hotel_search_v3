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
const DATA_FILE = path.join(__dirname, "..", "recent_searches.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: recentSearchRoutes } = await import("../routes/recentSearches.js");

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
  app.use(recentSearchRoutes);
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

describe("Recent Searches", () => {
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

  test("GET /api/recent-searches requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/recent-searches`);
    expect(res.status).toBe(401);
  });

  test("POST /api/recent-searches adds a search", async () => {
    const res = await makeRequest(`${baseUrl}/api/recent-searches`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hotel đà nẵng", engine: "tavily" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.query).toBe("hotel đà nẵng");
    expect(data.engine).toBe("tavily");
  });

  test("POST /api/recent-searches rejects empty query", async () => {
    const res = await makeRequest(`${baseUrl}/api/recent-searches`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/recent-searches returns user searches", async () => {
    await makeRequest(`${baseUrl}/api/recent-searches`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "search 1" }),
    });
    await makeRequest(`${baseUrl}/api/recent-searches`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "search 2" }),
    });

    const res = await makeRequest(`${baseUrl}/api/recent-searches`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.length).toBe(2);
    // Most recent first
    expect(data[0].query).toBe("search 2");
  });

  test("POST /api/recent-searches deduplicates queries", async () => {
    await makeRequest(`${baseUrl}/api/recent-searches`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "same query" }),
    });
    await makeRequest(`${baseUrl}/api/recent-searches`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "Same Query" }),
    });

    const res = await makeRequest(`${baseUrl}/api/recent-searches`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.length).toBe(1);
  });

  test("GET /api/recent-searches respects limit param", async () => {
    for (let i = 0; i < 5; i++) {
      await makeRequest(`${baseUrl}/api/recent-searches`, {
        method: "POST",
        headers: { cookie: adminCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ query: `query ${i}` }),
      });
    }

    const res = await makeRequest(`${baseUrl}/api/recent-searches?limit=3`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.length).toBe(3);
  });

  test("DELETE /api/recent-searches/:id deletes a search", async () => {
    const create = await makeRequest(`${baseUrl}/api/recent-searches`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "to delete" }),
    });
    const { id } = await create.json();

    const res = await makeRequest(`${baseUrl}/api/recent-searches/${id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    const list = await makeRequest(`${baseUrl}/api/recent-searches`, {
      headers: { cookie: adminCookie },
    });
    const data = await list.json();
    expect(data.length).toBe(0);
  });

  test("DELETE /api/recent-searches/:id returns 404 for nonexistent", async () => {
    const res = await makeRequest(`${baseUrl}/api/recent-searches/nonexistent`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/recent-searches clears all user searches", async () => {
    for (let i = 0; i < 3; i++) {
      await makeRequest(`${baseUrl}/api/recent-searches`, {
        method: "POST",
        headers: { cookie: adminCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ query: `query ${i}` }),
      });
    }

    const res = await makeRequest(`${baseUrl}/api/recent-searches`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    const list = await makeRequest(`${baseUrl}/api/recent-searches`, {
      headers: { cookie: adminCookie },
    });
    const data = await list.json();
    expect(data.length).toBe(0);
  });
});
