import { describe, test, expect, beforeAll, afterAll, jest } from "@jest/globals";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_USERS_FILE = path.join(__dirname, "..", "users.json");

let originalUsers;
let adminCookie;
let noSearchCookie;
let server;
let baseUrl;

// Mock @tavily/core before importing search routes
const mockTavilySearch = jest.fn();
jest.unstable_mockModule("@tavily/core", () => ({
  tavily: jest.fn(() => ({ search: mockTavilySearch })),
}));

// Mock axios before importing search routes
jest.unstable_mockModule("axios", () => ({
  default: { get: jest.fn() },
}));

// Mock child_process to prevent DDG server spawn
jest.unstable_mockModule("child_process", () => ({
  spawn: jest.fn(() => ({
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn(),
    kill: jest.fn(),
  })),
}));

// Set test API keys before importing search routes (module reads them at load time)
process.env.TAVILY_API_KEY_1 = "test-tavily-key-1";
process.env.TAVILY_API_KEY_2 = "test-tavily-key-2";
process.env.GO_API_KEY_1 = "test-google-key-1";
process.env.GO_API_KEY_2 = "test-google-key-2";

// Import mocked modules
await import("@tavily/core");
const { default: axios } = await import("axios");

// Import actual search routes
const { default: searchRoutes } = await import("../routes/search.js");

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

  // Login endpoint
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

  // Mount actual search routes
  app.use(searchRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

async function loginAs(username, password) {
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    redirect: "manual",
  });
  return res.headers.get("set-cookie");
}

