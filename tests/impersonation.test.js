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

let originalUsers;
let adminCookie;
let userCookie;
let server;
let baseUrl;

const { default: impersonationRoutes } = await import("../routes/impersonation.js");

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
  app.get("/api/me", (req, res) => {
    if (!req.session.isAuthenticated) return res.status(401).json({ error: "Not authenticated" });
    res.json({ ...req.session.user, impersonating: !!req.session.impersonator });
  });
  app.use(impersonationRoutes);
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

describe("User Impersonation", () => {
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
      {
        id: 3, username: "user2", password: await bcrypt.hash("user456", 10),
        displayName: "User Two", role: "user", features: [], createdAt: new Date().toISOString(),
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
  });

  test("POST /api/admin/impersonate/:userId requires admin", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/impersonate/2`, {
      method: "POST",
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });

  test("POST /api/admin/impersonate/:userId starts impersonation", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/impersonate/2`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.impersonating.username).toBe("user");

    // Stop impersonation for cleanup
    await makeRequest(`${baseUrl}/api/admin/stop-impersonating`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
  });

  test("POST /api/admin/impersonate/:userId returns 404 for missing user", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/impersonate/999`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("POST /api/admin/impersonate/:userId blocks impersonating admins", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/impersonate/1`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/admin/impersonation/status shows impersonation state", async () => {
    // Start impersonation
    await makeRequest(`${baseUrl}/api/admin/impersonate/2`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });

    const res = await makeRequest(`${baseUrl}/api/admin/impersonation/status`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.impersonating).toBe(true);
    expect(data.originalAdmin.username).toBe("admin");
    expect(data.currentUser.username).toBe("user");

    // Stop impersonation
    await makeRequest(`${baseUrl}/api/admin/stop-impersonating`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
  });

  test("POST /api/admin/stop-impersonating restores admin session", async () => {
    // Start impersonation
    await makeRequest(`${baseUrl}/api/admin/impersonate/2`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });

    // Stop impersonation
    const res = await makeRequest(`${baseUrl}/api/admin/stop-impersonating`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    // Verify back to admin
    const meRes = await makeRequest(`${baseUrl}/api/me`, {
      headers: { cookie: adminCookie },
    });
    const me = await meRes.json();
    expect(me.username).toBe("admin");
    expect(me.impersonating).toBe(false);
  });

  test("POST /api/admin/stop-impersonating fails when not impersonating", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/stop-impersonating`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/admin/users-list returns non-admin users", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/users-list`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.users.length).toBe(2);
    expect(data.users.every((u) => u.role !== "admin")).toBe(true);
  });

  test("GET /api/admin/users-list requires admin", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/users-list`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });
});
