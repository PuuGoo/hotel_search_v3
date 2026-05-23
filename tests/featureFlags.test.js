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
const FLAGS_FILE = path.join(__dirname, "..", "feature_flags.json");

let originalUsers;
let adminCookie;
let userCookie;
let server;
let baseUrl;

const { default: featureFlagRoutes, isFeatureEnabled } = await import("../routes/featureFlags.js");

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
  app.use(featureFlagRoutes);
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

describe("Feature Flags", () => {
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
    try { fs.unlinkSync(FLAGS_FILE); } catch {}
  });

  beforeEach(() => {
    fs.writeFileSync(FLAGS_FILE, JSON.stringify({ flags: [] }));
  });

  test("isFeatureEnabled returns false for missing flag", () => {
    expect(isFeatureEnabled("nonexistent")).toBe(false);
  });

  test("isFeatureEnabled returns true for enabled flag", () => {
    fs.writeFileSync(FLAGS_FILE, JSON.stringify({
      flags: [{ name: "dark-mode", enabled: true, description: "", createdAt: Date.now(), updatedAt: Date.now() }],
    }));
    expect(isFeatureEnabled("dark-mode")).toBe(true);
  });

  test("isFeatureEnabled returns false for disabled flag", () => {
    fs.writeFileSync(FLAGS_FILE, JSON.stringify({
      flags: [{ name: "dark-mode", enabled: false, description: "", createdAt: Date.now(), updatedAt: Date.now() }],
    }));
    expect(isFeatureEnabled("dark-mode")).toBe(false);
  });

  test("GET /api/admin/flags requires admin", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/flags`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/admin/flags returns flags", async () => {
    fs.writeFileSync(FLAGS_FILE, JSON.stringify({
      flags: [
        { name: "feature-a", enabled: true, description: "Feature A", createdAt: Date.now(), updatedAt: Date.now() },
        { name: "feature-b", enabled: false, description: "Feature B", createdAt: Date.now(), updatedAt: Date.now() },
      ],
    }));

    const res = await makeRequest(`${baseUrl}/api/admin/flags`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.flags.length).toBe(2);
  });

  test("POST /api/admin/flags creates a flag", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/flags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new-feature", description: "A new feature" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("new-feature");
    expect(data.enabled).toBe(false);

    const flags = JSON.parse(fs.readFileSync(FLAGS_FILE, "utf8"));
    expect(flags.flags.length).toBe(1);
  });

  test("POST /api/admin/flags rejects duplicate names", async () => {
    await makeRequest(`${baseUrl}/api/admin/flags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dup-flag" }),
    });

    const res = await makeRequest(`${baseUrl}/api/admin/flags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dup-flag" }),
    });
    expect(res.status).toBe(409);
  });

  test("PUT /api/admin/flags/:name toggles flag", async () => {
    fs.writeFileSync(FLAGS_FILE, JSON.stringify({
      flags: [{ name: "toggle-me", enabled: false, description: "", createdAt: Date.now(), updatedAt: Date.now() }],
    }));

    const res = await makeRequest(`${baseUrl}/api/admin/flags/toggle-me`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.enabled).toBe(true);
  });

  test("PUT /api/admin/flags/:name returns 404 for missing", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/flags/nonexistent`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/admin/flags/:name deletes flag", async () => {
    fs.writeFileSync(FLAGS_FILE, JSON.stringify({
      flags: [{ name: "delete-me", enabled: false, description: "", createdAt: Date.now(), updatedAt: Date.now() }],
    }));

    const res = await makeRequest(`${baseUrl}/api/admin/flags/delete-me`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    const flags = JSON.parse(fs.readFileSync(FLAGS_FILE, "utf8"));
    expect(flags.flags.length).toBe(0);
  });

  test("GET /api/flags returns flags for authenticated users", async () => {
    fs.writeFileSync(FLAGS_FILE, JSON.stringify({
      flags: [{ name: "public-flag", enabled: true, description: "", createdAt: Date.now(), updatedAt: Date.now() }],
    }));

    const res = await makeRequest(`${baseUrl}/api/flags`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.flags.length).toBe(1);
    expect(data.flags[0].name).toBe("public-flag");
    expect(data.flags[0].enabled).toBe(true);
  });

  test("POST /api/admin/flags sanitizes name", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/flags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Feature Flag!" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("my-feature-flag-");
  });
});
