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
const SNAPSHOTS_FILE = path.join(__dirname, "..", "search_snapshots.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: snapshotRoutes } = await import("../routes/snapshots.js");

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
  app.use(snapshotRoutes);
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
  try { fs.unlinkSync(SNAPSHOTS_FILE); } catch {}
  server.close(done);
});

beforeEach(() => {
  if (fs.existsSync(SNAPSHOTS_FILE)) fs.unlinkSync(SNAPSHOTS_FILE);
});

const sampleResults = [
  { title: "Hotel A", url: "https://a.com", snippet: "Nice hotel", price: "$100", rating: 4.5 },
  { title: "Hotel B", url: "https://b.com", snippet: "Great hotel", price: "$200", rating: 4.0 },
];

describe("Search Snapshots API", () => {
  test("POST /api/snapshots saves a snapshot", async () => {
    const res = await makeRequest(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "Test Snapshot", query: "hotel hanoi", engine: "tavily", results: sampleResults },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.snapshot.name).toBe("Test Snapshot");
    expect(data.snapshot.resultCount).toBe(2);
  });

  test("POST /api/snapshots requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { query: "test", engine: "tavily", results: [] },
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/snapshots validates required fields", async () => {
    const res1 = await makeRequest(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { engine: "tavily", results: [] },
    });
    expect(res1.status).toBe(400);

    const res2 = await makeRequest(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { query: "test", engine: "invalid", results: [] },
    });
    expect(res2.status).toBe(400);

    const res3 = await makeRequest(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { query: "test", engine: "tavily" },
    });
    expect(res3.status).toBe(400);
  });

  test("GET /api/snapshots lists snapshots", async () => {
    // Create two snapshots
    await makeRequest(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "First", query: "hotel", engine: "tavily", results: sampleResults },
    });
    await makeRequest(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "Second", query: "resort", engine: "google", results: [] },
    });

    const res = await makeRequest(`${baseUrl}/api/snapshots`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(2);
    expect(data.snapshots).toHaveLength(2);
    expect(data.snapshots[0].name).toBe("Second"); // newest first
    expect(data.snapshots[1].name).toBe("First");
  });

  test("GET /api/snapshots requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/snapshots`);
    expect(res.status).toBe(401);
  });

  test("GET /api/snapshots/:id returns full snapshot", async () => {
    const createRes = await makeRequest(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "Detail Test", query: "hotel", engine: "tavily", results: sampleResults },
    });
    const { snapshot: created } = await createRes.json();

    const res = await makeRequest(`${baseUrl}/api/snapshots/${created.id}`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.snapshot.name).toBe("Detail Test");
    expect(data.snapshot.results).toHaveLength(2);
    expect(data.snapshot.results[0].title).toBe("Hotel A");
  });

  test("GET /api/snapshots/:id returns 404 for missing", async () => {
    const res = await makeRequest(`${baseUrl}/api/snapshots/999`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/snapshots/:id deletes snapshot", async () => {
    const createRes = await makeRequest(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "To Delete", query: "hotel", engine: "tavily", results: [] },
    });
    const { snapshot: created } = await createRes.json();

    const delRes = await makeRequest(`${baseUrl}/api/snapshots/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(delRes.status).toBe(200);

    const getRes = await makeRequest(`${baseUrl}/api/snapshots/${created.id}`, {
      headers: { Cookie: adminCookie },
    });
    expect(getRes.status).toBe(404);
  });

  test("DELETE /api/snapshots/:id returns 404 for missing", async () => {
    const res = await makeRequest(`${baseUrl}/api/snapshots/999`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("POST /api/snapshots/compare compares two snapshots", async () => {
    const r1 = await makeRequest(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: {
        name: "Old", query: "hotel", engine: "tavily",
        results: [
          { title: "Hotel A", url: "https://a.com" },
          { title: "Hotel B", url: "https://b.com" },
          { title: "Hotel C", url: "https://c.com" },
        ],
      },
    });
    const { snapshot: s1 } = await r1.json();

    const r2 = await makeRequest(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: {
        name: "New", query: "hotel", engine: "tavily",
        results: [
          { title: "Hotel B", url: "https://b.com" },
          { title: "Hotel C", url: "https://c.com" },
          { title: "Hotel D", url: "https://d.com" },
        ],
      },
    });
    const { snapshot: s2 } = await r2.json();

    const res = await makeRequest(`${baseUrl}/api/snapshots/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { snapshotId1: s1.id, snapshotId2: s2.id },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.diff.addedCount).toBe(1); // Hotel D
    expect(data.diff.removedCount).toBe(1); // Hotel A
    expect(data.diff.keptCount).toBe(2); // Hotel B, C
    expect(data.diff.added[0].url).toBe("https://d.com");
    expect(data.diff.removed[0].url).toBe("https://a.com");
  });

  test("POST /api/snapshots/compare validates required fields", async () => {
    const res = await makeRequest(`${baseUrl}/api/snapshots/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { snapshotId1: 1 },
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/snapshots/compare returns 404 for missing snapshot", async () => {
    const res = await makeRequest(`${baseUrl}/api/snapshots/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { snapshotId1: 1, snapshotId2: 999 },
    });
    expect(res.status).toBe(404);
  });

  test("POST /api/snapshots limits results to 50", async () => {
    const manyResults = Array.from({ length: 60 }, (_, i) => ({
      title: `Hotel ${i}`, url: `https://hotel${i}.com`,
    }));

    const res = await makeRequest(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { query: "hotel", engine: "tavily", results: manyResults },
    });
    const { snapshot: created } = await res.json();
    expect(created.resultCount).toBe(50);
  });

  test("POST /api/snapshots defaults name from query", async () => {
    const res = await makeRequest(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { query: "beach resort", engine: "google", results: [] },
    });
    const data = await res.json();
    expect(data.snapshot.name).toBe("Search: beach resort");
  });
});
