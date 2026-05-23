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
const FILTERS_FILE = path.join(__dirname, "..", "saved_filters.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: filterRoutes } = await import("../routes/filters.js");

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
  app.use(filterRoutes);
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
  try { fs.unlinkSync(FILTERS_FILE); } catch {}
  server.close(done);
});

beforeEach(() => {
  if (fs.existsSync(FILTERS_FILE)) fs.unlinkSync(FILTERS_FILE);
});

describe("Saved Filter Presets", () => {
  test("GET /api/filters/saved returns empty when no presets", async () => {
    const res = await makeRequest(`${baseUrl}/api/filters/saved`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toHaveLength(0);
  });

  test("GET /api/filters/saved requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/filters/saved`);
    expect(res.status).toBe(401);
  });

  test("POST /api/filters/saved creates a preset", async () => {
    const res = await makeRequest(`${baseUrl}/api/filters/saved`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "High Match", filters: { minPercentage: 80 } },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.filter.name).toBe("High Match");
    expect(data.filter.filters.minPercentage).toBe(80);
  });

  test("POST /api/filters/saved rejects missing name", async () => {
    const res = await makeRequest(`${baseUrl}/api/filters/saved`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { filters: { minPercentage: 80 } },
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/filters/saved sanitizes name", async () => {
    const res = await makeRequest(`${baseUrl}/api/filters/saved`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "<script>alert(1)</script>", filters: {} },
    });
    const data = await res.json();
    expect(data.filter.name).not.toContain("<");
    expect(data.filter.name).not.toContain(">");
  });

  test("GET /api/filters/saved returns created presets", async () => {
    await makeRequest(`${baseUrl}/api/filters/saved`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "Filter A", filters: {} },
    });
    await makeRequest(`${baseUrl}/api/filters/saved`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "Filter B", filters: {} },
    });

    const res = await makeRequest(`${baseUrl}/api/filters/saved`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data.map(f => f.name)).toContain("Filter A");
    expect(data.map(f => f.name)).toContain("Filter B");
  });

  test("PUT /api/filters/saved/:id updates a preset", async () => {
    const createRes = await makeRequest(`${baseUrl}/api/filters/saved`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "Old Name", filters: { minPercentage: 50 } },
    });
    const created = await createRes.json();

    const res = await makeRequest(`${baseUrl}/api/filters/saved/${created.filter.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "New Name", filters: { minPercentage: 90 } },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.filter.name).toBe("New Name");
    expect(data.filter.filters.minPercentage).toBe(90);
  });

  test("PUT /api/filters/saved/:id returns 404 for nonexistent", async () => {
    const res = await makeRequest(`${baseUrl}/api/filters/saved/99999`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "New" },
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/filters/saved/:id deletes a preset", async () => {
    const createRes = await makeRequest(`${baseUrl}/api/filters/saved`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { name: "To Delete", filters: {} },
    });
    const created = await createRes.json();

    const delRes = await makeRequest(`${baseUrl}/api/filters/saved/${created.filter.id}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(delRes.status).toBe(200);

    const listRes = await makeRequest(`${baseUrl}/api/filters/saved`, {
      headers: { Cookie: adminCookie },
    });
    const data = await listRes.json();
    expect(data).toHaveLength(0);
  });

  test("DELETE /api/filters/saved/:id returns 404 for nonexistent", async () => {
    const res = await makeRequest(`${baseUrl}/api/filters/saved/99999`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("Saved filters respect 20-item cap", async () => {
    for (let i = 0; i < 22; i++) {
      await makeRequest(`${baseUrl}/api/filters/saved`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: { name: `Filter ${i}`, filters: {} },
      });
    }

    const res = await makeRequest(`${baseUrl}/api/filters/saved`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data).toHaveLength(20);
  });
});
