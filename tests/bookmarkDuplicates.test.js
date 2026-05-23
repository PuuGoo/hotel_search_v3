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
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");
const AUDIT_FILE = path.join(__dirname, "..", "audit_log.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: bookmarkRoutes } = await import("../routes/bookmarks.js");

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
          resolve({ status: res.statusCode, json: () => Promise.resolve(JSON.parse(body)) })
        );
      }
    );
    req.on("error", reject);
    if (options.body)
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

function writeBookmarksData(userId, bookmarks) {
  const data = {};
  data[userId] = bookmarks;
  fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(data, null, 2));
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
      req.session.user = { id: user.id, username: user.username, role: user.role, displayName: user.displayName, features: user.features || [] };
      res.json({ success: true });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });
  app.use(bookmarkRoutes);
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
  adminCookie = await loginAs("admin", "Admin123!");
});

afterAll((done) => {
  if (originalUsers !== undefined) fs.writeFileSync(TEST_USERS_FILE, originalUsers);
  try { fs.unlinkSync(BOOKMARKS_FILE); } catch {}
  try { fs.unlinkSync(AUDIT_FILE); } catch {}
  server.close(done);
});

beforeEach(() => {
  fs.writeFileSync(BOOKMARKS_FILE, "{}");
  if (fs.existsSync(AUDIT_FILE)) fs.unlinkSync(AUDIT_FILE);
});

