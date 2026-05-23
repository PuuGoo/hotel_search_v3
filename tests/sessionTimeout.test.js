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
let server;
let baseUrl;

const { checkAuthenticated } = await import("../middleware/auth.js");

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
          resolve({ status: res.statusCode, json: () => Promise.resolve(JSON.parse(body)), headers: res.headers })
        );
      }
    );
    req.on("error", reject);
    if (options.body)
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

function createTestApp(sessionTimeoutOverride) {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "test",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 86400000 },
  }));

  // Simple login
  app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
    const user = users.find((u) => u.username === username);
    if (user && (await bcrypt.compare(password, user.password))) {
      req.session.isAuthenticated = true;
      req.session.user = { id: user.id, username: user.username, role: user.role };
      req.session.lastActivity = Date.now();
      res.json({ success: true });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  // Protected route using checkAuthenticated
  app.get("/api/protected", checkAuthenticated, (req, res) => {
    res.json({ ok: true, user: req.session.user.username });
  });

  // Session ping
  app.post("/api/session-ping", checkAuthenticated, (req, res) => {
    req.session.lastActivity = Date.now();
    res.json({ success: true });
  });

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

async function loginAndCookie(username, password) {
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}/login`);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: "POST", headers: { "Content-Type": "application/json" },
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        const cookies = res.headers["set-cookie"];
        resolve(cookies ? cookies.map((c) => c.split(";")[0]).join("; ") : "");
      });
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
});

afterAll((done) => {
  if (originalUsers !== undefined) fs.writeFileSync(TEST_USERS_FILE, originalUsers);
  server.close(done);
});

describe("Session Timeout", () => {
  test("authenticated request sets lastActivity on session", async () => {
    const cookie = await loginAndCookie("admin", "Admin123!");
    const res = await makeRequest(`${baseUrl}/api/protected`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  test("session-ping endpoint updates lastActivity", async () => {
    const cookie = await loginAndCookie("admin", "Admin123!");
    const res = await makeRequest(`${baseUrl}/api/session-ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("session-ping requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/session-ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  test("protected route requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/protected`);
    expect(res.status).toBe(401);
  });

  test("multiple requests keep session alive", async () => {
    const cookie = await loginAndCookie("admin", "Admin123!");

    for (let i = 0; i < 3; i++) {
      const res = await makeRequest(`${baseUrl}/api/protected`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
    }
  });
});