describe("Search Routes", () => {
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
      {
        id: 2,
        username: "nosearch",
        password: await bcrypt.hash("testpass123", 10),
        displayName: "No Search",
        role: "user",
        features: [],
        createdAt: new Date().toISOString(),
      },
    ];
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(testUsers, null, 2), "utf8");

    const app = createTestApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });

    adminCookie = await loginAs("admin", "admin123");
    noSearchCookie = await loginAs("nosearch", "testpass123");
  });

  afterAll((done) => {
    if (originalUsers !== undefined) {
      fs.writeFileSync(TEST_USERS_FILE, originalUsers, "utf8");
    }
    server.close(done);
  });

  describe("Search Pages", () => {
    test("GET /searchTavily should serve page for authenticated user", async () => {
      const res = await fetch(`${baseUrl}/searchTavily`, {
        headers: { Cookie: adminCookie },
        redirect: "manual",
      });
      expect(res.status).toBe(200);
    });

    test("GET /searchTavily should redirect unauthenticated user", async () => {
      const res = await fetch(`${baseUrl}/searchTavily`, { redirect: "manual" });
      expect(res.status).toBe(302);
    });

    test("GET /searchGo should serve page for authenticated user", async () => {
      const res = await fetch(`${baseUrl}/searchGo`, {
        headers: { Cookie: adminCookie },
        redirect: "manual",
      });
      expect(res.status).toBe(200);
    });
  });

  describe("Tavily Search API", () => {
    test("should return search results for valid query", async () => {
      mockTavilySearch.mockResolvedValueOnce({
        results: [{ title: "Hotel Test", url: "https://example.com" }],
      });

      const res = await fetch(`${baseUrl}/searchApiTavily?q=hotel+test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results).toHaveLength(1);
    });

    test("should reject request without q parameter", async () => {
      const res = await fetch(`${baseUrl}/searchApiTavily`, {
        headers: { Cookie: adminCookie },
        redirect: "manual",
      });
      expect(res.status).toBe(400);
    });

    test("should redirect unauthenticated user", async () => {
      const res = await fetch(`${baseUrl}/searchApiTavily?q=test`, { redirect: "manual" });
      expect(res.status).toBe(302);
    });

    test("should reject user without tavily feature", async () => {
      const res = await fetch(`${baseUrl}/searchApiTavily?q=test`, {
        headers: { Cookie: noSearchCookie },
      });
      expect(res.status).toBe(403);
    });

    test("should return 500 on search error", async () => {
      mockTavilySearch.mockRejectedValueOnce(new Error("API key exhausted"));

      const res = await fetch(`${baseUrl}/searchApiTavily?q=test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("Search Failed");
    });

    test("should rotate key on 429 and succeed", async () => {
      const error429 = new Error("Rate limited");
      error429.response = { status: 429 };
      mockTavilySearch
        .mockRejectedValueOnce(error429)
        .mockResolvedValueOnce({ results: [{ title: "Rotated", url: "https://example.com" }] });

      const res = await fetch(`${baseUrl}/searchApiTavily?q=test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results).toHaveLength(1);
    });
  });

  describe("Google Search API", () => {
    test("should return search results for valid query", async () => {
      axios.get.mockResolvedValueOnce({
        data: { items: [{ title: "Result", link: "https://example.com" }] },
      });

      const res = await fetch(`${baseUrl}/searchApiGo?q=hotel+test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toHaveLength(1);
    });

    test("should reject request without q parameter", async () => {
      const res = await fetch(`${baseUrl}/searchApiGo`, {
        headers: { Cookie: adminCookie },
        redirect: "manual",
      });
      expect(res.status).toBe(400);
    });

    test("should redirect unauthenticated user", async () => {
      const res = await fetch(`${baseUrl}/searchApiGo?q=test`, { redirect: "manual" });
      expect(res.status).toBe(302);
    });

    test("should return 500 on search error", async () => {
      axios.get.mockRejectedValueOnce(new Error("API key limit"));

      const res = await fetch(`${baseUrl}/searchApiGo?q=test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(500);
    });

    test("should rotate key on 429 and succeed", async () => {
      const error429 = new Error("Rate limited");
      error429.response = { status: 429 };
      axios.get
        .mockRejectedValueOnce(error429)
        .mockResolvedValueOnce({
          data: { items: [{ title: "Rotated", link: "https://example.com" }] },
        });

      const res = await fetch(`${baseUrl}/searchApiGo?q=test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toHaveLength(1);
    });
  });

  describe("DDG Search API", () => {
    let ddgMockQueue;

    function setupDdgMock() {
      ddgMockQueue = [];
      const realFetch = global.fetch;
      jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
        if (typeof url === "string" && url.includes("localhost:5001")) {
          const next = ddgMockQueue.shift();
          if (!next) return Promise.reject(new Error("No DDG mock for: " + url));
          if (next.reject) return Promise.reject(next.reject);
          return Promise.resolve(next.resolve);
        }
        return realFetch(url, opts);
      });
    }

    beforeEach(() => {
      ddgMockQueue = [];
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("should return DDG results for valid query", async () => {
      setupDdgMock();
      // Health check
      ddgMockQueue.push({ resolve: { ok: true } });
      // Search
      ddgMockQueue.push({
        resolve: {
          ok: true,
          json: async () => ({ results: [{ title: "DDG Result", url: "https://ddg.com" }] }),
        },
      });

      const res = await fetch(`${baseUrl}/searchApiDDG?q=hotel+test&hotel_name=TestHotel&hotel_address=123+Main+St`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results).toHaveLength(1);
      expect(data.query).toBe("hotel test");
    });

    test("should reject request without q parameter", async () => {
      const res = await fetch(`${baseUrl}/searchApiDDG`, {
        headers: { Cookie: adminCookie },
        redirect: "manual",
      });
      expect(res.status).toBe(400);
    });

    test("should redirect unauthenticated user", async () => {
      const res = await fetch(`${baseUrl}/searchApiDDG?q=test`, { redirect: "manual" });
      expect(res.status).toBe(302);
    });

    test("should reject user without ddg feature", async () => {
      const res = await fetch(`${baseUrl}/searchApiDDG?q=test`, {
        headers: { Cookie: noSearchCookie },
      });
      expect(res.status).toBe(403);
    });

    test("should return 502 when DDG server returns error", async () => {
      setupDdgMock();
      ddgMockQueue.push({ resolve: { ok: true } }); // health
      ddgMockQueue.push({ resolve: { ok: false, status: 500 } }); // search error

      const res = await fetch(`${baseUrl}/searchApiDDG?q=test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toBe("DuckDuckGo server error");
    });

    test("should return 500 on DDG fetch failure", async () => {
      setupDdgMock();
      ddgMockQueue.push({ resolve: { ok: true } }); // health
      ddgMockQueue.push({ reject: new Error("Network error") }); // search failure

      const res = await fetch(`${baseUrl}/searchApiDDG?q=test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("DuckDuckGo search error");
    });
  });

  describe("Tavily - Additional Rotation", () => {
    test("should rotate on 403 error", async () => {
      const error403 = new Error("Forbidden");
      error403.response = { status: 403 };
      mockTavilySearch
        .mockRejectedValueOnce(error403)
        .mockResolvedValueOnce({ results: [{ title: "After 403", url: "https://example.com" }] });

      const res = await fetch(`${baseUrl}/searchApiTavily?q=test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
    });

    test("should rotate on 422 error", async () => {
      const error422 = new Error("Unprocessable");
      error422.response = { status: 422 };
      mockTavilySearch
        .mockRejectedValueOnce(error422)
        .mockResolvedValueOnce({ results: [{ title: "After 422", url: "https://example.com" }] });

      const res = await fetch(`${baseUrl}/searchApiTavily?q=test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
    });

    test("should rotate on usage limit exceeded message", async () => {
      const limitError = new Error("exceeds your plan's set usage limit");
      mockTavilySearch
        .mockRejectedValueOnce(limitError)
        .mockResolvedValueOnce({ results: [{ title: "After limit", url: "https://example.com" }] });

      const res = await fetch(`${baseUrl}/searchApiTavily?q=test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
    });

    test("should throw on non-retryable error", async () => {
      const networkError = new Error("ECONNREFUSED");
      mockTavilySearch.mockRejectedValueOnce(networkError);

      const res = await fetch(`${baseUrl}/searchApiTavily?q=test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(500);
      // Reset index via a successful call
      mockTavilySearch.mockResolvedValueOnce({ results: [] });
      await fetch(`${baseUrl}/searchApiTavily?q=reset`, {
        headers: { Cookie: adminCookie },
      });
    });
  });

  describe("Google - Additional Rotation", () => {
    test("should rotate on 403 error", async () => {
      const error403 = new Error("Forbidden");
      error403.response = { status: 403 };
      axios.get
        .mockRejectedValueOnce(error403)
        .mockResolvedValueOnce({ data: { items: [{ title: "After 403" }] } });

      const res = await fetch(`${baseUrl}/searchApiGo?q=test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
    });

    test("should throw on non-retryable error", async () => {
      const error500 = new Error("Server error");
      error500.response = { status: 500, data: { error: "internal" } };
      axios.get.mockRejectedValueOnce(error500);

      const res = await fetch(`${baseUrl}/searchApiGo?q=test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(500);
      // Reset index via a successful call
      axios.get.mockResolvedValueOnce({ data: { items: [] } });
      await fetch(`${baseUrl}/searchApiGo?q=reset`, {
        headers: { Cookie: adminCookie },
      });
    });
  });

  describe("Tavily - All Keys Exhausted", () => {
    test("should return 500 when all Tavily keys fail", async () => {
      const error429 = new Error("Rate limited");
      error429.response = { status: 429 };
      mockTavilySearch
        .mockRejectedValueOnce(error429)
        .mockRejectedValueOnce(error429);

      const res = await fetch(`${baseUrl}/searchApiTavily?q=test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("Search Failed");
    });
  });

  describe("Google - All Keys Exhausted", () => {
    test("should return 500 when all Google keys fail", async () => {
      const error429 = new Error("Rate limited");
      error429.response = { status: 429 };
      axios.get
        .mockRejectedValueOnce(error429)
        .mockRejectedValueOnce(error429);

      const res = await fetch(`${baseUrl}/searchApiGo?q=test`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(500);
    });
  });

  describe("404 Handler", () => {
    test("should return 404 for unknown routes", async () => {
      const res = await fetch(`${baseUrl}/nonexistent`);
      expect(res.status).toBe(404);
    });
  });
});
