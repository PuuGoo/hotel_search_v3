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
const DATA_FILE = path.join(__dirname, "..", "data_retention.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: dataRetentionRoutes } = await import("../routes/dataRetention.js");

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
  app.use(dataRetentionRoutes);
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

describe("Data Retention", () => {
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

  test("GET /api/data-retention requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/data-retention`);
    expect(res.status).toBe(401);
  });

  test("GET /api/data-retention returns defaults", async () => {
    const res = await makeRequest(`${baseUrl}/api/data-retention`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.historyDays).toBe(90);
    expect(data.cacheHours).toBe(1);
    expect(data.recentSearchesDays).toBe(30);
    expect(data.autoCleanup).toBe(false);
  });

  test("PUT /api/data-retention updates settings", async () => {
    const res = await makeRequest(`${baseUrl}/api/data-retention`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ historyDays: 30, cacheHours: 2, autoCleanup: true }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.historyDays).toBe(30);
    expect(data.cacheHours).toBe(2);
    expect(data.autoCleanup).toBe(true);
    // Other defaults remain
    expect(data.recentSearchesDays).toBe(30);
  });

  test("PUT /api/data-retention ignores invalid values", async () => {
    await makeRequest(`${baseUrl}/api/data-retention`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ historyDays: -5 }),
    });

    const res = await makeRequest(`${baseUrl}/api/data-retention`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.historyDays).toBe(90); // default, -5 rejected
  });

  test("PUT /api/data-retention ignores unknown keys", async () => {
    const res = await makeRequest(`${baseUrl}/api/data-retention`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ historyDays: 60, unknownKey: "test" }),
    });
    const data = await res.json();
    expect(data.historyDays).toBe(60);
    expect(data.unknownKey).toBeUndefined();
  });

  test("DELETE /api/data-retention resets to defaults", async () => {
    // Change settings
    await makeRequest(`${baseUrl}/api/data-retention`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ historyDays: 30, cacheHours: 5 }),
    });

    // Reset
    const res = await makeRequest(`${baseUrl}/api/data-retention`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.historyDays).toBe(90);
    expect(data.cacheHours).toBe(1);
  });

  test("GET /api/data-retention/preview returns cleanup preview", async () => {
    const res = await makeRequest(`${baseUrl}/api/data-retention/preview`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("settings");
    expect(data).toHaveProperty("wouldClean");
  });

  test("POST /api/data-retention/cleanup runs cleanup", async () => {
    const res = await makeRequest(`${baseUrl}/api/data-retention/cleanup`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data).toHaveProperty("totalCleaned");
    expect(data).toHaveProperty("details");
  });

  test("PUT /api/data-retention persists across requests", async () => {
    await makeRequest(`${baseUrl}/api/data-retention`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ historyDays: 45, analyticsDays: 60 }),
    });

    const res = await makeRequest(`${baseUrl}/api/data-retention`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.historyDays).toBe(45);
    expect(data.analyticsDays).toBe(60);
  });
});
