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

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: exportResultRoutes } = await import("../routes/exportResults.js");

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
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: () => Promise.resolve(body),
            json: () => Promise.resolve(JSON.parse(body)),
          })
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
  app.use(exportResultRoutes);
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

describe("Export Results", () => {
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
  });

  test("POST /api/export/csv requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/export/csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results: [{ title: "Test" }] }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/export/csv exports CSV", async () => {
    const results = [
      { title: "Hotel A", url: "https://a.com", snippet: "Nice", engine: "tavily", score: 0.9 },
      { title: "Hotel B", url: "https://b.com", snippet: "Great", engine: "google", score: 0.8 },
    ];
    const res = await makeRequest(`${baseUrl}/api/export/csv`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ results }),
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    const text = await res.text();
    expect(text).toContain("Hotel A");
    expect(text).toContain("Hotel B");
    expect(text).toContain("https://a.com");
  });

  test("POST /api/export/csv handles special characters", async () => {
    const results = [
      { title: 'Hotel "Luxury", Beach', url: "https://a.com", snippet: "Line1\nLine2" },
    ];
    const res = await makeRequest(`${baseUrl}/api/export/csv`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ results }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"Hotel ""Luxury"", Beach"');
  });

  test("POST /api/export/csv rejects empty results", async () => {
    const res = await makeRequest(`${baseUrl}/api/export/csv`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ results: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/export/csv rejects non-array", async () => {
    const res = await makeRequest(`${baseUrl}/api/export/csv`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ results: "not array" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/export/json requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/export/json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results: [{ title: "Test" }] }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/export/json exports JSON", async () => {
    const results = [
      { title: "Hotel A", url: "https://a.com" },
      { title: "Hotel B", url: "https://b.com" },
    ];
    const res = await makeRequest(`${baseUrl}/api/export/json`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ results }),
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toContain("attachment");
    const data = await res.json();
    expect(data.count).toBe(2);
    expect(data.results).toEqual(results);
    expect(data.exportedAt).toBeDefined();
  });

  test("POST /api/export/json rejects empty results", async () => {
    const res = await makeRequest(`${baseUrl}/api/export/json`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ results: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/export/csv uses custom filename", async () => {
    const res = await makeRequest(`${baseUrl}/api/export/csv`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ results: [{ title: "Test" }], filename: "custom.csv" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("custom.csv");
  });
});
