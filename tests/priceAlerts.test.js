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
const DATA_FILE = path.join(__dirname, "..", "price_alerts.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: priceAlertRoutes } = await import("../routes/priceAlerts.js");

function httpRequest(urlStr, options = {}) {
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
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false, cookie: { httpOnly: true, maxAge: 86400000 } }));

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

  app.use(priceAlertRoutes);
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

describe("Price Alerts", () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE)) originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify([{
      id: 1, username: "admin", password: await bcrypt.hash("admin123", 10),
      displayName: "Admin", role: "admin", features: ["tavily"], createdAt: new Date().toISOString(),
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

  beforeEach(() => {
    try { fs.unlinkSync(DATA_FILE); } catch {}
  });

  test("GET /api/price-alerts requires auth", async () => {
    const res = await httpRequest(`${baseUrl}/api/price-alerts`);
    expect(res.status).toBe(401);
  });

  test("GET /api/price-alerts returns empty array initially", async () => {
    const res = await httpRequest(`${baseUrl}/api/price-alerts`, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("POST /api/price-alerts creates an alert", async () => {
    const res = await httpRequest(`${baseUrl}/api/price-alerts`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ hotelName: "Test Hotel", targetPrice: 100, direction: "below" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.hotelName).toBe("Test Hotel");
    expect(data.targetPrice).toBe(100);
    expect(data.direction).toBe("below");
    expect(data.status).toBe("active");
    expect(data.id).toBeDefined();
  });

  test("POST /api/price-alerts validates required fields", async () => {
    const res = await httpRequest(`${baseUrl}/api/price-alerts`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ hotelName: "Test" }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /api/price-alerts/:id updates an alert", async () => {
    const create = await httpRequest(`${baseUrl}/api/price-alerts`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ hotelName: "Hotel", targetPrice: 100 }),
    });
    const { id } = await create.json();

    const res = await httpRequest(`${baseUrl}/api/price-alerts/${id}`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ targetPrice: 150, status: "paused" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.targetPrice).toBe(150);
    expect(data.status).toBe("paused");
  });

  test("DELETE /api/price-alerts/:id removes an alert", async () => {
    const create = await httpRequest(`${baseUrl}/api/price-alerts`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ hotelName: "Hotel", targetPrice: 100 }),
    });
    const { id } = await create.json();

    const del = await httpRequest(`${baseUrl}/api/price-alerts/${id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(del.status).toBe(200);

    const list = await httpRequest(`${baseUrl}/api/price-alerts`, { headers: { cookie: adminCookie } });
    const data = await list.json();
    expect(data).toHaveLength(0);
  });

  test("POST /api/price-alerts/:id/check triggers alert when price is below target", async () => {
    const create = await httpRequest(`${baseUrl}/api/price-alerts`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ hotelName: "Hotel", targetPrice: 100, direction: "below" }),
    });
    const { id } = await create.json();

    const res = await httpRequest(`${baseUrl}/api/price-alerts/${id}/check`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ currentPrice: 80 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.triggered).toBe(true);
    expect(data.alert.status).toBe("triggered");
    expect(data.alert.lastCheckedPrice).toBe(80);
    expect(data.alert.priceHistory).toHaveLength(1);
  });

  test("POST /api/price-alerts/:id/check does not trigger when price is above target", async () => {
    const create = await httpRequest(`${baseUrl}/api/price-alerts`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ hotelName: "Hotel", targetPrice: 100, direction: "below" }),
    });
    const { id } = await create.json();

    const res = await httpRequest(`${baseUrl}/api/price-alerts/${id}/check`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ currentPrice: 120 }),
    });
    const data = await res.json();
    expect(data.triggered).toBe(false);
    expect(data.alert.status).toBe("active");
  });

  test("GET /api/price-alerts/:id/history returns price history", async () => {
    const create = await httpRequest(`${baseUrl}/api/price-alerts`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ hotelName: "Hotel", targetPrice: 100 }),
    });
    const { id } = await create.json();

    await httpRequest(`${baseUrl}/api/price-alerts/${id}/check`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ currentPrice: 95 }),
    });
    await httpRequest(`${baseUrl}/api/price-alerts/${id}/check`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ currentPrice: 88 }),
    });

    const res = await httpRequest(`${baseUrl}/api/price-alerts/${id}/history`, { headers: { cookie: adminCookie } });
    const data = await res.json();
    expect(data.history).toHaveLength(2);
    expect(data.history[0].price).toBe(95);
    expect(data.history[1].price).toBe(88);
  });

  test("GET /api/price-alerts/stats returns counts", async () => {
    await httpRequest(`${baseUrl}/api/price-alerts`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ hotelName: "H1", targetPrice: 100 }),
    });
    await httpRequest(`${baseUrl}/api/price-alerts`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ hotelName: "H2", targetPrice: 200 }),
    });

    const res = await httpRequest(`${baseUrl}/api/price-alerts/stats`, { headers: { cookie: adminCookie } });
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.active).toBe(2);
    expect(data.triggered).toBe(0);
  });
});
