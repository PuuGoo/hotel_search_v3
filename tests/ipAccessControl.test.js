import { describe, test, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";
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
const IP_FILE = path.join(__dirname, "..", "ip_access_control.json");

let originalUsers;
let adminCookie;
let userCookie;
let server;
let baseUrl;

const { default: ipAccessControlRoutes, ipAccessControl, readIPConfig } = await import("../routes/ipAccessControl.js");

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
  app.use(ipAccessControlRoutes);
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

describe("IP Access Control", () => {
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
    try { fs.unlinkSync(IP_FILE); } catch {}
  });

  beforeEach(() => {
    fs.writeFileSync(IP_FILE, JSON.stringify({ mode: "disabled", whitelist: [], blacklist: [] }));
  });

  test("readIPConfig returns default config", () => {
    const config = readIPConfig();
    expect(config.mode).toBe("disabled");
    expect(config.whitelist).toEqual([]);
    expect(config.blacklist).toEqual([]);
  });

  test("GET /api/admin/ip-access requires admin", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/ip-access`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/admin/ip-access returns config", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/ip-access`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe("disabled");
  });

  test("PUT /api/admin/ip-access updates mode", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/ip-access`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "whitelist" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe("whitelist");
  });

  test("PUT /api/admin/ip-access rejects invalid mode", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/ip-access`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "invalid" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/admin/ip-access/whitelist adds IP", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/ip-access/whitelist`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ ip: "192.168.1.100" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.whitelist).toContain("192.168.1.100");
  });

  test("POST /api/admin/ip-access/whitelist rejects duplicates", async () => {
    await makeRequest(`${baseUrl}/api/admin/ip-access/whitelist`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ ip: "10.0.0.1" }),
    });
    await makeRequest(`${baseUrl}/api/admin/ip-access/whitelist`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ ip: "10.0.0.1" }),
    });

    const config = readIPConfig();
    expect(config.whitelist.length).toBe(1);
  });

  test("DELETE /api/admin/ip-access/whitelist removes IP", async () => {
    await makeRequest(`${baseUrl}/api/admin/ip-access/whitelist`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ ip: "192.168.1.1" }),
    });

    const res = await makeRequest(`${baseUrl}/api/admin/ip-access/whitelist?ip=192.168.1.1`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.whitelist).not.toContain("192.168.1.1");
  });

  test("POST /api/admin/ip-access/blacklist adds IP", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/ip-access/blacklist`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ ip: "10.0.0.50" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.blacklist).toContain("10.0.0.50");
  });

  test("DELETE /api/admin/ip-access/blacklist removes IP", async () => {
    await makeRequest(`${baseUrl}/api/admin/ip-access/blacklist`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ ip: "10.0.0.50" }),
    });

    const res = await makeRequest(`${baseUrl}/api/admin/ip-access/blacklist?ip=10.0.0.50`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.blacklist).not.toContain("10.0.0.50");
  });

  test("ipAccessControl middleware passes when disabled", () => {
    fs.writeFileSync(IP_FILE, JSON.stringify({ mode: "disabled", whitelist: [], blacklist: [] }));

    const req = { ip: "192.168.1.1" };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    ipAccessControl(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("ipAccessControl middleware blocks non-whitelisted IP", () => {
    fs.writeFileSync(IP_FILE, JSON.stringify({ mode: "whitelist", whitelist: ["10.0.0.1"], blacklist: [] }));

    const req = { ip: "192.168.1.100" };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    ipAccessControl(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("ipAccessControl middleware allows whitelisted IP", () => {
    fs.writeFileSync(IP_FILE, JSON.stringify({ mode: "whitelist", whitelist: ["192.168.1.100"], blacklist: [] }));

    const req = { ip: "192.168.1.100" };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    ipAccessControl(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("ipAccessControl middleware blocks blacklisted IP", () => {
    fs.writeFileSync(IP_FILE, JSON.stringify({ mode: "blacklist", whitelist: [], blacklist: ["192.168.1.100"] }));

    const req = { ip: "192.168.1.100" };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    ipAccessControl(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("ipAccessControl middleware allows non-blacklisted IP", () => {
    fs.writeFileSync(IP_FILE, JSON.stringify({ mode: "blacklist", whitelist: [], blacklist: ["10.0.0.1"] }));

    const req = { ip: "192.168.1.100" };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    ipAccessControl(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("ipAccessControl supports CIDR matching", () => {
    fs.writeFileSync(IP_FILE, JSON.stringify({ mode: "whitelist", whitelist: ["192.168.1.0/24"], blacklist: [] }));

    const req = { ip: "192.168.1.50" };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    ipAccessControl(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("ipAccessControl handles IPv6-mapped IPv4", () => {
    fs.writeFileSync(IP_FILE, JSON.stringify({ mode: "whitelist", whitelist: ["192.168.1.100"], blacklist: [] }));

    const req = { ip: "::ffff:192.168.1.100" };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    ipAccessControl(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
