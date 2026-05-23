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
const DATA_FILE = path.join(__dirname, "..", "webhooks.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: webhookRoutes } = await import("../routes/webhooks.js");

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
  app.use(webhookRoutes);
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

describe("Webhooks", () => {
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

  test("GET /api/webhooks requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/webhooks`);
    expect(res.status).toBe(401);
  });

  test("POST /api/webhooks creates a webhook", async () => {
    const res = await makeRequest(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Hook",
        url: "https://example.com/hook",
        events: ["price_alert"],
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Test Hook");
    expect(data.url).toBe("https://example.com/hook");
    expect(data.active).toBe(true);
    expect(data.triggerCount).toBe(0);
  });

  test("POST /api/webhooks rejects missing name", async () => {
    const res = await makeRequest(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/hook" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/webhooks rejects invalid URL", async () => {
    const res = await makeRequest(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test", url: "not-a-url" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/webhooks returns user webhooks", async () => {
    await makeRequest(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "H1", url: "https://example.com/1" }),
    });
    await makeRequest(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "H2", url: "https://example.com/2" }),
    });
    const res = await makeRequest(`${baseUrl}/api/webhooks`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data).toHaveLength(2);
  });

  test("PUT /api/webhooks/:id updates a webhook", async () => {
    const create = await makeRequest(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Old", url: "https://example.com/old" }),
    });
    const { id } = await create.json();
    const res = await makeRequest(`${baseUrl}/api/webhooks/${id}`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New", active: false }),
    });
    const data = await res.json();
    expect(data.name).toBe("New");
    expect(data.active).toBe(false);
  });

  test("PUT /api/webhooks/:id rejects invalid URL", async () => {
    const create = await makeRequest(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "H", url: "https://example.com" }),
    });
    const { id } = await create.json();
    const res = await makeRequest(`${baseUrl}/api/webhooks/${id}`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "bad-url" }),
    });
    expect(res.status).toBe(400);
  });

  test("DELETE /api/webhooks/:id deletes a webhook", async () => {
    const create = await makeRequest(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "H", url: "https://example.com" }),
    });
    const { id } = await create.json();
    const res = await makeRequest(`${baseUrl}/api/webhooks/${id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const list = await makeRequest(`${baseUrl}/api/webhooks`, {
      headers: { cookie: adminCookie },
    });
    const data = await list.json();
    expect(data).toHaveLength(0);
  });

  test("POST /api/webhooks/:id/test sends test payload", async () => {
    // Mock global.fetch for the test endpoint
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200 });

    const create = await makeRequest(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "H", url: "https://example.com/hook" }),
    });
    const { id } = await create.json();
    const res = await makeRequest(`${baseUrl}/api/webhooks/${id}/test`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe(200);

    globalThis.fetch = originalFetch;
  });

  test("POST /api/webhooks/:id/test handles fetch failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Network error");
    };

    const create = await makeRequest(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "H", url: "https://example.com/hook" }),
    });
    const { id } = await create.json();
    const res = await makeRequest(`${baseUrl}/api/webhooks/${id}/test`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Network error");

    globalThis.fetch = originalFetch;
  });

  test("GET /api/webhooks/stats returns stats", async () => {
    await makeRequest(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "H1", url: "https://example.com/1" }),
    });
    await makeRequest(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "H2", url: "https://example.com/2", active: false }),
    });
    const res = await makeRequest(`${baseUrl}/api/webhooks/stats`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.active).toBe(1);
  });

  test("PUT /api/webhooks/:id returns 404 for nonexistent", async () => {
    const res = await makeRequest(`${baseUrl}/api/webhooks/nonexistent`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X" }),
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/webhooks/:id returns 404 for nonexistent", async () => {
    const res = await makeRequest(`${baseUrl}/api/webhooks/nonexistent`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });
});
