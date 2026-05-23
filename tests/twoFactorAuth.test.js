import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import http from "http";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_USERS_FILE = path.join(__dirname, "..", "users.json");
const TOTP_FILE = path.join(__dirname, "..", "totp_secrets.json");

let originalUsers;
let adminCookie;
let userCookie;
let server;
let baseUrl;

const { default: twoFactorAuthRoutes, is2FAEnabled, verify2FACode } = await import("../routes/twoFactorAuth.js");

// TOTP helper for tests
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const TOTP_ALGORITHM = "sha1";

function base32Decode(str) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of str.toUpperCase()) {
    const val = chars.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTOTP(secret, timeOffset = 0) {
  const key = base32Decode(secret);
  const time = Math.floor(Date.now() / 1000 / TOTP_PERIOD) + timeOffset;
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeUInt32BE(Math.floor(time / 0x100000000), 0);
  timeBuffer.writeUInt32BE(time & 0xffffffff, 4);
  const hmac = crypto.createHmac(TOTP_ALGORITHM, key);
  hmac.update(timeBuffer);
  const hash = hmac.digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const code = (
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff)
  ) % Math.pow(10, TOTP_DIGITS);
  return code.toString().padStart(TOTP_DIGITS, "0");
}

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
  app.use(twoFactorAuthRoutes);
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

describe("Two-Factor Authentication", () => {
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
    try { fs.unlinkSync(TOTP_FILE); } catch {}
  });

  beforeEach(() => {
    fs.writeFileSync(TOTP_FILE, "{}");
  });

  test("POST /api/2fa/setup generates secret", async () => {
    const res = await makeRequest(`${baseUrl}/api/2fa/setup`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.secret).toBeDefined();
    expect(data.secret.length).toBe(20);
    expect(data.uri).toContain("otpauth://totp/HotelSearch");
  });

  test("POST /api/2fa/setup requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/2fa/setup`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/2fa/verify enables 2FA with valid code", async () => {
    // Setup first
    const setupRes = await makeRequest(`${baseUrl}/api/2fa/setup`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    const { secret } = await setupRes.json();

    // Generate valid code
    const code = generateTOTP(secret);

    const res = await makeRequest(`${baseUrl}/api/2fa/verify`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("POST /api/2fa/verify rejects invalid code", async () => {
    await makeRequest(`${baseUrl}/api/2fa/setup`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });

    const res = await makeRequest(`${baseUrl}/api/2fa/verify`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/2fa/verify rejects code without setup", async () => {
    const res = await makeRequest(`${baseUrl}/api/2fa/verify`, {
      method: "POST",
      headers: { cookie: userCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "123456" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/2fa/status shows disabled by default", async () => {
    const res = await makeRequest(`${baseUrl}/api/2fa/status`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.enabled).toBe(false);
    expect(data.setupPending).toBe(false);
  });

  test("GET /api/2fa/status shows pending after setup", async () => {
    await makeRequest(`${baseUrl}/api/2fa/setup`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });

    const res = await makeRequest(`${baseUrl}/api/2fa/status`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.enabled).toBe(false);
    expect(data.setupPending).toBe(true);
  });

  test("POST /api/2fa/disable requires valid code", async () => {
    // Setup and enable
    const setupRes = await makeRequest(`${baseUrl}/api/2fa/setup`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    const { secret } = await setupRes.json();
    const code = generateTOTP(secret);
    await makeRequest(`${baseUrl}/api/2fa/verify`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    // Try disable with wrong code
    const res = await makeRequest(`${baseUrl}/api/2fa/disable`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/2fa/disable works with valid code", async () => {
    // Setup and enable
    const setupRes = await makeRequest(`${baseUrl}/api/2fa/setup`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    const { secret } = await setupRes.json();
    const code = generateTOTP(secret);
    await makeRequest(`${baseUrl}/api/2fa/verify`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    // Disable with valid code
    const disableCode = generateTOTP(secret);
    const res = await makeRequest(`${baseUrl}/api/2fa/disable`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ code: disableCode }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("is2FAEnabled helper works", async () => {
    expect(is2FAEnabled(999)).toBe(false);
  });

  test("verify2FACode helper works", async () => {
    expect(verify2FACode(999, "123456")).toBe(false);
  });
});
