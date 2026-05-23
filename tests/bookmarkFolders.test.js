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
const FOLDERS_FILE = path.join(__dirname, "..", "bookmark_folders.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: bookmarkRoutes } = await import("../routes/bookmarks.js");

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

describe("Bookmark Folders", () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE))
      originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");

    const adminHash = await bcrypt.hash("Admin123!", 10);
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify([
      {
        id: 1, username: "admin", password: adminHash,
        displayName: "Admin", role: "admin", features: [], createdAt: new Date().toISOString(),
      },
    ], null, 2));

    const app = createTestApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
    adminCookie = await loginAs("admin", "Admin123!");
  });

  afterAll(() => {
    server?.close();
    if (originalUsers !== undefined) fs.writeFileSync(TEST_USERS_FILE, originalUsers);
    try { fs.unlinkSync(BOOKMARKS_FILE); } catch {}
    try { fs.unlinkSync(FOLDERS_FILE); } catch {}
  });

  beforeEach(() => {
    fs.writeFileSync(BOOKMARKS_FILE, "{}");
    fs.writeFileSync(FOLDERS_FILE, "{}");
  });

  test("GET /api/bookmark-folders requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/bookmark-folders`);
    expect(res.status).toBe(401);
  });

  test("GET /api/bookmark-folders returns empty list initially", async () => {
    const res = await makeRequest(`${baseUrl}/api/bookmark-folders`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.folders).toEqual([]);
  });

  test("POST /api/bookmark-folders creates a folder", async () => {
    const res = await makeRequest(`${baseUrl}/api/bookmark-folders`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hotels" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.folder.name).toBe("Hotels");
  });

  test("POST /api/bookmark-folders rejects duplicate name", async () => {
    await makeRequest(`${baseUrl}/api/bookmark-folders`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hotels" }),
    });
    const res = await makeRequest(`${baseUrl}/api/bookmark-folders`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hotels" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/bookmark-folders rejects empty name", async () => {
    const res = await makeRequest(`${baseUrl}/api/bookmark-folders`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /api/bookmark-folders/:id renames folder", async () => {
    const createRes = await makeRequest(`${baseUrl}/api/bookmark-folders`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hotels" }),
    });
    const { folder } = await createRes.json();

    const res = await makeRequest(`${baseUrl}/api/bookmark-folders/${folder.id}`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Accommodations" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.folder.name).toBe("Accommodations");
  });

  test("PUT /api/bookmark-folders/:id updates bookmarks with old folder name", async () => {
    // Create folder
    const createRes = await makeRequest(`${baseUrl}/api/bookmark-folders`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hotels" }),
    });
    const { folder } = await createRes.json();

    // Create bookmark in folder
    await makeRequest(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", url: "https://example.com", engine: "tavily", folder: "Hotels" }),
    });

    // Rename folder
    await makeRequest(`${baseUrl}/api/bookmark-folders/${folder.id}`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Accommodations" }),
    });

    // Check bookmark was updated
    const bookmarksRes = await makeRequest(`${baseUrl}/api/bookmarks`, {
      headers: { cookie: adminCookie },
    });
    const bookmarksData = await bookmarksRes.json();
    expect(bookmarksData.bookmarks[0].folder).toBe("Accommodations");
  });

  test("DELETE /api/bookmark-folders/:id deletes folder", async () => {
    const createRes = await makeRequest(`${baseUrl}/api/bookmark-folders`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hotels" }),
    });
    const { folder } = await createRes.json();

    const res = await makeRequest(`${baseUrl}/api/bookmark-folders/${folder.id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("DELETE /api/bookmark-folders/:id uncategorizes bookmarks", async () => {
    // Create folder
    const createRes = await makeRequest(`${baseUrl}/api/bookmark-folders`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hotels" }),
    });
    const { folder } = await createRes.json();

    // Create bookmark in folder
    await makeRequest(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", url: "https://example.com", engine: "tavily", folder: "Hotels" }),
    });

    // Delete folder
    await makeRequest(`${baseUrl}/api/bookmark-folders/${folder.id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });

    // Check bookmark was uncategorized
    const bookmarksRes = await makeRequest(`${baseUrl}/api/bookmarks`, {
      headers: { cookie: adminCookie },
    });
    const bookmarksData = await bookmarksRes.json();
    expect(bookmarksData.bookmarks[0].folder).toBe("");
  });

  test("GET /api/bookmarks filters by folder", async () => {
    // Create folder
    await makeRequest(`${baseUrl}/api/bookmark-folders`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hotels" }),
    });

    // Create bookmark in folder
    await makeRequest(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "In Folder", url: "https://example.com/1", engine: "tavily", folder: "Hotels" }),
    });

    // Create uncategorized bookmark
    await makeRequest(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Uncategorized", url: "https://example.com/2", engine: "tavily" }),
    });

    // Filter by folder
    const res = await makeRequest(`${baseUrl}/api/bookmarks?folder=Hotels`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.bookmarks.length).toBe(1);
    expect(data.bookmarks[0].title).toBe("In Folder");

    // Filter uncategorized
    const res2 = await makeRequest(`${baseUrl}/api/bookmarks?folder=uncategorized`, {
      headers: { cookie: adminCookie },
    });
    const data2 = await res2.json();
    expect(data2.bookmarks.length).toBe(1);
    expect(data2.bookmarks[0].title).toBe("Uncategorized");
  });

  test("POST /api/bookmarks/move moves bookmarks to folder", async () => {
    // Create folder
    await makeRequest(`${baseUrl}/api/bookmark-folders`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hotels" }),
    });

    // Create bookmark
    const createRes = await makeRequest(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", url: "https://example.com", engine: "tavily" }),
    });
    const { bookmark } = await createRes.json();

    // Move to folder
    const res = await makeRequest(`${baseUrl}/api/bookmarks/move`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ bookmarkIds: [bookmark.id], folder: "Hotels" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.moved).toBe(1);

    // Verify
    const bookmarksRes = await makeRequest(`${baseUrl}/api/bookmarks?folder=Hotels`, {
      headers: { cookie: adminCookie },
    });
    const bookmarksData = await bookmarksRes.json();
    expect(bookmarksData.bookmarks.length).toBe(1);
  });

  test("GET /api/bookmark-folders includes bookmark counts", async () => {
    // Create folder
    await makeRequest(`${baseUrl}/api/bookmark-folders`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hotels" }),
    });

    // Create bookmarks in folder
    await makeRequest(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test 1", url: "https://example.com/1", engine: "tavily", folder: "Hotels" }),
    });
    await makeRequest(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test 2", url: "https://example.com/2", engine: "tavily", folder: "Hotels" }),
    });

    // Create uncategorized bookmark
    await makeRequest(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Uncategorized", url: "https://example.com/3", engine: "tavily" }),
    });

    const res = await makeRequest(`${baseUrl}/api/bookmark-folders`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.folders[0].bookmarkCount).toBe(2);
    expect(data.uncategorized).toBe(1);
  });
});
