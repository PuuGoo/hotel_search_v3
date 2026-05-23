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
const DATA_FILES = {
  templates: path.join(__dirname, "..", "search_templates.json"),
  alerts: path.join(__dirname, "..", "price_alerts.json"),
  webhooks: path.join(__dirname, "..", "webhooks.json"),
  scheduled: path.join(__dirname, "..", "scheduled_searches.json"),
};

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: bulkDataRoutes } = await import("../routes/bulkData.js");

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
  app.use(bulkDataRoutes);
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

describe("Bulk Data", () => {
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
    for (const f of Object.values(DATA_FILES)) {
      try {
        fs.unlinkSync(f);
      } catch {}
    }
  });

  beforeEach(() => {
    for (const f of Object.values(DATA_FILES)) {
      try {
        fs.unlinkSync(f);
      } catch {}
    }
  });

  test("GET /api/bulk/export requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/bulk/export`);
    expect(res.status).toBe(401);
  });

  test("GET /api/bulk/export exports user data", async () => {
    // Add some test data
    fs.writeFileSync(
      DATA_FILES.templates,
      JSON.stringify([
        { id: "1", userId: 1, name: "My Template" },
        { id: "2", userId: 2, name: "Other Template" },
      ])
    );

    const res = await makeRequest(`${baseUrl}/api/bulk/export?types=templates`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.version).toBe(1);
    expect(data.data.templates).toHaveLength(1);
    expect(data.data.templates[0].name).toBe("My Template");
  });

  test("POST /api/bulk/import imports data", async () => {
    const res = await makeRequest(`${baseUrl}/api/bulk/import`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          templates: [
            { name: "Imported Template 1" },
            { name: "Imported Template 2" },
          ],
        },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.imported.templates).toBe(2);

    // Verify data was saved
    const saved = JSON.parse(fs.readFileSync(DATA_FILES.templates, "utf8"));
    expect(saved.filter((i) => i.userId === 1)).toHaveLength(2);
  });

  test("POST /api/bulk/import with overwrite replaces data", async () => {
    // First import
    await makeRequest(`${baseUrl}/api/bulk/import`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ data: { templates: [{ name: "Original" }] } }),
    });

    // Overwrite import
    const res = await makeRequest(`${baseUrl}/api/bulk/import`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: { templates: [{ name: "Replaced" }] },
        overwrite: true,
      }),
    });
    expect(res.status).toBe(200);

    const saved = JSON.parse(fs.readFileSync(DATA_FILES.templates, "utf8"));
    const userItems = saved.filter((i) => i.userId === 1);
    expect(userItems).toHaveLength(1);
    expect(userItems[0].name).toBe("Replaced");
  });

  test("POST /api/bulk/import rejects invalid data", async () => {
    const res = await makeRequest(`${baseUrl}/api/bulk/import`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ data: "not an object" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/bulk/stats returns counts", async () => {
    fs.writeFileSync(
      DATA_FILES.templates,
      JSON.stringify([{ id: "1", userId: 1, name: "T1" }])
    );
    fs.writeFileSync(
      DATA_FILES.alerts,
      JSON.stringify([
        { id: "1", userId: 1, name: "A1" },
        { id: "2", userId: 1, name: "A2" },
      ])
    );

    const res = await makeRequest(`${baseUrl}/api/bulk/stats`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.templates).toBe(1);
    expect(data.alerts).toBe(2);
    expect(data.webhooks).toBe(0);
  });

  test("DELETE /api/bulk/:type clears user data", async () => {
    fs.writeFileSync(
      DATA_FILES.templates,
      JSON.stringify([
        { id: "1", userId: 1, name: "My Template" },
        { id: "2", userId: 2, name: "Other Template" },
      ])
    );

    const res = await makeRequest(`${baseUrl}/api/bulk/templates`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(1);

    const saved = JSON.parse(fs.readFileSync(DATA_FILES.templates, "utf8"));
    expect(saved).toHaveLength(1);
    expect(saved[0].userId).toBe(2);
  });

  test("DELETE /api/bulk/:type rejects invalid type", async () => {
    const res = await makeRequest(`${baseUrl}/api/bulk/invalid`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(400);
  });
});
