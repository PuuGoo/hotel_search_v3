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
const ALERTS_FILE = path.join(__dirname, "..", "price_alerts.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: priceAlertRoutes } = await import("../routes/priceAlerts.js");

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
  app.use(priceAlertRoutes);
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
  try { fs.unlinkSync(ALERTS_FILE); } catch {}
  server.close(done);
});

beforeEach(() => {
  if (fs.existsSync(ALERTS_FILE)) fs.unlinkSync(ALERTS_FILE);
});

describe("Price History API", () => {
  test("GET /api/price-alerts/history returns empty when no alerts", async () => {
    const res = await makeRequest(`${baseUrl}/api/price-alerts/history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(0);
    expect(data.alerts).toHaveLength(0);
  });

  test("GET /api/price-alerts/history requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/price-alerts/history`);
    expect(res.status).toBe(401);
  });

  test("GET /api/price-alerts/history returns alerts with price history", async () => {
    // Create an alert
    const createRes = await makeRequest(`${baseUrl}/api/price-alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { hotelName: "Test Hotel", targetPrice: 100, direction: "below" },
    });
    const alert = await createRes.json();

    // Add price checks
    await makeRequest(`${baseUrl}/api/price-alerts/${alert.id}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { currentPrice: 150 },
    });
    await makeRequest(`${baseUrl}/api/price-alerts/${alert.id}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { currentPrice: 120 },
    });
    await makeRequest(`${baseUrl}/api/price-alerts/${alert.id}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { currentPrice: 90 },
    });

    const res = await makeRequest(`${baseUrl}/api/price-alerts/history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(1);
    expect(data.alerts[0].hotelName).toBe("Test Hotel");
    expect(data.alerts[0].history).toHaveLength(3);
    expect(data.alerts[0].minPrice).toBe(90);
    expect(data.alerts[0].maxPrice).toBe(150);
    expect(data.alerts[0].avgPrice).toBe(120);
    expect(data.alerts[0].currentPrice).toBe(90);
    expect(data.alerts[0].targetPrice).toBe(100);
  });

  test("GET /api/price-alerts/history excludes alerts without history", async () => {
    // Create alert with no checks
    await makeRequest(`${baseUrl}/api/price-alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { hotelName: "No History Hotel", targetPrice: 100, direction: "below" },
    });

    const res = await makeRequest(`${baseUrl}/api/price-alerts/history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.total).toBe(0);
  });

  test("GET /api/price-alerts/history includes status and direction", async () => {
    const createRes = await makeRequest(`${baseUrl}/api/price-alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { hotelName: "Above Hotel", targetPrice: 200, direction: "above" },
    });
    const alert = await createRes.json();

    await makeRequest(`${baseUrl}/api/price-alerts/${alert.id}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { currentPrice: 250 },
    });

    const res = await makeRequest(`${baseUrl}/api/price-alerts/history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.alerts[0].direction).toBe("above");
    expect(data.alerts[0].status).toBe("triggered");
  });

  test("GET /api/price-alerts/history returns multiple alerts", async () => {
    // Create two alerts with history
    const r1 = await makeRequest(`${baseUrl}/api/price-alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { hotelName: "Hotel A", targetPrice: 100, direction: "below" },
    });
    const a1 = await r1.json();

    const r2 = await makeRequest(`${baseUrl}/api/price-alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { hotelName: "Hotel B", targetPrice: 200, direction: "above" },
    });
    const a2 = await r2.json();

    await makeRequest(`${baseUrl}/api/price-alerts/${a1.id}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { currentPrice: 80 },
    });
    await makeRequest(`${baseUrl}/api/price-alerts/${a2.id}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: { currentPrice: 250 },
    });

    const res = await makeRequest(`${baseUrl}/api/price-alerts/history`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.alerts.map(a => a.hotelName)).toContain("Hotel A");
    expect(data.alerts.map(a => a.hotelName)).toContain("Hotel B");
  });
});
