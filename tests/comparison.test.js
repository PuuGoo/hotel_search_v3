import { describe, test, expect, beforeAll, afterAll, jest } from "@jest/globals";
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

let originalUsers;
let adminCookie;
let server;
let baseUrl;

// Mock @tavily/core
const mockTavilySearch = jest.fn();
jest.unstable_mockModule("@tavily/core", () => ({
  tavily: jest.fn(() => ({ search: mockTavilySearch })),
}));

// Mock axios
jest.unstable_mockModule("axios", () => ({
  default: { get: jest.fn() },
}));

// Mock child_process
jest.unstable_mockModule("child_process", () => ({
  spawn: jest.fn(() => ({
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn(),
    kill: jest.fn(),
  })),
}));

process.env.TAVILY_API_KEY_1 = "test-tavily-key-1";
process.env.GO_API_KEY_1 = "test-google-key-1";

await import("@tavily/core");
await import("axios");
const { default: comparisonRoutes } = await import("../routes/comparison.js");

// Helper: make HTTP request using http module (not affected by global.fetch mock)
function httpRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const reqOpts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || "GET",
      headers: options.headers || {},
    };
    const req = http.request(reqOpts, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          json: () => Promise.resolve(JSON.parse(body)),
          text: () => Promise.resolve(body),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
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

  app.use(comparisonRoutes);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

async function loginAs(username, password) {
  const res = await httpRequest(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  // Need to POST body manually
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}/login`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve(res.headers["set-cookie"]));
    });
    req.write(JSON.stringify({ username, password }));
    req.end();
  });
}

describe("Comparison Feature", () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE)) {
      originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");
    }

    const testUsers = [
      {
        id: 1,
        username: "admin",
        password: await bcrypt.hash("admin123", 10),
        displayName: "Admin",
        role: "admin",
        features: ["tavily", "ddg", "case12"],
        createdAt: new Date().toISOString(),
      },
    ];
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(testUsers, null, 2));

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
    if (originalUsers !== undefined) {
      fs.writeFileSync(TEST_USERS_FILE, originalUsers);
    }
  });

  test("GET /api/compare requires authentication", async () => {
    const res = await httpRequest(`${baseUrl}/api/compare?q=test`);
    expect(res.status).toBe(401);
  });

  test("GET /api/compare requires query parameter", async () => {
    const res = await httpRequest(`${baseUrl}/api/compare`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  test("GET /api/compare returns normalized result structure", async () => {
    // Mock global fetch for route's internal calls only
    const realFetch = globalThis.fetch;
    let fetchCallCount = 0;
    globalThis.fetch = jest.fn((url, opts) => {
      fetchCallCount++;
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/searchApiTavily")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            results: [
              { title: "Hotel Test", url: "https://example.com", content: "A test hotel", score: 0.95 },
            ],
          }),
        });
      }
      if (urlStr.includes("/searchApiGo")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            items: [
              { title: "Google Hotel", link: "https://google.com/hotel", snippet: "Google result" },
            ],
          }),
        });
      }
      if (urlStr.includes("/searchApiDDG")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            results: [
              { title: "DDG Hotel", url: "https://ddg.com/hotel", content: "DDG result", match_percentage: 85 },
            ],
          }),
        });
      }
      return realFetch(url, opts);
    });

    const res = await httpRequest(`${baseUrl}/api/compare?q=hotel+test&engines=tavily,google,ddg`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.query).toBe("hotel test");
    expect(data.engines).toBe(3);

    // Verify Tavily normalization
    expect(data.results.tavily).toBeDefined();
    expect(data.results.tavily.total).toBe(1);
    expect(data.results.tavily.items[0]).toHaveProperty("title", "Hotel Test");
    expect(data.results.tavily.items[0]).toHaveProperty("url", "https://example.com");
    expect(data.results.tavily.items[0]).toHaveProperty("snippet", "A test hotel");
    expect(data.results.tavily.items[0]).toHaveProperty("score", 0.95);

    // Verify Google normalization
    expect(data.results.google).toBeDefined();
    expect(data.results.google.total).toBe(1);
    expect(data.results.google.items[0]).toHaveProperty("title", "Google Hotel");
    expect(data.results.google.items[0]).toHaveProperty("url", "https://google.com/hotel");

    // Verify DDG normalization
    expect(data.results.ddg).toBeDefined();
    expect(data.results.ddg.total).toBe(1);
    expect(data.results.ddg.items[0]).toHaveProperty("title", "DDG Hotel");
    expect(data.results.ddg.items[0]).toHaveProperty("score", 85);

    expect(fetchCallCount).toBe(3);
    globalThis.fetch = realFetch;
  });

  test("GET /api/compare handles engine errors gracefully", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(() => Promise.reject(new Error("Network error")));

    const res = await httpRequest(`${baseUrl}/api/compare?q=hotel&engines=tavily,google`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.errors).toBeDefined();
    expect(data.errors.tavily).toBe("Network error");
    expect(data.errors.google).toBe("Network error");

    globalThis.fetch = realFetch;
  });

  test("GET /api/compare defaults to all engines", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: [], items: [] }),
      })
    );

    const res = await httpRequest(`${baseUrl}/api/compare?q=test`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.engines).toBe(3);
    expect(data.results.tavily).toBeDefined();
    expect(data.results.google).toBeDefined();
    expect(data.results.ddg).toBeDefined();

    globalThis.fetch = realFetch;
  });

  test("GET /api/compare skips unknown engines", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      })
    );

    const res = await httpRequest(`${baseUrl}/api/compare?q=test&engines=tavily,badengine`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.engines).toBe(2);
    expect(data.results.tavily).toBeDefined();
    expect(data.results.badengine).toBeUndefined();
    expect(data.errors.badengine).toBe("Unknown engine");

    globalThis.fetch = realFetch;
  });
});
