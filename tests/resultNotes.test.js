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
const DATA_FILE = path.join(__dirname, "..", "result_notes.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: resultNoteRoutes } = await import("../routes/resultNotes.js");

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
        res.on("data", (c) => {
          body += c;
        });
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
  app.use(
    session({
      secret: "test",
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, maxAge: 86400000 },
    })
  );
  app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
    const user = users.find((u) => u.username === username);
    if (user && (await bcrypt.compare(password, user.password))) {
      req.session.isAuthenticated = true;
      req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.displayName,
        features: user.features || [],
      };
      res.json({ success: true });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });
  app.use(resultNoteRoutes);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

async function loginAs(username, password) {
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}/login`);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => resolve(res.headers["set-cookie"]));
      }
    );
    req.write(JSON.stringify({ username, password }));
    req.end();
  });
}

describe("Result Notes", () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE))
      originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");
    fs.writeFileSync(
      TEST_USERS_FILE,
      JSON.stringify(
        [
          {
            id: 1,
            username: "admin",
            password: await bcrypt.hash("admin123", 10),
            displayName: "Admin",
            role: "admin",
            features: [],
            createdAt: new Date().toISOString(),
          },
        ],
        null,
        2
      )
    );
    const app = createTestApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
    adminCookie = await loginAs("admin", "admin123");
  });

  afterAll(() => {
    server?.close();
    if (originalUsers !== undefined) fs.writeFileSync(TEST_USERS_FILE, originalUsers);
    try {
      fs.unlinkSync(DATA_FILE);
    } catch {}
  });

  beforeEach(() => {
    try {
      fs.unlinkSync(DATA_FILE);
    } catch {}
  });

  test("POST /api/result-notes requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/result-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/result-notes creates a note", async () => {
    const res = await makeRequest(`${baseUrl}/api/result-notes`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/hotel",
        title: "Hotel ABC",
        note: "Great hotel, good price",
        rating: 4,
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.url).toBe("https://example.com/hotel");
    expect(data.note).toBe("Great hotel, good price");
    expect(data.rating).toBe(4);
  });

  test("POST /api/result-notes rejects missing url", async () => {
    const res = await makeRequest(`${baseUrl}/api/result-notes`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ note: "test" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/result-notes updates existing note for same URL", async () => {
    await makeRequest(`${baseUrl}/api/result-notes`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", note: "Original" }),
    });
    const res = await makeRequest(`${baseUrl}/api/result-notes`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", note: "Updated" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.note).toBe("Updated");
  });

  test("GET /api/result-notes returns paginated notes", async () => {
    for (let i = 0; i < 3; i++) {
      await makeRequest(`${baseUrl}/api/result-notes`, {
        method: "POST",
        headers: { cookie: adminCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ url: `https://example.com/${i}`, note: `Note ${i}` }),
      });
    }

    const res = await makeRequest(`${baseUrl}/api/result-notes?page=1&limit=2`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.items.length).toBe(2);
    expect(data.total).toBe(3);
    expect(data.hasMore).toBe(true);
  });

  test("GET /api/result-notes/by-url returns note for URL", async () => {
    await makeRequest(`${baseUrl}/api/result-notes`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://noted.com", note: "My note", rating: 5 }),
    });

    const res = await makeRequest(
      `${baseUrl}/api/result-notes/by-url?url=${encodeURIComponent("https://noted.com")}`,
      { headers: { cookie: adminCookie } }
    );
    const data = await res.json();
    expect(data.note).toBe("My note");
    expect(data.rating).toBe(5);
  });

  test("GET /api/result-notes/by-url returns null for un-noted URL", async () => {
    const res = await makeRequest(
      `${baseUrl}/api/result-notes/by-url?url=${encodeURIComponent("https://none.com")}`,
      { headers: { cookie: adminCookie } }
    );
    const data = await res.json();
    expect(data).toBeNull();
  });

  test("DELETE /api/result-notes/:id deletes a note", async () => {
    const create = await makeRequest(`${baseUrl}/api/result-notes`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://delete.com", note: "To delete" }),
    });
    const { id } = await create.json();

    const res = await makeRequest(`${baseUrl}/api/result-notes/${id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
  });

  test("DELETE /api/result-notes/:id returns 404 for nonexistent", async () => {
    const res = await makeRequest(`${baseUrl}/api/result-notes/nonexistent`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("GET /api/result-notes/stats returns stats", async () => {
    await makeRequest(`${baseUrl}/api/result-notes`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://a.com", note: "A", rating: 4 }),
    });
    await makeRequest(`${baseUrl}/api/result-notes`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://b.com", note: "B", rating: 2 }),
    });

    const res = await makeRequest(`${baseUrl}/api/result-notes/stats`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.withRating).toBe(2);
    expect(data.avgRating).toBe(3);
  });
});
