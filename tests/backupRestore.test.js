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
const BACKUP_DIR = path.join(__dirname, "..", "backups");
const AUDIT_FILE = path.join(__dirname, "..", "audit_log.json");

let originalUsers;
let adminCookie;
let userCookie;
let server;
let baseUrl;

const { default: backupRestoreRoutes } = await import("../routes/backupRestore.js");
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
  app.use(backupRestoreRoutes);
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

describe("Backup/Restore", () => {
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
    // Cleanup backups
    if (fs.existsSync(BACKUP_DIR)) {
      fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
    }
    try { fs.unlinkSync(AUDIT_FILE); } catch {}
  });

  beforeEach(() => {
    // Clean backup dir
    if (fs.existsSync(BACKUP_DIR)) {
      fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
    }
  });

  test("GET /api/admin/backup requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/backup`);
    expect(res.status).toBe(401);
  });

  test("GET /api/admin/backup requires admin", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/backup`, {
      headers: { cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/admin/backup creates a backup", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/backup`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("version");
    expect(data).toHaveProperty("timestamp");
    expect(data).toHaveProperty("files");
    expect("users.json" in data.files).toBe(true);
  });

  test("GET /api/admin/backups lists saved backups", async () => {
    // Create a backup first
    await makeRequest(`${baseUrl}/api/admin/backup`, {
      headers: { cookie: adminCookie },
    });

    const res = await makeRequest(`${baseUrl}/api/admin/backups`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.backups.length).toBeGreaterThan(0);
    expect(data.backups[0]).toHaveProperty("filename");
    expect(data.backups[0]).toHaveProperty("size");
  });

  test("POST /api/admin/restore restores from backup", async () => {
    // Create backup
    const backupRes = await makeRequest(`${baseUrl}/api/admin/backup`, {
      headers: { cookie: adminCookie },
    });
    const backup = await backupRes.json();

    // Modify users file
    const dataDir = path.join(__dirname, "..");
    const usersPath = path.join(dataDir, "users.json");
    const originalContent = fs.readFileSync(usersPath, "utf8");

    // Restore
    const res = await makeRequest(`${baseUrl}/api/admin/restore`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ backup }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.restored).toBeGreaterThan(0);
  });

  test("POST /api/admin/restore supports selective restore", async () => {
    const backupRes = await makeRequest(`${baseUrl}/api/admin/backup`, {
      headers: { cookie: adminCookie },
    });
    const backup = await backupRes.json();

    const res = await makeRequest(`${baseUrl}/api/admin/restore`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ backup, selective: ["users.json"] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.restored).toBe(1);
  });

  test("POST /api/admin/restore rejects invalid backup", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/restore`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ backup: { invalid: true } }),
    });
    expect(res.status).toBe(400);
  });

  test("DELETE /api/admin/backups/:filename deletes backup", async () => {
    // Create backup
    await makeRequest(`${baseUrl}/api/admin/backup`, {
      headers: { cookie: adminCookie },
    });

    // List backups
    const listRes = await makeRequest(`${baseUrl}/api/admin/backups`, {
      headers: { cookie: adminCookie },
    });
    const list = await listRes.json();
    const filename = list.backups[0].filename;

    // Delete
    const res = await makeRequest(`${baseUrl}/api/admin/backups/${filename}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    // Verify deleted
    const verifyRes = await makeRequest(`${baseUrl}/api/admin/backups`, {
      headers: { cookie: adminCookie },
    });
    const verify = await verifyRes.json();
    expect(verify.backups.length).toBe(0);
  });

  test("DELETE /api/admin/backups/:filename returns 404 for missing", async () => {
    const res = await makeRequest(`${baseUrl}/api/admin/backups/nonexistent.json`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });
});
