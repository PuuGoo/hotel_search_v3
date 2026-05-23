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
const DATA_FILE = path.join(__dirname, "..", "starred_results.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: starredResultRoutes } = await import("../routes/starredResults.js");

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
  app.use(starredResultRoutes);
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

describe("Starred Results", () => {
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

  test("GET /api/starred-results requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/starred-results`);
    expect(res.status).toBe(401);
  });

  test("POST /api/starred-results stars a result", async () => {
    const res = await makeRequest(`${baseUrl}/api/starred-results`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Hotel ABC",
        url: "https://example.com/hotel",
        snippet: "Nice hotel",
        engine: "tavily",
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.title).toBe("Hotel ABC");
    expect(data.url).toBe("https://example.com/hotel");
    expect(data.tags).toEqual([]);
  });

  test("POST /api/starred-results rejects missing title and url", async () => {
    const res = await makeRequest(`${baseUrl}/api/starred-results`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ snippet: "test" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/starred-results rejects duplicate URL", async () => {
    await makeRequest(`${baseUrl}/api/starred-results`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hotel", url: "https://example.com" }),
    });
    const res = await makeRequest(`${baseUrl}/api/starred-results`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hotel Again", url: "https://example.com" }),
    });
    expect(res.status).toBe(409);
  });

  test("GET /api/starred-results returns paginated results", async () => {
    for (let i = 0; i < 3; i++) {
      await makeRequest(`${baseUrl}/api/starred-results`, {
        method: "POST",
        headers: { cookie: adminCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Hotel ${i}`, url: `https://example.com/${i}` }),
      });
    }

    const res = await makeRequest(`${baseUrl}/api/starred-results?page=1&limit=2`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.items.length).toBe(2);
    expect(data.total).toBe(3);
    expect(data.hasMore).toBe(true);
  });

  test("PUT /api/starred-results/:id updates tags", async () => {
    const create = await makeRequest(`${baseUrl}/api/starred-results`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hotel", url: "https://example.com" }),
    });
    const { id } = await create.json();

    const res = await makeRequest(`${baseUrl}/api/starred-results/${id}`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["beach", "luxury"], notes: "Great hotel" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tags).toEqual(["beach", "luxury"]);
    expect(data.notes).toBe("Great hotel");
  });

  test("DELETE /api/starred-results/:id unstars a result", async () => {
    const create = await makeRequest(`${baseUrl}/api/starred-results`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hotel", url: "https://example.com" }),
    });
    const { id } = await create.json();

    const res = await makeRequest(`${baseUrl}/api/starred-results/${id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    const list = await makeRequest(`${baseUrl}/api/starred-results`, {
      headers: { cookie: adminCookie },
    });
    expect(list.json().then(d => d.total)).resolves.toBe(0);
  });

  test("GET /api/starred-results/check checks if URL is starred", async () => {
    await makeRequest(`${baseUrl}/api/starred-results`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hotel", url: "https://starred.com" }),
    });

    const res = await makeRequest(
      `${baseUrl}/api/starred-results/check?url=${encodeURIComponent("https://starred.com")}`,
      { headers: { cookie: adminCookie } }
    );
    const data = await res.json();
    expect(data.starred).toBe(true);

    const res2 = await makeRequest(
      `${baseUrl}/api/starred-results/check?url=${encodeURIComponent("https://not-starred.com")}`,
      { headers: { cookie: adminCookie } }
    );
    const data2 = await res2.json();
    expect(data2.starred).toBe(false);
  });

  test("GET /api/starred-results/stats returns stats", async () => {
    await makeRequest(`${baseUrl}/api/starred-results`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "H1", url: "https://a.com", engine: "tavily", tags: ["beach"] }),
    });
    await makeRequest(`${baseUrl}/api/starred-results`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "H2", url: "https://b.com", engine: "google", tags: ["beach", "luxury"] }),
    });

    const res = await makeRequest(`${baseUrl}/api/starred-results/stats`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.byEngine.tavily).toBe(1);
    expect(data.byEngine.google).toBe(1);
    expect(data.topTags[0].tag).toBe("beach");
    expect(data.topTags[0].count).toBe(2);
  });

  test("PUT /api/starred-results/:id returns 404 for nonexistent", async () => {
    const res = await makeRequest(`${baseUrl}/api/starred-results/nonexistent`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["test"] }),
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/starred-results/:id returns 404 for nonexistent", async () => {
    const res = await makeRequest(`${baseUrl}/api/starred-results/nonexistent`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });
});
