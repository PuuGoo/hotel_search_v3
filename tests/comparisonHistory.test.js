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
const HISTORY_FILE = path.join(__dirname, "..", "comparison_history.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: comparisonRoutes } = await import("../routes/comparison.js");

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
  app.use(comparisonRoutes);
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

function sampleComparison() {
  return {
    query: "hotel hanoi",
    engines: ["tavily", "google"],
    results: {
      tavily: { items: [{ title: "Hotel A", url: "https://a.com", snippet: "Nice hotel", score: 0.9 }] },
      google: { items: [{ title: "Hotel B", url: "https://b.com", snippet: "Great hotel", score: 0 }] },
    },
    errors: {},
  };
}

describe("Comparison History API", () => {
  test("POST /api/compare/save requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/compare/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: sampleComparison(),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/compare/save stores comparison", async () => {
    const res = await makeRequest(`${baseUrl}/api/compare/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: sampleComparison(),
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.comparison.query).toBe("hotel hanoi");
    expect(data.comparison.engines).toEqual(["tavily", "google"]);
  });

  test("POST /api/compare/save rejects missing query", async () => {
    const res = await makeRequest(`${baseUrl}/api/compare/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { results: {} },
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/compare/history returns empty when no history", async () => {
    const res = await makeRequest(`${baseUrl}/api/compare/history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toHaveLength(0);
  });

  test("GET /api/compare/history requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/compare/history`);
    expect(res.status).toBe(401);
  });

  test("GET /api/compare/history returns summaries", async () => {
    await makeRequest(`${baseUrl}/api/compare/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: sampleComparison(),
    });

    const res = await makeRequest(`${baseUrl}/api/compare/history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].query).toBe("hotel hanoi");
    expect(data[0].resultCount).toBe(2);
    expect(data[0].engines).toEqual(["tavily", "google"]);
    expect(data[0].hasErrors).toBe(false);
  });

  test("GET /api/compare/history/:id returns full detail", async () => {
    const saveRes = await makeRequest(`${baseUrl}/api/compare/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: sampleComparison(),
    });
    const saved = await saveRes.json();

    const res = await makeRequest(`${baseUrl}/api/compare/history/${saved.comparison.id}`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.query).toBe("hotel hanoi");
    expect(data.results.tavily.items).toHaveLength(1);
    expect(data.results.google.items).toHaveLength(1);
  });

  test("GET /api/compare/history/:id returns 404 for nonexistent", async () => {
    const res = await makeRequest(`${baseUrl}/api/compare/history/99999`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/compare/history/:id deletes comparison", async () => {
    const saveRes = await makeRequest(`${baseUrl}/api/compare/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: sampleComparison(),
    });
    const saved = await saveRes.json();

    const delRes = await makeRequest(`${baseUrl}/api/compare/history/${saved.comparison.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(delRes.status).toBe(200);

    const listRes = await makeRequest(`${baseUrl}/api/compare/history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await listRes.json();
    expect(data).toHaveLength(0);
  });

  test("DELETE /api/compare/history/:id returns 404 for nonexistent", async () => {
    const res = await makeRequest(`${baseUrl}/api/compare/history/99999`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("Comparison history respects 30-item cap", async () => {
    for (let i = 0; i < 35; i++) {
      await makeRequest(`${baseUrl}/api/compare/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: { query: `query ${i}`, engines: ["tavily"], results: { tavily: { items: [] } }, errors: {} },
      });
    }

    const res = await makeRequest(`${baseUrl}/api/compare/history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data).toHaveLength(30);
    // Newest first
    expect(data[0].query).toBe("query 34");
  });

  test("History with errors shows hasErrors flag", async () => {
    await makeRequest(`${baseUrl}/api/compare/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: {
        query: "test query",
        engines: ["tavily", "google"],
        results: { tavily: { items: [] } },
        errors: { google: "HTTP 500" },
      },
    });

    const res = await makeRequest(`${baseUrl}/api/compare/history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data[0].hasErrors).toBe(true);
  });
});
