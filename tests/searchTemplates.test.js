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
const DATA_FILE = path.join(__dirname, "..", "search_templates.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: searchTemplateRoutes } = await import("../routes/searchTemplates.js");

function httpRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request({
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method: options.method || "GET",
      headers: options.headers || {},
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, json: () => Promise.resolve(JSON.parse(body)) }));
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
  app.use(session({ secret: "test", resave: false, saveUninitialized: false, cookie: { httpOnly: true, maxAge: 86400000 } }));
  app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
    const user = users.find((u) => u.username === username);
    if (user && (await bcrypt.compare(password, user.password))) {
      req.session.isAuthenticated = true;
      req.session.user = { id: user.id, username: user.username, role: user.role, displayName: user.displayName, features: user.features || [] };
      res.json({ success: true });
    } else { res.status(401).json({ error: "Invalid credentials" }); }
  });
  app.use(searchTemplateRoutes);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

async function loginAs(username, password) {
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}/login`);
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve(res.headers["set-cookie"]));
    });
    req.write(JSON.stringify({ username, password }));
    req.end();
  });
}

describe("Search Templates", () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE)) originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify([{
      id: 1, username: "admin", password: await bcrypt.hash("admin123", 10),
      displayName: "Admin", role: "admin", features: [], createdAt: new Date().toISOString(),
    }], null, 2));
    const app = createTestApp();
    await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); }); });
    adminCookie = await loginAs("admin", "admin123");
  });

  afterAll(() => {
    server?.close();
    if (originalUsers !== undefined) fs.writeFileSync(TEST_USERS_FILE, originalUsers);
    try { fs.unlinkSync(DATA_FILE); } catch {}
  });

  beforeEach(() => { try { fs.unlinkSync(DATA_FILE); } catch {} });

  test("GET /api/search-templates requires auth", async () => {
    const res = await httpRequest(`${baseUrl}/api/search-templates`);
    expect(res.status).toBe(401);
  });

  test("POST /api/search-templates creates a template", async () => {
    const res = await httpRequest(`${baseUrl}/api/search-templates`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Luxury Hotels", query: "luxury 5 star hotel", engine: "tavily", tags: ["luxury"] }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Luxury Hotels");
    expect(data.query).toBe("luxury 5 star hotel");
    expect(data.useCount).toBe(0);
  });

  test("POST /api/search-templates validates required fields", async () => {
    const res = await httpRequest(`${baseUrl}/api/search-templates`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test" }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /api/search-templates/:id updates a template", async () => {
    const create = await httpRequest(`${baseUrl}/api/search-templates`, {
      method: "POST", headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "T", query: "q" }),
    });
    const { id } = await create.json();
    const res = await httpRequest(`${baseUrl}/api/search-templates/${id}`, {
      method: "PUT", headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated", query: "new query" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated");
    expect(data.query).toBe("new query");
  });

  test("DELETE /api/search-templates/:id removes a template", async () => {
    const create = await httpRequest(`${baseUrl}/api/search-templates`, {
      method: "POST", headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "T", query: "q" }),
    });
    const { id } = await create.json();
    const del = await httpRequest(`${baseUrl}/api/search-templates/${id}`, {
      method: "DELETE", headers: { cookie: adminCookie },
    });
    expect(del.status).toBe(200);
    const list = await httpRequest(`${baseUrl}/api/search-templates`, { headers: { cookie: adminCookie } });
    const data = await list.json();
    expect(data.user).toHaveLength(0);
  });

  test("POST /api/search-templates/:id/use increments use count", async () => {
    const create = await httpRequest(`${baseUrl}/api/search-templates`, {
      method: "POST", headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "T", query: "q" }),
    });
    const { id } = await create.json();
    await httpRequest(`${baseUrl}/api/search-templates/${id}/use`, {
      method: "POST", headers: { cookie: adminCookie },
    });
    const res = await httpRequest(`${baseUrl}/api/search-templates/${id}/use`, {
      method: "POST", headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.useCount).toBe(2);
    expect(data.lastUsedAt).toBeDefined();
  });

  test("GET /api/search-templates/popular returns sorted by use count", async () => {
    // Create two templates
    const t1 = await httpRequest(`${baseUrl}/api/search-templates`, {
      method: "POST", headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Popular", query: "q1" }),
    });
    const t2 = await httpRequest(`${baseUrl}/api/search-templates`, {
      method: "POST", headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Less", query: "q2" }),
    });
    const { id: id1 } = await t1.json();
    const { id: id2 } = await t2.json();

    // Use t1 more
    await httpRequest(`${baseUrl}/api/search-templates/${id1}/use`, { method: "POST", headers: { cookie: adminCookie } });
    await httpRequest(`${baseUrl}/api/search-templates/${id1}/use`, { method: "POST", headers: { cookie: adminCookie } });
    await httpRequest(`${baseUrl}/api/search-templates/${id2}/use`, { method: "POST", headers: { cookie: adminCookie } });

    const res = await httpRequest(`${baseUrl}/api/search-templates/popular`, { headers: { cookie: adminCookie } });
    const data = await res.json();
    expect(data[0].name).toBe("Popular");
    expect(data[0].useCount).toBe(2);
  });
});
