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
const DATA_FILE = path.join(__dirname, "..", "user_preferences.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: preferencesRoutes } = await import("../routes/preferences.js");

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
  app.use(preferencesRoutes);
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

describe("User Preferences", () => {
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

  test("GET /api/preferences requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/preferences`);
    expect(res.status).toBe(401);
  });

  test("GET /api/preferences returns defaults for new user", async () => {
    const res = await makeRequest(`${baseUrl}/api/preferences`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.defaultEngine).toBe("tavily");
    expect(data.resultsPerPage).toBe(20);
    expect(data.language).toBe("vi");
    expect(data.theme).toBe("dark");
  });

  test("PUT /api/preferences updates settings", async () => {
    const res = await makeRequest(`${baseUrl}/api/preferences`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ defaultEngine: "google", resultsPerPage: 50, theme: "light" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.defaultEngine).toBe("google");
    expect(data.resultsPerPage).toBe(50);
    expect(data.theme).toBe("light");
    // Unchanged defaults preserved
    expect(data.language).toBe("vi");
  });

  test("PUT /api/preferences persists across requests", async () => {
    await makeRequest(`${baseUrl}/api/preferences`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ defaultEngine: "ddg", language: "en" }),
    });

    const res = await makeRequest(`${baseUrl}/api/preferences`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.defaultEngine).toBe("ddg");
    expect(data.language).toBe("en");
  });

  test("PUT /api/preferences rejects invalid engine", async () => {
    const res = await makeRequest(`${baseUrl}/api/preferences`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ defaultEngine: "invalid" }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /api/preferences rejects invalid resultsPerPage", async () => {
    const res = await makeRequest(`${baseUrl}/api/preferences`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ resultsPerPage: 200 }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /api/preferences rejects invalid language", async () => {
    const res = await makeRequest(`${baseUrl}/api/preferences`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ language: "fr" }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /api/preferences rejects invalid theme", async () => {
    const res = await makeRequest(`${baseUrl}/api/preferences`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "blue" }),
    });
    expect(res.status).toBe(400);
  });

  test("DELETE /api/preferences resets to defaults", async () => {
    await makeRequest(`${baseUrl}/api/preferences`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ defaultEngine: "google", theme: "light" }),
    });

    const res = await makeRequest(`${baseUrl}/api/preferences`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.defaultEngine).toBe("tavily");
    expect(data.theme).toBe("dark");

    // Verify persisted
    const getRes = await makeRequest(`${baseUrl}/api/preferences`, {
      headers: { cookie: adminCookie },
    });
    const getData = await getRes.json();
    expect(getData.defaultEngine).toBe("tavily");
  });
});
