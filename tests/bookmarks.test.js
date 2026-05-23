import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import authRoutes from "../routes/auth.js";
import bookmarkRoutes from "../routes/bookmarks.js";
import { csrfProtection } from "../middleware/csrf.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_USERS_FILE = path.join(__dirname, "..", "users.json");
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");

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
  app.use(bookmarkRoutes);
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  return app;
}

describe("Bookmarks API", () => {
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
    if (fs.existsSync(BOOKMARKS_FILE)) fs.unlinkSync(BOOKMARKS_FILE);
    if (server) server.close();
  });

  beforeEach(() => {
    if (fs.existsSync(BOOKMARKS_FILE)) fs.unlinkSync(BOOKMARKS_FILE);
  });

  test("POST /api/bookmarks saves bookmark", async () => {
    const res = await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        title: "Hotel Da Nang",
        url: "https://example.com/hotel",
        snippet: "Nice hotel",
        engine: "tavily",
        query: "hotel da nang",
        tags: ["đà nẵng", "khách sạn"],
      }),
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.bookmark.title).toBe("Hotel Da Nang");
    expect(data.bookmark.tags).toEqual(["đà nẵng", "khách sạn"]);
  });

  test("POST /api/bookmarks rejects missing title", async () => {
    const res = await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ url: "https://example.com", engine: "tavily" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/bookmarks rejects invalid engine", async () => {
    const res = await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "Test", url: "https://example.com", engine: "bing" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/bookmarks rejects duplicate URL", async () => {
    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "Hotel", url: "https://example.com/hotel", engine: "tavily" }),
    });
    const res = await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "Hotel 2", url: "https://example.com/hotel", engine: "google" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Đã bookmark");
  });

  test("GET /api/bookmarks returns user's bookmarks", async () => {
    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "Hotel 1", url: "https://a.com", engine: "tavily" }),
    });
    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "Hotel 2", url: "https://b.com", engine: "google" }),
    });

    const res = await fetch(`${baseUrl}/api/bookmarks`, { headers: { Cookie: adminCookie } });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.bookmarks.length).toBe(2);
    expect(data.total).toBe(2);
  });

  test("GET /api/bookmarks filters by engine", async () => {
    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "Tavily", url: "https://t.com", engine: "tavily" }),
    });
    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "Google", url: "https://g.com", engine: "google" }),
    });

    const res = await fetch(`${baseUrl}/api/bookmarks?engine=tavily`, { headers: { Cookie: adminCookie } });
    const data = await res.json();
    expect(data.bookmarks.length).toBe(1);
    expect(data.bookmarks[0].engine).toBe("tavily");
  });

  test("GET /api/bookmarks filters by tag", async () => {
    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "T1", url: "https://t1.com", engine: "tavily", tags: ["beach"] }),
    });
    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "T2", url: "https://t2.com", engine: "tavily", tags: ["mountain"] }),
    });

    const res = await fetch(`${baseUrl}/api/bookmarks?tag=beach`, { headers: { Cookie: adminCookie } });
    const data = await res.json();
    expect(data.bookmarks.length).toBe(1);
    expect(data.bookmarks[0].title).toBe("T1");
  });

  test("PUT /api/bookmarks/:id updates title and tags", async () => {
    const saveRes = await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "Old Title", url: "https://x.com", engine: "tavily" }),
    });
    const { bookmark } = await saveRes.json();

    const res = await fetch(`${baseUrl}/api/bookmarks/${bookmark.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "New Title", tags: ["updated"] }),
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.bookmark.title).toBe("New Title");
    expect(data.bookmark.tags).toEqual(["updated"]);
  });

  test("PUT /api/bookmarks/:id returns 404 for non-existent", async () => {
    const res = await fetch(`${baseUrl}/api/bookmarks/99999`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "Test" }),
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/bookmarks/:id deletes specific bookmark", async () => {
    const saveRes = await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "To Delete", url: "https://del.com", engine: "ddg" }),
    });
    const { bookmark } = await saveRes.json();

    const delRes = await fetch(`${baseUrl}/api/bookmarks/${bookmark.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(delRes.status).toBe(200);

    const getRes = await fetch(`${baseUrl}/api/bookmarks`, { headers: { Cookie: adminCookie } });
    const data = await getRes.json();
    expect(data.bookmarks.length).toBe(0);
  });

  test("DELETE /api/bookmarks/:id returns 404 for non-existent", async () => {
    const res = await fetch(`${baseUrl}/api/bookmarks/99999`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/bookmarks clears all user bookmarks", async () => {
    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "B1", url: "https://b1.com", engine: "tavily" }),
    });
    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "B2", url: "https://b2.com", engine: "google" }),
    });

    const delRes = await fetch(`${baseUrl}/api/bookmarks`, { method: "DELETE", headers: { Cookie: adminCookie } });
    expect(delRes.status).toBe(200);

    const getRes = await fetch(`${baseUrl}/api/bookmarks`, { headers: { Cookie: adminCookie } });
    const data = await getRes.json();
    expect(data.bookmarks.length).toBe(0);
  });

  test("Users only see their own bookmarks", async () => {
    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "Admin Book", url: "https://admin.com", engine: "tavily" }),
    });

    const res = await fetch(`${baseUrl}/api/bookmarks`, { headers: { Cookie: userCookie } });
    const data = await res.json();
    expect(data.bookmarks.length).toBe(0);
  });

  test("GET /api/bookmarks requires auth", async () => {
    const res = await fetch(`${baseUrl}/api/bookmarks`);
    expect(res.status).toBe(401);
  });

  test("GET /api/bookmarks/tags returns unique tags", async () => {
    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "T1", url: "https://t1.com", engine: "tavily", tags: ["beach", "luxury"] }),
    });
    await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ title: "T2", url: "https://t2.com", engine: "tavily", tags: ["beach", "budget"] }),
    });

    const res = await fetch(`${baseUrl}/api/bookmarks/tags`, { headers: { Cookie: adminCookie } });
    const data = await res.json();
    expect(data.tags).toEqual(["beach", "budget", "luxury"]);
  });

  test("Sanitizes XSS in title and snippet", async () => {
    const res = await fetch(`${baseUrl}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        title: "<script>alert(1)</script>",
        url: "https://xss.com",
        snippet: "<img onerror=alert(1)>",
        engine: "tavily",
      }),
    });
    const data = await res.json();
    expect(data.bookmark.title).not.toContain("<");
    expect(data.bookmark.snippet).not.toContain("<");
  });

  test("POST /api/bookmarks/import-html imports browser bookmarks", async () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
  <DT><A HREF="https://hotel-da-nang.com" ADD_DATE="1700000000">Hotel Da Nang</A>
  <DT><A HREF="https://resort-phu-quoc.com" ADD_DATE="1700100000">Resort Phu Quoc</A>
  <DT><A HREF="https://hostel-hanoi.com" ADD_DATE="1700200000">Hostel Hanoi</A>
</DL><p>`;

    const res = await fetch(`${baseUrl}/api/bookmarks/import-html`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ html }),
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.imported).toBe(3);
    expect(data.skipped).toBe(0);
    expect(data.total).toBe(3);
  });

  test("POST /api/bookmarks/import-html skips duplicates", async () => {
    // First import
    const html1 = `<DL><p>
      <DT><A HREF="https://existing.com">Existing</A>
    </DL><p>`;
    await fetch(`${baseUrl}/api/bookmarks/import-html`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ html: html1 }),
    });

    // Second import with same URL + new URL
    const html2 = `<DL><p>
      <DT><A HREF="https://existing.com">Existing Duplicate</A>
      <DT><A HREF="https://new.com">New Bookmark</A>
    </DL><p>`;
    const res = await fetch(`${baseUrl}/api/bookmarks/import-html`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ html: html2 }),
    });
    const data = await res.json();
    expect(data.imported).toBe(1);
    expect(data.skipped).toBe(1);
  });

  test("POST /api/bookmarks/import-html handles nested folders", async () => {
    const html = `<DL><p>
      <DT><H3>Travel</H3>
      <DL><p>
        <DT><A HREF="https://travel-site.com">Travel Site</A>
      </DL><p>
      <DT><H3>Hotels</H3>
      <DL><p>
        <DT><A HREF="https://hotel-site.com">Hotel Site</A>
      </DL><p>
    </DL><p>`;

    const res = await fetch(`${baseUrl}/api/bookmarks/import-html`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ html }),
    });
    const data = await res.json();
    expect(data.imported).toBe(2);
  });

  test("POST /api/bookmarks/import-html skips javascript: and place: URLs", async () => {
    const html = `<DL><p>
      <DT><A HREF="javascript:void(0)">JS Link</A>
      <DT><A HREF="place:type=6&sort=14">Place Link</A>
      <DT><A HREF="https://valid.com">Valid</A>
    </DL><p>`;

    const res = await fetch(`${baseUrl}/api/bookmarks/import-html`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ html }),
    });
    const data = await res.json();
    expect(data.imported).toBe(1);
  });

  test("POST /api/bookmarks/import-html requires html field", async () => {
    const res = await fetch(`${baseUrl}/api/bookmarks/import-html`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/bookmarks/import-html requires auth", async () => {
    const res = await fetch(`${baseUrl}/api/bookmarks/import-html`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: "<DL></DL>" }),
    });
    expect(res.status).toBe(401);
  });
});
