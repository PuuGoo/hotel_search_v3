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
const KEYS_FILE = path.join(__dirname, "..", "api_keys.json");
const AUDIT_FILE = path.join(__dirname, "..", "audit_log.json");

let originalUsers;
let adminCookie;
let userCookie;
let server;
let baseUrl;

const { default: apiKeyRoutes } = await import("../routes/apiKeys.js");
const { default: auditRoutes } = await import("../routes/audit.js");

function makeRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || "GET",
      headers: options.headers || {},
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () =>
        resolve({ status: res.statusCode, json: () => Promise.resolve(JSON.parse(body)) })
      );
    });
    req.on("error", reject);
    if (options.body) req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
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
      req.session.user = {
        id: user.id, username: user.username, role: user.role,
        displayName: user.displayName, features: user.features || [],
      };
      res.json({ success: true });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });
  app.use(auditRoutes);
  app.use(apiKeyRoutes);
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

describe("API Key Management", () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE))
      originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify([
      {
        id: 1, username: "admin", password: await bcrypt.hash("admin123", 10),
        displayName: "Admin", role: "admin", features: [], createdAt: new Date().toISOString(),
      },
      {
        id: 2, username: "user", password: await bcrypt.hash("user123", 10),
        displayName: "User", role: "user", features: [], createdAt: new Date().toISOString(),
      },
    ], null, 2));

    const app = createTestApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
    adminCookie = await loginAs("admin", "admin123");
    userCookie = await loginAs("user", "user123");
  });

  afterAll(() => {
    server?.close();
    if (originalUsers !== undefined) fs.writeFileSync(TEST_USERS_FILE, originalUsers);
    try { fs.unlinkSync(KEYS_FILE); } catch {}
    try { fs.unlinkSync(AUDIT_FILE); } catch {}
  });

  beforeEach(() => {
    fs.writeFileSync(KEYS_FILE, JSON.stringify({ tavily: { name: "Tavily", keys: [], activeIndex: 0 }, google: { name: "Google", keys: [], activeIndex: 0 } }));
  });

  test("GET /api/admin/api-keys requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/api-keys`);
    expect(res.status).toBe(401);
  });

  test("GET /api/admin/api-keys requires admin", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/api-keys`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/admin/api-keys returns providers", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/api-keys`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("tavily");
    expect(data).toHaveProperty("google");
    expect(data.tavily.name).toBe("Tavily");
  });

  test("POST /api/admin/api-keys/:provider adds a key", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/api-keys/tavily`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "tvly-test-key-12345678" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.masked).toContain("****");
  });

  test("POST /api/admin/api-keys/:provider rejects duplicate", async () => {
    await makeRequest(`${baseUrl}/api/admin/api-keys/tavily`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "tvly-same-key" }),
    });
    const res = await makeRequest(`${baseUrl}/api/admin/api-keys/tavily`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "tvly-same-key" }),
    });
    expect(res.status).toBe(409);
  });

  test("POST /api/admin/api-keys/:provider rejects short key", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/api-keys/tavily`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ab" }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /api/admin/api-keys/:provider/active sets active key", async () => {
    await makeRequest(`${baseUrl}/api/admin/api-keys/google`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "google-key-1" }),
    });
    await makeRequest(`${baseUrl}/api/admin/api-keys/google`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "google-key-2" }),
    });

    const res = await makeRequest(`${baseUrl}/api/admin/api-keys/google/active`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ index: 1 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.activeIndex).toBe(1);
  });

  test("DELETE /api/admin/api-keys/:provider/:index removes key", async () => {
    await makeRequest(`${baseUrl}/api/admin/api-keys/tavily`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "tvly-to-delete" }),
    });

    const res = await makeRequest(`${baseUrl}/api/admin/api-keys/tavily/0`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.remaining).toBe(0);
  });

  test("POST /api/admin/api-keys/:provider/test validates key format", async () => {
    await makeRequest(`${baseUrl}/api/admin/api-keys/tavily`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "tvly-valid-key-format" }),
    });

    const res = await makeRequest(`${baseUrl}/api/admin/api-keys/tavily/test`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // The endpoint returns valid=true/false depending on whether the external API accepts the key
    expect(typeof data.valid).toBe("boolean");
    expect(data).toHaveProperty("provider", "tavily");
  }, 15000);

  test("POST /api/admin/api-keys/:provider/test returns 404 when no keys", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/api-keys/tavily/test`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("Masks key correctly", async () => {
    await makeRequest(`${baseUrl}/api/admin/api-keys/tavily`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "tvly-abcdefghij123456" }),
    });

    const res = await makeRequest(`${baseUrl}/api/admin/api-keys`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.tavily.keys[0].masked).toBe("tvly****3456");
  });
});
