import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import authRoutes from "../routes/auth.js";
import historyRoutes from "../routes/history.js";
import bookmarkRoutes from "../routes/bookmarks.js";
import auditRoutes from "../routes/audit.js";
import dashboardRoutes from "../routes/dashboard.js";
import { csrfProtection } from "../middleware/csrf.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_USERS_FILE = path.join(__dirname, "..", "users.json");
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");
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
  app.use(historyRoutes);
  app.use(bookmarkRoutes);
  app.use(auditRoutes);
  app.use(dashboardRoutes);
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  return app;
}

describe("Pagination", () => {
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
    ];
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(testUsers, null, 2));

    if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
    if (fs.existsSync(BOOKMARKS_FILE)) fs.unlinkSync(BOOKMARKS_FILE);

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

    // Seed history data (15 entries)
    for (let i = 0; i < 15; i++) {
      await fetch(`${baseUrl}/api/search-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ query: `query ${i}`, engine: "tavily", resultCount: i }),
      });
    }

    // Seed bookmark data (12 entries)
    for (let i = 0; i < 12; i++) {
      await fetch(`${baseUrl}/api/bookmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({
          title: `Bookmark ${i}`,
          url: `https://example.com/bookmark-${i}`,
          engine: "tavily",
        }),
      });
    }
  });

  afterAll(() => {
    if (originalUsers !== undefined) {
      fs.writeFileSync(TEST_USERS_FILE, originalUsers);
    }
    if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
    if (fs.existsSync(BOOKMARKS_FILE)) fs.unlinkSync(BOOKMARKS_FILE);
    if (server) server.close();
  });

  test("History returns pagination metadata", async () => {
    const res = await fetch(`${baseUrl}/api/search-history?limit=5`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.total).toBe(15);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(5);
    expect(data.totalPages).toBe(3);
    expect(data.hasMore).toBe(true);
    expect(data.history.length).toBe(5);
  });

  test("History page 2 returns correct offset", async () => {
    const res = await fetch(`${baseUrl}/api/search-history?page=2&limit=5`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.page).toBe(2);
    expect(data.history.length).toBe(5);
    expect(data.hasMore).toBe(true);
  });

  test("History last page has correct hasMore", async () => {
    const res = await fetch(`${baseUrl}/api/search-history?page=3&limit=5`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.page).toBe(3);
    expect(data.history.length).toBe(5);
    expect(data.hasMore).toBe(false);
  });

  test("History defaults to page 1", async () => {
    const res = await fetch(`${baseUrl}/api/search-history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.page).toBe(1);
  });

  test("History clamps page to minimum 1", async () => {
    const res = await fetch(`${baseUrl}/api/search-history?page=-1`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.page).toBe(1);
  });

  test("Bookmarks returns pagination metadata", async () => {
    const res = await fetch(`${baseUrl}/api/bookmarks?limit=5`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.total).toBe(12);
    expect(data.page).toBe(1);
    expect(data.totalPages).toBe(3);
    expect(data.hasMore).toBe(true);
    expect(data.bookmarks.length).toBe(5);
  });

  test("Bookmarks page 3 returns remaining items", async () => {
    const res = await fetch(`${baseUrl}/api/bookmarks?page=3&limit=5`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.page).toBe(3);
    expect(data.bookmarks.length).toBe(2);
    expect(data.hasMore).toBe(false);
  });

  test("Bookmarks beyond total pages returns empty", async () => {
    const res = await fetch(`${baseUrl}/api/bookmarks?page=10&limit=5`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.bookmarks.length).toBe(0);
    expect(data.hasMore).toBe(false);
  });
});

describe("CSV Export", () => {
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
    ];
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(testUsers, null, 2));

    if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
    if (fs.existsSync(BOOKMARKS_FILE)) fs.unlinkSync(BOOKMARKS_FILE);

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

    // Seed data
    await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ query: "hotel da nang", engine: "tavily", resultCount: 5 }),
    });
    await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ query: "resort phu quoc", engine: "google", resultCount: 3 }),
    });

    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        title: "Hotel ABC",
        url: "https://abc.com",
        snippet: "Nice place",
        engine: "tavily",
        tags: ["beach"],
      }),
    });
  });

  afterAll(() => {
    if (originalUsers !== undefined) {
      fs.writeFileSync(TEST_USERS_FILE, originalUsers);
    }
    if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
    if (fs.existsSync(BOOKMARKS_FILE)) fs.unlinkSync(BOOKMARKS_FILE);
    if (server) server.close();
  });

  test("GET /api/search-history/export returns CSV", async () => {
    const res = await fetch(`${baseUrl}/api/search-history/export`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    expect(text).toContain("Query,Engine,Results,Timestamp");
    expect(text).toContain("hotel da nang");
    expect(text).toContain("resort phu quoc");
  });

  test("History export filters by engine", async () => {
    const res = await fetch(`${baseUrl}/api/search-history/export?engine=tavily`, {
      headers: { Cookie: adminCookie },
    });
    const text = await res.text();
    expect(text).toContain("hotel da nang");
    expect(text).not.toContain("resort phu quoc");
  });

  test("GET /api/bookmarks/export returns CSV", async () => {
    const res = await fetch(`${baseUrl}/api/bookmarks/export`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    expect(text).toContain("Title,URL,Snippet,Engine,Query,Tags,Timestamp");
    expect(text).toContain("Hotel ABC");
    expect(text).toContain("beach");
  });

  test("Bookmarks export filters by engine", async () => {
    const res = await fetch(`${baseUrl}/api/bookmarks/export?engine=tavily`, {
      headers: { Cookie: adminCookie },
    });
    const text = await res.text();
    expect(text).toContain("Hotel ABC");
  });

  test("Export requires authentication", async () => {
    const res = await fetch(`${baseUrl}/api/search-history/export`);
    expect(res.status).toBe(401);
  });
});

describe("Dashboard Stats", () => {
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

    if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
    if (fs.existsSync(BOOKMARKS_FILE)) fs.unlinkSync(BOOKMARKS_FILE);
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

    // Seed history
    await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ query: "hotel da nang", engine: "tavily", resultCount: 10 }),
    });
    await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ query: "hotel da nang", engine: "google", resultCount: 5 }),
    });
    await fetch(`${baseUrl}/api/search-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ query: "resort phu quoc", engine: "ddg", resultCount: 8 }),
    });

    // Seed bookmarks
    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        title: "Hotel ABC",
        url: "https://abc.com",
        engine: "tavily",
        tags: ["beach", "luxury"],
      }),
    });
    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        title: "Resort XYZ",
        url: "https://xyz.com",
        engine: "google",
        tags: ["beach"],
      }),
    });
  });

  afterAll(() => {
    if (originalUsers !== undefined) {
      fs.writeFileSync(TEST_USERS_FILE, originalUsers);
    }
    if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
    if (fs.existsSync(BOOKMARKS_FILE)) fs.unlinkSync(BOOKMARKS_FILE);
    if (fs.existsSync(AUDIT_FILE)) fs.unlinkSync(AUDIT_FILE);
    if (server) server.close();
  });

  test("GET /api/dashboard/stats returns user stats", async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/stats`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.searches.total).toBe(3);
    expect(data.searches.byEngine.tavily).toBe(1);
    expect(data.searches.byEngine.google).toBe(1);
    expect(data.searches.byEngine.ddg).toBe(1);
    expect(data.searches.totalResults).toBe(23);
    expect(data.bookmarks.total).toBe(2);
    expect(data.bookmarks.byEngine.tavily).toBe(1);
    expect(data.generatedAt).toBeTruthy();
  });

  test("Dashboard top queries are ranked", async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/stats`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.searches.topQueries.length).toBeGreaterThan(0);
    expect(data.searches.topQueries[0].query).toBe("hotel da nang");
    expect(data.searches.topQueries[0].count).toBe(2);
  });

  test("Dashboard top tags are ranked", async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/stats`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.bookmarks.topTags.length).toBeGreaterThan(0);
    const beachTag = data.bookmarks.topTags.find((t) => t.tag === "beach");
    expect(beachTag).toBeTruthy();
    expect(beachTag.count).toBe(2);
  });

  test("Dashboard recentActivity is an array", async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/stats`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(Array.isArray(data.recentActivity)).toBe(true);
  });

  test("Dashboard requires authentication", async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/stats`);
    expect(res.status).toBe(401);
  });

  test("Admin dashboard returns system-wide stats", async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard/overview`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.system.totalSearches).toBe(3);
    expect(data.system.totalBookmarks).toBe(2);
    expect(data.system.byEngine.tavily).toBe(1);
    expect(data.system.activeSearchUsers).toBe(1);
    expect(Array.isArray(data.recentActions)).toBe(true);
    expect(data.generatedAt).toBeTruthy();
  });

  test("Admin dashboard requires admin role", async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard/overview`, {
      headers: { Cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });
});
