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
const ERROR_FILE = path.join(__dirname, "..", "error_log.json");

let originalUsers;
let adminCookie;
let userCookie;
let server;
let baseUrl;

const { default: errorTrackingRoutes, logError } = await import("../routes/errorTracking.js");

function makeRequest(urlStr, options = {}, retries = 3) {
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
    req.on("error", (err) => {
      if ((err.code === "ECONNRESET" || err.code === "ECONNREFUSED") && retries > 0) {
        setTimeout(() => makeRequest(urlStr, options, retries - 1).then(resolve, reject), 100);
      } else {
        reject(err);
      }
    });
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
  app.use(errorTrackingRoutes);
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

describe("Error Tracking", () => {
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
    try { fs.unlinkSync(ERROR_FILE); } catch {}
  });

  beforeEach(() => {
    // Retry on Windows EBUSY errors
    for (let i = 0; i < 5; i++) {
      try {
        if (fs.existsSync(ERROR_FILE)) fs.unlinkSync(ERROR_FILE);
        break;
      } catch (e) {
        if (e.code === "EBUSY" && i < 4) {
          const start = Date.now();
          while (Date.now() - start < 50) { /* busy wait */ }
        } else if (e.code !== "EBUSY") {
          break;
        }
      }
    }
  });

  test("logError helper writes errors", () => {
    const error = new Error("Test error");
    logError(error, { path: "/test", method: "GET" });

    const data = JSON.parse(fs.readFileSync(ERROR_FILE, "utf8"));
    expect(data.errors.length).toBe(1);
    expect(data.errors[0].message).toBe("Test error");
    expect(data.errors[0].stack).toContain("Error");
  });

  test("logError tracks error frequency", () => {
    logError(new Error("Repeated error"), {});
    logError(new Error("Repeated error"), {});
    logError(new Error("Repeated error"), {});

    const data = JSON.parse(fs.readFileSync(ERROR_FILE, "utf8"));
    expect(data.stats["Repeated error"].count).toBe(3);
  });

  test("logError trims to MAX_ERRORS", () => {
    for (let i = 0; i < 510; i++) {
      logError(new Error(`Error ${i}`), {});
    }

    const data = JSON.parse(fs.readFileSync(ERROR_FILE, "utf8"));
    expect(data.errors.length).toBe(500);
  });

  test("GET /api/admin/errors requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/errors`);
    expect(res.status).toBe(401);
  });

  test("GET /api/admin/errors requires admin", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/errors`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/admin/errors returns errors", async () => {
    logError(new Error("Test error 1"), {});
    logError(new Error("Test error 2"), {});

    const res = await makeRequest(`${baseUrl}/api/admin/errors`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.errors.length).toBe(2);
    expect(data.total).toBe(2);
  });

  test("GET /api/admin/errors supports pagination", async () => {
    for (let i = 0; i < 10; i++) {
      logError(new Error(`Error ${i}`), {});
    }

    const res = await makeRequest(`${baseUrl}/api/admin/errors?page=1&limit=3`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.errors.length).toBe(3);
    expect(data.page).toBe(1);
    expect(data.total).toBe(10);
  });

  test("GET /api/admin/errors supports search", async () => {
    logError(new Error("Database connection failed"), {});
    logError(new Error("API timeout"), {});

    const res = await makeRequest(`${baseUrl}/api/admin/errors?search=database`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.errors.length).toBe(1);
    expect(data.errors[0].message).toContain("Database");
  });

  test("GET /api/admin/errors/stats returns stats", async () => {
    logError(new Error("Common error"), {});
    logError(new Error("Common error"), {});
    logError(new Error("Rare error"), {});

    const res = await makeRequest(`${baseUrl}/api/admin/errors/stats`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(3);
    expect(data.topErrors.length).toBeGreaterThan(0);
    expect(data.topErrors[0].count).toBe(2);
  });

  test("DELETE /api/admin/errors clears log", async () => {
    logError(new Error("To clear"), {});

    const res = await makeRequest(`${baseUrl}/api/admin/errors`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    const data = JSON.parse(fs.readFileSync(ERROR_FILE, "utf8"));
    expect(data.errors.length).toBe(0);
  });

  test("POST /api/admin/errors/report accepts client errors", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/errors/report`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Client error", path: "/dashboard" }),
    });
    expect(res.status).toBe(200);

    const data = JSON.parse(fs.readFileSync(ERROR_FILE, "utf8"));
    expect(data.errors[0].method).toBe("CLIENT");
  });
});
