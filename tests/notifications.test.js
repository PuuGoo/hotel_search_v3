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
const DATA_FILE = path.join(__dirname, "..", "notifications.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: notificationRoutes } = await import("../routes/notifications.js");

function makeRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request({
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method: options.method || "GET",
      headers: options.headers || {},
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, json: () => Promise.resolve(JSON.parse(body)) }));
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
  app.use(session({ secret: "test", resave: false, saveUninitialized: false, cookie: { httpOnly: true, maxAge: 86400000 } }));
  app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
    const user = users.find((u) => u.username === username);
    if (user && (await bcrypt.compare(password, user.password))) {
      req.session.isAuthenticated = true;
      req.session.user = { id: user.id, username: user.username, role: user.role, displayName: user.displayName, features: user.features || [] };
      res.json({ success: true });
    } else { res.status(401).json({ error: "Invalid credentials" }); }
  });
  app.use(notificationRoutes);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

async function loginAs(username, password) {
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}/login`);
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve(res.headers["set-cookie"]));
    });
    req.write(JSON.stringify({ username, password }));
    req.end();
  });
}

describe("Notifications", () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE)) originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify([{
      id: 1, username: "admin", password: await bcrypt.hash("admin123", 10),
      displayName: "Admin", role: "admin", features: [], createdAt: new Date().toISOString(),
    }], null, 2));
    const app = createTestApp();
    await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); }); });
    adminCookie = await loginAs("admin", "admin123");
  });

  afterAll(() => {
    server?.close();
    if (originalUsers !== undefined) fs.writeFileSync(TEST_USERS_FILE, originalUsers);
    try { fs.unlinkSync(DATA_FILE); } catch {}
  });

  beforeEach(() => { try { fs.unlinkSync(DATA_FILE); } catch {} });

  test("GET /api/notifications requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/notifications`);
    expect(res.status).toBe(401);
  });

  test("POST /api/notifications creates a notification", async () => {
    const res = await makeRequest(`${baseUrl}/api/notifications`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", message: "Hello", type: "info" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.title).toBe("Test");
    expect(data.read).toBe(false);
  });

  test("GET /api/notifications returns user notifications", async () => {
    await makeRequest(`${baseUrl}/api/notifications`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T1", message: "M1" }),
    });
    await makeRequest(`${baseUrl}/api/notifications`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T2", message: "M2" }),
    });
    const res = await makeRequest(`${baseUrl}/api/notifications`, { headers: { cookie: adminCookie } });
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.unread).toBe(2);
  });

  test("PUT /api/notifications/:id/read marks as read", async () => {
    const create = await makeRequest(`${baseUrl}/api/notifications`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T", message: "M" }),
    });
    const { id } = await create.json();
    const res = await makeRequest(`${baseUrl}/api/notifications/${id}/read`, {
      method: "PUT", headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.read).toBe(true);
  });

  test("PUT /api/notifications/read-all marks all as read", async () => {
    for (let i = 0; i < 3; i++) {
      await makeRequest(`${baseUrl}/api/notifications`, {
        method: "POST",
        headers: { cookie: adminCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ title: `T${i}`, message: `M${i}` }),
      });
    }
    const res = await makeRequest(`${baseUrl}/api/notifications/read-all`, {
      method: "PUT", headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.marked).toBe(3);

    const list = await makeRequest(`${baseUrl}/api/notifications`, { headers: { cookie: adminCookie } });
    const listData = await list.json();
    expect(listData.unread).toBe(0);
  });

  test("DELETE /api/notifications/:id deletes a notification", async () => {
    const create = await makeRequest(`${baseUrl}/api/notifications`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T", message: "M" }),
    });
    const { id } = await create.json();
    const res = await makeRequest(`${baseUrl}/api/notifications/${id}`, {
      method: "DELETE", headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
  });

  test("DELETE /api/notifications/clear-read removes read notifications", async () => {
    const t1 = await makeRequest(`${baseUrl}/api/notifications`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T1", message: "M1" }),
    });
    const { id } = await t1.json();
    await makeRequest(`${baseUrl}/api/notifications/${id}/read`, { method: "PUT", headers: { cookie: adminCookie } });
    await makeRequest(`${baseUrl}/api/notifications`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T2", message: "M2" }),
    });

    const res = await makeRequest(`${baseUrl}/api/notifications/clear-read`, {
      method: "DELETE", headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.deleted).toBe(1);

    const list = await makeRequest(`${baseUrl}/api/notifications`, { headers: { cookie: adminCookie } });
    const listData = await list.json();
    expect(listData.total).toBe(1);
  });

  test("GET /api/notifications/unread-count returns count", async () => {
    await makeRequest(`${baseUrl}/api/notifications`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T", message: "M" }),
    });
    const res = await makeRequest(`${baseUrl}/api/notifications/unread-count`, { headers: { cookie: adminCookie } });
    const data = await res.json();
    expect(data.count).toBe(1);
  });
});
