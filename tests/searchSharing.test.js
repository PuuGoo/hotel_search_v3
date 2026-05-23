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
const DATA_FILE = path.join(__dirname, "..", "shared_searches.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: searchSharingRoutes } = await import("../routes/searchSharing.js");

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
  app.use(searchSharingRoutes);
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

describe("Search Sharing", () => {
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

  test("POST /api/shared-searches requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/shared-searches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test", results: [] }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/shared-searches creates a shared link", async () => {
    const res = await makeRequest(`${baseUrl}/api/shared-searches`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "hotel đà nẵng",
        engine: "tavily",
        results: [{ title: "Hotel A", url: "https://a.com" }],
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.token).toBeDefined();
    expect(data.url).toContain("/shared-search/");
    expect(data.expiresAt).toBeDefined();
  });

  test("POST /api/shared-searches rejects missing query", async () => {
    const res = await makeRequest(`${baseUrl}/api/shared-searches`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ results: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/shared-searches/:token returns shared results (public)", async () => {
    const create = await makeRequest(`${baseUrl}/api/shared-searches`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "hotel test",
        engine: "tavily",
        results: [{ title: "Hotel A" }],
        title: "My Search",
      }),
    });
    const { token } = await create.json();

    const res = await makeRequest(`${baseUrl}/api/shared-searches/${token}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("My Search");
    expect(data.query).toBe("hotel test");
    expect(data.results).toHaveLength(1);
    expect(data.sharedBy).toBe("admin");
    expect(data.viewCount).toBe(1);
  });

  test("GET /api/shared-searches/:token returns 404 for invalid token", async () => {
    const res = await makeRequest(`${baseUrl}/api/shared-searches/invalid`);
    expect(res.status).toBe(404);
  });

  test("GET /api/shared-searches returns user's shared searches", async () => {
    await makeRequest(`${baseUrl}/api/shared-searches`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "q1", results: [{ title: "A" }] }),
    });
    await makeRequest(`${baseUrl}/api/shared-searches`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "q2", results: [{ title: "B" }] }),
    });

    const res = await makeRequest(`${baseUrl}/api/shared-searches`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.length).toBe(2);
    expect(data[0].token).toBeDefined();
  });

  test("DELETE /api/shared-searches/:id deletes a shared search", async () => {
    const create = await makeRequest(`${baseUrl}/api/shared-searches`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "to delete", results: [{ title: "A" }] }),
    });
    const { token } = await create.json();

    // Get the ID from list
    const list = await makeRequest(`${baseUrl}/api/shared-searches`, {
      headers: { cookie: adminCookie },
    });
    const items = await list.json();
    const id = items.find((i) => i.token === token)?.id;

    const res = await makeRequest(`${baseUrl}/api/shared-searches/${id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    // Verify deleted
    const getRes = await makeRequest(`${baseUrl}/api/shared-searches/${token}`);
    expect(getRes.status).toBe(404);
  });

  test("DELETE /api/shared-searches/:id returns 404 for nonexistent", async () => {
    const res = await makeRequest(`${baseUrl}/api/shared-searches/nonexistent`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("GET /api/shared-searches/:token increments view count", async () => {
    const create = await makeRequest(`${baseUrl}/api/shared-searches`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "views test", results: [{ title: "A" }] }),
    });
    const { token } = await create.json();

    await makeRequest(`${baseUrl}/api/shared-searches/${token}`);
    await makeRequest(`${baseUrl}/api/shared-searches/${token}`);
    const res = await makeRequest(`${baseUrl}/api/shared-searches/${token}`);
    const data = await res.json();
    expect(data.viewCount).toBe(3);
  });
});