describe("Bookmark Duplicate Detection", () => {
  test("GET /api/bookmarks/duplicates returns empty when no duplicates", async () => {
    writeBookmarksData("1", [
      { id: 1, title: "Hotel A", url: "https://hotel-a.com", engine: "tavily", tags: [], timestamp: Date.now() },
      { id: 2, title: "Hotel B", url: "https://hotel-b.com", engine: "google", tags: [], timestamp: Date.now() },
    ]);

    const res = await makeRequest(`${baseUrl}/api/bookmarks/duplicates`, { headers: { Cookie: adminCookie } });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.duplicateCount).toBe(0);
    expect(data.totalUrls).toBe(0);
    expect(Object.keys(data.duplicates)).toHaveLength(0);
  });

  test("GET /api/bookmarks/duplicates finds duplicates by URL", async () => {
    writeBookmarksData("1", [
      { id: 1, title: "Hotel A", url: "https://hotel-a.com", engine: "tavily", tags: ["tag1"], timestamp: Date.now() },
      { id: 2, title: "Hotel A Again", url: "https://hotel-a.com", engine: "google", tags: ["tag2"], timestamp: Date.now() },
      { id: 3, title: "Hotel B", url: "https://hotel-b.com", engine: "ddg", tags: [], timestamp: Date.now() },
    ]);

    const res = await makeRequest(`${baseUrl}/api/bookmarks/duplicates`, { headers: { Cookie: adminCookie } });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.duplicateCount).toBe(1);
    expect(data.totalUrls).toBe(1);
    expect(data.duplicates["https://hotel-a.com"]).toHaveLength(2);
  });

  test("GET /api/bookmarks/duplicates requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/bookmarks/duplicates`);
    expect(res.status).toBe(401);
  });

  test("GET /api/bookmarks/duplicates handles multiple duplicate groups", async () => {
    writeBookmarksData("1", [
      { id: 1, title: "A1", url: "https://a.com", engine: "tavily", tags: [], timestamp: 1 },
      { id: 2, title: "B1", url: "https://b.com", engine: "google", tags: [], timestamp: 2 },
      { id: 3, title: "A2", url: "https://a.com", engine: "ddg", tags: [], timestamp: 3 },
      { id: 4, title: "B2", url: "https://b.com", engine: "tavily", tags: [], timestamp: 4 },
      { id: 5, title: "C1", url: "https://c.com", engine: "google", tags: [], timestamp: 5 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/bookmarks/duplicates`, { headers: { Cookie: adminCookie } });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.duplicateCount).toBe(2);
    expect(data.totalUrls).toBe(2);
    expect(data.duplicates["https://a.com"]).toHaveLength(2);
    expect(data.duplicates["https://b.com"]).toHaveLength(2);
    expect(data.duplicates["https://c.com"]).toBeUndefined();
  });
});

describe("Bookmark Merge Duplicates", () => {
  test("POST /api/bookmarks/merge-duplicates merges duplicates and keeps first", async () => {
    writeBookmarksData("1", [
      { id: 1, title: "First", url: "https://dup.com", engine: "tavily", tags: ["tag1"], timestamp: 100 },
      { id: 2, title: "Second", url: "https://dup.com", engine: "google", tags: ["tag2"], timestamp: 50 },
      { id: 3, title: "Unique", url: "https://unique.com", engine: "ddg", tags: ["tag3"], timestamp: 200 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/bookmarks/merge-duplicates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.merged).toBe(1);
    expect(data.remaining).toBe(2);

    const listRes = await makeRequest(`${baseUrl}/api/bookmarks`, { headers: { Cookie: adminCookie } });
    const listData = await listRes.json();
    expect(listData.bookmarks).toHaveLength(2);
    const mergedBookmark = listData.bookmarks.find((b) => b.url === "https://dup.com");
    expect(mergedBookmark).toBeDefined();
    expect(mergedBookmark.tags).toContain("tag1");
    expect(mergedBookmark.tags).toContain("tag2");
    const uniqueBookmark = listData.bookmarks.find((b) => b.url === "https://unique.com");
    expect(uniqueBookmark).toBeDefined();
    expect(uniqueBookmark.tags).toContain("tag3");
  });

  test("POST /api/bookmarks/merge-duplicates does nothing when no duplicates", async () => {
    writeBookmarksData("1", [
      { id: 1, title: "Only", url: "https://only.com", engine: "tavily", tags: [], timestamp: 100 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/bookmarks/merge-duplicates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.merged).toBe(0);
    expect(data.remaining).toBe(1);
  });

  test("POST /api/bookmarks/merge-duplicates requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/bookmarks/merge-duplicates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/bookmarks/merge-duplicates handles three duplicates", async () => {
    writeBookmarksData("1", [
      { id: 1, title: "Dup 0", url: "https://triple.com", engine: "tavily", tags: ["tag0"], timestamp: 100 },
      { id: 2, title: "Dup 1", url: "https://triple.com", engine: "google", tags: ["tag1"], timestamp: 50 },
      { id: 3, title: "Dup 2", url: "https://triple.com", engine: "ddg", tags: ["tag2"], timestamp: 25 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/bookmarks/merge-duplicates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.merged).toBe(2);
    expect(data.remaining).toBe(1);
  });

  test("POST /api/bookmarks/merge-duplicates caps tags at 10", async () => {
    const tags1 = Array.from({ length: 8 }, (_, i) => `t${i}`);
    const tags2 = Array.from({ length: 8 }, (_, i) => `u${i}`);

    writeBookmarksData("1", [
      { id: 1, title: "First", url: "https://many-tags.com", engine: "tavily", tags: tags1, timestamp: 100 },
      { id: 2, title: "Second", url: "https://many-tags.com", engine: "google", tags: tags2, timestamp: 50 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/bookmarks/merge-duplicates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.merged).toBe(1);

    const listRes = await makeRequest(`${baseUrl}/api/bookmarks`, { headers: { Cookie: adminCookie } });
    const listData = await listRes.json();
    const merged = listData.bookmarks.find((b) => b.url === "https://many-tags.com");
    expect(merged.tags.length).toBeLessThanOrEqual(10);
    expect(merged.tags.some((t) => t.startsWith("t"))).toBe(true);
    expect(merged.tags.some((t) => t.startsWith("u"))).toBe(true);
  });

  test("POST /api/bookmarks/merge-duplicates preserves non-duplicate bookmarks", async () => {
    writeBookmarksData("1", [
      { id: 1, title: "A", url: "https://a.com", engine: "tavily", tags: [], timestamp: 100 },
      { id: 2, title: "B1", url: "https://b.com", engine: "google", tags: ["x"], timestamp: 90 },
      { id: 3, title: "B2", url: "https://b.com", engine: "ddg", tags: ["y"], timestamp: 80 },
      { id: 4, title: "C", url: "https://c.com", engine: "tavily", tags: [], timestamp: 70 },
      { id: 5, title: "D1", url: "https://d.com", engine: "google", tags: [], timestamp: 60 },
      { id: 6, title: "D2", url: "https://d.com", engine: "ddg", tags: [], timestamp: 50 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/bookmarks/merge-duplicates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.merged).toBe(2);
    expect(data.remaining).toBe(4);
  });
});

describe("Bookmark JSON Export", () => {
  test("GET /api/bookmarks/export-json returns JSON file", async () => {
    writeBookmarksData("1", [
      { id: 1, title: "Hotel A", url: "https://a.com", engine: "tavily", tags: ["tag1"], folder: "favs", timestamp: 100 },
      { id: 2, title: "Hotel B", url: "https://b.com", engine: "google", tags: [], folder: "", timestamp: 200 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/bookmarks/export-json`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.totalBookmarks).toBe(2);
    expect(data.exportedAt).toBeDefined();
    expect(data.bookmarks).toHaveLength(2);
    // Sorted by timestamp desc
    expect(data.bookmarks[0].url).toBe("https://b.com");
    expect(data.bookmarks[1].url).toBe("https://a.com");
    expect(data.bookmarks[1].tags).toContain("tag1");
    expect(data.bookmarks[1].folder).toBe("favs");
  });

  test("GET /api/bookmarks/export-json requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/bookmarks/export-json`);
    expect(res.status).toBe(401);
  });

  test("GET /api/bookmarks/export-json filters by engine", async () => {
    writeBookmarksData("1", [
      { id: 1, title: "A", url: "https://a.com", engine: "tavily", tags: [], timestamp: 100 },
      { id: 2, title: "B", url: "https://b.com", engine: "google", tags: [], timestamp: 200 },
      { id: 3, title: "C", url: "https://c.com", engine: "ddg", tags: [], timestamp: 300 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/bookmarks/export-json?engine=google`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.totalBookmarks).toBe(1);
    expect(data.bookmarks[0].engine).toBe("google");
  });

  test("GET /api/bookmarks/export-json filters by tag", async () => {
    writeBookmarksData("1", [
      { id: 1, title: "A", url: "https://a.com", engine: "tavily", tags: ["special"], timestamp: 100 },
      { id: 2, title: "B", url: "https://b.com", engine: "google", tags: ["other"], timestamp: 200 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/bookmarks/export-json?tag=special`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.totalBookmarks).toBe(1);
    expect(data.bookmarks[0].tags).toContain("special");
  });

  test("GET /api/bookmarks/export-json filters by folder", async () => {
    writeBookmarksData("1", [
      { id: 1, title: "A", url: "https://a.com", engine: "tavily", tags: [], folder: "work", timestamp: 100 },
      { id: 2, title: "B", url: "https://b.com", engine: "google", tags: [], folder: "personal", timestamp: 200 },
      { id: 3, title: "C", url: "https://c.com", engine: "ddg", tags: [], folder: "", timestamp: 300 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/bookmarks/export-json?folder=work`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.totalBookmarks).toBe(1);
    expect(data.bookmarks[0].folder).toBe("work");
  });

  test("GET /api/bookmarks/export-json includes date field", async () => {
    writeBookmarksData("1", [
      { id: 1, title: "A", url: "https://a.com", engine: "tavily", tags: [], timestamp: 1700000000000 },
    ]);

    const res = await makeRequest(`${baseUrl}/api/bookmarks/export-json`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.bookmarks[0].date).toBe(new Date(1700000000000).toISOString());
  });
});
