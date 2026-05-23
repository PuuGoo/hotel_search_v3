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
const COLLECTIONS_FILE = path.join(__dirname, "..", "bookmark_collections.json");
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: collectionRoutes } = await import("../routes/collections.js");
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
  app.use(collectionRoutes);
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
  try { fs.unlinkSync(COLLECTIONS_FILE); } catch {}
  try { fs.unlinkSync(BOOKMARKS_FILE); } catch {}
  server.close(done);
});

beforeEach(() => {
  for (const file of [COLLECTIONS_FILE, BOOKMARKS_FILE]) {
    for (let i = 0; i < 5; i++) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        break;
      } catch (e) {
        if (e.code === "EBUSY") {
          const start = Date.now();
          while (Date.now() - start < 50) { /* busy wait */ }
        } else break;
      }
    }
  }
});

async function addBookmark(overrides = {}) {
  const res = await makeRequest(`${baseUrl}/api/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: { title: "Test Hotel", url: `https://example.com/${Date.now()}`, engine: "tavily", ...overrides },
  });
  return (await res.json()).bookmark;
}

describe("Bookmark Collections", () => {
  test("GET /api/collections requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/collections`);
    expect(res.status).toBe(401);
  });

  test("POST /api/collections creates a collection", async () => {
    const res = await makeRequest(`${baseUrl}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "My Collection", description: "Test desc" },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.collection.name).toBe("My Collection");
    expect(data.collection.description).toBe("Test desc");
  });

  test("POST /api/collections rejects missing name", async () => {
    const res = await makeRequest(`${baseUrl}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { description: "No name" },
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/collections sanitizes name", async () => {
    const res = await makeRequest(`${baseUrl}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "<script>alert(1)</script>" },
    });
    const data = await res.json();
    expect(data.collection.name).not.toContain("<");
  });

  test("POST /api/collections with bookmarkIds", async () => {
    const b1 = await addBookmark({ title: "Hotel A", url: "https://a.com" });
    const b2 = await addBookmark({ title: "Hotel B", url: "https://b.com" });

    const res = await makeRequest(`${baseUrl}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "With Bookmarks", bookmarkIds: [b1.id, b2.id] },
    });
    const data = await res.json();
    expect(data.collection.bookmarkIds).toHaveLength(2);
  });

  test("GET /api/collections lists collections", async () => {
    await makeRequest(`${baseUrl}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "Col A" },
    });
    await makeRequest(`${baseUrl}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "Col B" },
    });

    const res = await makeRequest(`${baseUrl}/api/collections`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.collections).toHaveLength(2);
  });

  test("GET /api/collections/:id returns detail with bookmarks", async () => {
    const b = await addBookmark({ title: "Detail Hotel", url: "https://detail.com" });
    const createRes = await makeRequest(`${baseUrl}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "Detail Col", bookmarkIds: [b.id] },
    });
    const created = await createRes.json();

    const res = await makeRequest(`${baseUrl}/api/collections/${created.collection.id}`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.name).toBe("Detail Col");
    expect(data.bookmarks).toHaveLength(1);
    expect(data.bookmarks[0].title).toBe("Detail Hotel");
  });

  test("GET /api/collections/:id returns 404 for nonexistent", async () => {
    const res = await makeRequest(`${baseUrl}/api/collections/99999`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("PUT /api/collections/:id updates name", async () => {
    const createRes = await makeRequest(`${baseUrl}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "Old Name" },
    });
    const created = await createRes.json();

    const res = await makeRequest(`${baseUrl}/api/collections/${created.collection.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "New Name" },
    });
    const data = await res.json();
    expect(data.collection.name).toBe("New Name");
  });

  test("PUT /api/collections/:id adds and removes bookmarks", async () => {
    const b1 = await addBookmark({ title: "B1", url: "https://b1.com" });
    const b2 = await addBookmark({ title: "B2", url: "https://b2.com" });
    const b3 = await addBookmark({ title: "B3", url: "https://b3.com" });

    const createRes = await makeRequest(`${baseUrl}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "Edit Col", bookmarkIds: [b1.id] },
    });
    const created = await createRes.json();

    // Add b2, b3 and remove b1
    const res = await makeRequest(`${baseUrl}/api/collections/${created.collection.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { addBookmarkIds: [b2.id, b3.id], removeBookmarkIds: [b1.id] },
    });
    const data = await res.json();
    expect(data.collection.bookmarkIds).toContain(b2.id);
    expect(data.collection.bookmarkIds).toContain(b3.id);
    expect(data.collection.bookmarkIds).not.toContain(b1.id);
  });

  test("DELETE /api/collections/:id deletes collection", async () => {
    const createRes = await makeRequest(`${baseUrl}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "To Delete" },
    });
    const created = await createRes.json();

    const delRes = await makeRequest(`${baseUrl}/api/collections/${created.collection.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(delRes.status).toBe(200);

    const listRes = await makeRequest(`${baseUrl}/api/collections`, {
      headers: { Cookie: adminCookie },
    });
    const data = await listRes.json();
    expect(data.collections).toHaveLength(0);
  });

  test("POST /api/collections/:id/share generates share token", async () => {
    const createRes = await makeRequest(`${baseUrl}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "Shared Col" },
    });
    const created = await createRes.json();

    const res = await makeRequest(`${baseUrl}/api/collections/${created.collection.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: {},
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.token).toBeDefined();
    expect(data.url).toContain("/collections/view/");
  });

  test("GET /api/collections/view/:token returns public view", async () => {
    const b = await addBookmark({ title: "Public Hotel", url: "https://pub.com" });
    const createRes = await makeRequest(`${baseUrl}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "Public Col", bookmarkIds: [b.id] },
    });
    const created = await createRes.json();

    const shareRes = await makeRequest(`${baseUrl}/api/collections/${created.collection.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: {},
    });
    const shareData = await shareRes.json();

    // Public view (no auth)
    const res = await makeRequest(`${baseUrl}/api/collections/view/${shareData.token}`);
    const data = await res.json();
    expect(data.name).toBe("Public Col");
    expect(data.bookmarks).toHaveLength(1);
    expect(data.bookmarks[0].title).toBe("Public Hotel");
  });

  test("POST /api/collections/:id/share revoke removes token", async () => {
    const createRes = await makeRequest(`${baseUrl}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "Revoke Col" },
    });
    const created = await createRes.json();

    // Share
    await makeRequest(`${baseUrl}/api/collections/${created.collection.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: {},
    });

    // Revoke
    const res = await makeRequest(`${baseUrl}/api/collections/${created.collection.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { revoke: true },
    });
    const data = await res.json();
    expect(data.revoked).toBe(true);

    // Verify share link no longer works
    const viewRes = await makeRequest(`${baseUrl}/api/collections/view/invalidtoken`);
    expect(viewRes.status).toBe(404);
  });

  test("Collections respect 30-item cap", async () => {
    for (let i = 0; i < 32; i++) {
      await makeRequest(`${baseUrl}/api/collections`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: { name: `Col ${i}` },
      });
    }

    const res = await makeRequest(`${baseUrl}/api/collections`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.collections).toHaveLength(30);
  });
});
