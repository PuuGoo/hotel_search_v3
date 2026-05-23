import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import authRoutes from "../routes/auth.js";
import userRoutes from "../routes/users.js";
import historyRoutes from "../routes/history.js";
import auditRoutes, { logAudit } from "../routes/audit.js";
import { csrfProtection } from "../middleware/csrf.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_USERS_FILE = path.join(__dirname, "..", "users.json");
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const AUDIT_FILE = path.join(__dirname, "..", "audit_log.json");

let originalUsers;
let adminCookie;
let userCookie;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
    })
  );
  app.use(csrfProtection);
  app.use(authRoutes);
  app.use(userRoutes);
  app.use(historyRoutes);
  app.use(auditRoutes);
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  return app;
}

describe("Search History API", () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE)) {
      originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");
    }
    const testUsers = [
      {
        id: 1,
        username: "admin",
        password: await bcrypt.hash("admin123", 10),
        displayName: "Admin",
        role: "admin",
        features: ["tavily", "ddg", "case12"],
        createdAt: new Date().toISOString(),
      },
      {
        id: 2,
        username: "testuser",
        password: await bcrypt.hash("testpass123", 10),
        displayName: "Test User",
        role: "user",
        features: ["tavily"],
        createdAt: new Date().toISOString(),
      },
    ];
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(testUsers, null, 2));

    // Clean up test data
    if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
    if (fs.existsSync(AUDIT_FILE)) fs.unlinkSync(AUDIT_FILE);

    const app = createTestApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });

    // Login as admin
    const adminRes = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
      redirect: "manual",
    });
    adminCookie = adminRes.headers.get("set-cookie");

    // Login as user
    const userRes = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser", password: "testpass123" }),
      redirect: "manual",
    });
    userCookie = userRes.headers.get("set-cookie");
  });

  afterAll(() => {
    if (originalUsers !== undefined) {
      fs.writeFileSync(TEST_USERS_FILE, originalUsers);
    }
    if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
    if (fs.existsSync(AUDIT_FILE)) fs.unlinkSync(AUDIT_FILE);
    if (server) server.close();
  });

  beforeEach(() => {
    // Clean history before each test
    if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
  });

  test("POST /api/search-history saves entry", async () => {
    const res = await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({ query: "hotel da nang", engine: "tavily", resultCount: 5 }),
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.entry.query).toBe("hotel da nang");
    expect(data.entry.engine).toBe("tavily");
    expect(data.entry.resultCount).toBe(5);
  });

  test("POST /api/search-history rejects missing query", async () => {
    const res = await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({ engine: "tavily" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/search-history rejects invalid engine", async () => {
    const res = await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({ query: "test", engine: "invalid" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/search-history returns user's history", async () => {
    // Save two entries
    await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ query: "query1", engine: "tavily" }),
    });
    await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ query: "query2", engine: "google" }),
    });

    const res = await fetch(`${baseUrl}/api/search-history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.history.length).toBe(2);
    expect(data.total).toBe(2);
  });

  test("GET /api/search-history filters by engine", async () => {
    await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ query: "tavily query", engine: "tavily" }),
    });
    await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ query: "google query", engine: "google" }),
    });

    const res = await fetch(`${baseUrl}/api/search-history?engine=tavily`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.history.length).toBe(1);
    expect(data.history[0].engine).toBe("tavily");
  });

  test("DELETE /api/search-history/:id deletes specific entry", async () => {
    const saveRes = await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ query: "to delete", engine: "ddg" }),
    });
    const { entry } = await saveRes.json();

    const delRes = await fetch(`${baseUrl}/api/search-history/${entry.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(delRes.status).toBe(200);

    const getRes = await fetch(`${baseUrl}/api/search-history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await getRes.json();
    expect(data.history.length).toBe(0);
  });

  test("DELETE /api/search-history clears all user history", async () => {
    await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ query: "q1", engine: "tavily" }),
    });
    await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ query: "q2", engine: "google" }),
    });

    const delRes = await fetch(`${baseUrl}/api/search-history`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(delRes.status).toBe(200);

    const getRes = await fetch(`${baseUrl}/api/search-history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await getRes.json();
    expect(data.history.length).toBe(0);
  });

  test("Users only see their own history", async () => {
    // Admin saves entry
    await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ query: "admin query", engine: "tavily" }),
    });

    // User should see empty history
    const res = await fetch(`${baseUrl}/api/search-history`, {
      headers: { Cookie: userCookie },
    });
    const data = await res.json();
    expect(data.history.length).toBe(0);
  });

  test("GET /api/search-history requires auth", async () => {
    const res = await fetch(`${baseUrl}/api/search-history`);
    expect(res.status).toBe(401);
  });

  test("GET /api/admin/search-history requires admin", async () => {
    const res = await fetch(`${baseUrl}/api/admin/search-history`, {
      headers: { Cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/admin/search-history returns summary for admin", async () => {
    await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ query: "test", engine: "tavily" }),
    });

    const res = await fetch(`${baseUrl}/api/admin/search-history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.totalEntries).toBeGreaterThan(0);
  });

  test("DELETE /api/search-history/:id returns 404 for non-existent entry", async () => {
    const res = await fetch(`${baseUrl}/api/search-history/99999`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("Sanitizes XSS in query", async () => {
    const res = await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({ query: "<script>alert(1)</script>", engine: "tavily" }),
    });
    const data = await res.json();
    expect(data.entry.query).not.toContain("<");
    expect(data.entry.query).not.toContain(">");
  });
});

describe("Audit Log API", () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE)) {
      originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");
    }
    const testUsers = [
      {
        id: 1,
        username: "admin",
        password: await bcrypt.hash("admin123", 10),
        displayName: "Admin",
        role: "admin",
        features: ["tavily", "ddg", "case12"],
        createdAt: new Date().toISOString(),
      },
      {
        id: 2,
        username: "testuser",
        password: await bcrypt.hash("testpass123", 10),
        displayName: "Test User",
        role: "user",
        features: ["tavily"],
        createdAt: new Date().toISOString(),
      },
    ];
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(testUsers, null, 2));

    if (fs.existsSync(AUDIT_FILE)) fs.unlinkSync(AUDIT_FILE);

    const app = createTestApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });

    const adminRes = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
      redirect: "manual",
    });
    adminCookie = adminRes.headers.get("set-cookie");

    const userRes = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser", password: "testpass123" }),
      redirect: "manual",
    });
    userCookie = userRes.headers.get("set-cookie");
  });

  afterAll(() => {
    if (originalUsers !== undefined) {
      fs.writeFileSync(TEST_USERS_FILE, originalUsers);
    }
    if (fs.existsSync(AUDIT_FILE)) fs.unlinkSync(AUDIT_FILE);
    if (server) server.close();
  });

  test("logAudit helper writes entries", () => {
    logAudit("test_action", { userId: 1, username: "admin", ip: "127.0.0.1", target: "test" });
    const entries = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].action).toBe("test_action");
    expect(entries[0].username).toBe("admin");
  });

  test("GET /api/admin/audit-log requires admin", async () => {
    const res = await fetch(`${baseUrl}/api/admin/audit-log`, {
      headers: { Cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/admin/audit-log returns entries for admin", async () => {
    const res = await fetch(`${baseUrl}/api/admin/audit-log`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data.entries)).toBe(true);
  });

  test("GET /api/admin/audit-log filters by action", async () => {
    logAudit("unique_test_action", { userId: 1, username: "admin" });
    const res = await fetch(`${baseUrl}/api/admin/audit-log?action=unique_test_action`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.entries.every((e) => e.action === "unique_test_action")).toBe(true);
  });

  test("DELETE /api/admin/audit-log clears log", async () => {
    const res = await fetch(`${baseUrl}/api/admin/audit-log`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    const getRes = await fetch(`${baseUrl}/api/admin/audit-log`, {
      headers: { Cookie: adminCookie },
    });
    const data = await getRes.json();
    // Should only have the "audit_log_cleared" entry
    expect(data.entries.length).toBeLessThanOrEqual(1);
  });

  test("Login creates audit entry", async () => {
    // Clear audit log first
    await fetch(`${baseUrl}/api/admin/audit-log`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });

    // Login again
    await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
      redirect: "manual",
    });

    const res = await fetch(`${baseUrl}/api/admin/audit-log`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    const loginEntry = data.entries.find((e) => e.action === "user_login");
    expect(loginEntry).toBeTruthy();
    expect(loginEntry.username).toBe("admin");
  });

  test("GET /api/admin/audit-log returns pagination info", async () => {
    const res = await fetch(`${baseUrl}/api/admin/audit-log`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data).toHaveProperty("page");
    expect(data).toHaveProperty("limit");
    expect(data).toHaveProperty("totalPages");
    expect(data).toHaveProperty("hasMore");
  });

  test("GET /api/admin/audit-log supports search", async () => {
    logAudit("search_test_action", { userId: 1, username: "findme", ip: "10.0.0.1" });
    const res = await fetch(`${baseUrl}/api/admin/audit-log?search=findme`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.entries.some((e) => e.username === "findme")).toBe(true);
  });

  test("GET /api/admin/audit-log supports pagination", async () => {
    // Add multiple entries
    for (let i = 0; i < 5; i++) {
      logAudit(`page_test_${i}`, { userId: 1, username: "admin" });
    }
    const res = await fetch(`${baseUrl}/api/admin/audit-log?page=1&limit=2`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.entries.length).toBeLessThanOrEqual(2);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(2);
  });

  test("GET /api/admin/audit-log/actions returns unique actions", async () => {
    logAudit("action_list_test", { userId: 1, username: "admin" });
    const res = await fetch(`${baseUrl}/api/admin/audit-log/actions`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data).toHaveProperty("actions");
    expect(Array.isArray(data.actions)).toBe(true);
    expect(data.actions).toContain("action_list_test");
  });

  test("GET /api/admin/audit-log/actions requires admin", async () => {
    const res = await fetch(`${baseUrl}/api/admin/audit-log/actions`, {
      headers: { Cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });
});
