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

const { default: bulkUserManagementRoutes } = await import("../routes/bulkUserManagement.js");

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
  app.use(bulkUserManagementRoutes);
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

describe("Bulk User Management", () => {
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
  });

  beforeEach(async () => {
    const adminHash = await bcrypt.hash("admin123", 10);
    const userHash = await bcrypt.hash("user123", 10);
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify([
      {
        id: 1, username: "admin", password: adminHash,
        displayName: "Admin", role: "admin", features: [], createdAt: new Date().toISOString(),
      },
      {
        id: 2, username: "user", password: userHash,
        displayName: "User", role: "user", features: [], createdAt: new Date().toISOString(),
      },
    ], null, 2));
  });

  test("POST /api/admin/users/bulk-create requires admin", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/users/bulk-create`, {
      method: "POST",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ users: [{ username: "new", password: "pass1234" }] }),
    });
    expect(res.status).toBe(403);
  });

  test("POST /api/admin/users/bulk-create creates users", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/users/bulk-create`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        users: [
          { username: "bulk1", password: "pass1234", displayName: "Bulk One" },
          { username: "bulk2", password: "pass5678", displayName: "Bulk Two" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.created.length).toBe(2);
    expect(data.errors.length).toBe(0);
  });

  test("POST /api/admin/users/bulk-create handles duplicates", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/users/bulk-create`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        users: [
          { username: "user", password: "pass1234" },
          { username: "newuser", password: "pass5678" },
        ],
      }),
    });
    const data = await res.json();
    expect(data.created.length).toBe(1);
    expect(data.errors.length).toBe(1);
    expect(data.errors[0].error).toContain("already exists");
  });

  test("POST /api/admin/users/bulk-create validates input", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/users/bulk-create`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ users: "not-an-array" }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /api/admin/users/bulk-update updates users", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/users/bulk-update`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        updates: [
          { id: 2, displayName: "Updated User" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.updated.length).toBe(1);
  });

  test("PUT /api/admin/users/bulk-update handles missing users", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/users/bulk-update`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        updates: [{ id: 999, displayName: "Nope" }],
      }),
    });
    const data = await res.json();
    expect(data.updated.length).toBe(0);
    expect(data.errors.length).toBe(1);
  });

  test("DELETE /api/admin/users/bulk-delete deletes users", async () => {
    // Create a user to delete
    await makeRequest(`${baseUrl}/api/admin/users/bulk-create`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ users: [{ username: "to-delete", password: "pass1234" }] }),
    });

    const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
    const targetId = users.find((u) => u.username === "to-delete").id;

    const res = await makeRequest(`${baseUrl}/api/admin/users/bulk-delete?ids=${JSON.stringify([targetId])}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted.length).toBe(1);
  });

  test("DELETE /api/admin/users/bulk-delete prevents self-deletion", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/users/bulk-delete?ids=${JSON.stringify([1])}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.errors.length).toBe(1);
    expect(data.errors[0].error).toContain("yourself");
  });

  test("POST /api/admin/users/bulk-reset-password resets passwords", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/users/bulk-reset-password`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        resets: [{ id: 2, newPassword: "newpass123" }],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reset.length).toBe(1);

    // Verify new password works
    const loginRes = await makeRequest(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "user", password: "newpass123" }),
    });
    expect(loginRes.status).toBe(200);
  });

  test("POST /api/admin/users/bulk-create rejects oversized batch", async () => {
    const users = Array.from({ length: 101 }, (_, i) => ({
      username: `batch${i}`,
      password: "pass1234",
    }));

    const res = await makeRequest(`${baseUrl}/api/admin/users/bulk-create`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ users }),
    });
    expect(res.status).toBe(400);
  });
});
