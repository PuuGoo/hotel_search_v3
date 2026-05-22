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
let noCase12Cookie;
let server;
let baseUrl;

// Set env var before importing case12 routes
process.env.CASE12_API_URL = "https://test-api.example.com/api/case12";

// Mock fetch for Case12 API calls - intercept before importing route
const mockCase12Handler = jest.fn();
const realFetch = globalThis.fetch;

globalThis.fetch = async (url, options) => {
  // Intercept case12 API calls
  if (typeof url === "string" && url.includes("test-api.example.com")) {
    return mockCase12Handler(url, options);
  }
  // Pass through all other calls (including localhost test server)
  return realFetch(url, options);
};

// Import actual case12 routes (uses the mocked fetch)
const { default: case12Routes } = await import("../routes/case12.js");

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

  // Mount actual case12 routes
  app.use(case12Routes);

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

describe("Case12 Routes", () => {
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
        username: "nocase12",
        password: await bcrypt.hash("testpass123", 10),
        displayName: "No Case12",
        role: "user",
        features: ["tavily"],
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
    noCase12Cookie = await loginAs("nocase12", "testpass123");
  });

  afterAll((done) => {
    if (originalUsers !== undefined) {
      fs.writeFileSync(TEST_USERS_FILE, originalUsers, "utf8");
    }
    globalThis.fetch = realFetch;
    server.close(done);
  });

  describe("Case12 Health Check", () => {
    test("should return ok when API is reachable", async () => {
      mockCase12Handler.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"ok":true}'),
      });

      const res = await fetch(`${baseUrl}/api/case12/health`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
    });

    test("should return 500 when API is unreachable", async () => {
      mockCase12Handler.mockRejectedValueOnce(new Error("Connection refused"));

      const res = await fetch(`${baseUrl}/api/case12/health`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    test("should reject unauthenticated request with 401", async () => {
      const res = await fetch(`${baseUrl}/api/case12/health`);
      expect(res.status).toBe(401);
    });

    test("should reject user without case12 feature", async () => {
      expect(noCase12Cookie).toBeDefined();
      const res = await fetch(`${baseUrl}/api/case12/health`, {
        headers: { Cookie: noCase12Cookie },
      });
      expect(res.status).toBe(403);
    });
  });

  describe("Case12 File Upload", () => {
    test("should reject request without file", async () => {
      const res = await fetch(`${baseUrl}/api/case12`, {
        method: "POST",
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(400);
    });

    test("should reject unauthenticated request", async () => {
      const formData = new FormData();
      formData.append("file", new Blob(["test"], { type: "text/plain" }), "test.txt");

      const res = await fetch(`${baseUrl}/api/case12`, {
        method: "POST",
        body: formData,
      });
      expect(res.status).toBe(401);
    });

    test("should reject user without case12 feature", async () => {
      const formData = new FormData();
      formData.append("file", new Blob(["test"], { type: "text/plain" }), "test.txt");

      const res = await fetch(`${baseUrl}/api/case12`, {
        method: "POST",
        headers: { Cookie: noCase12Cookie },
        body: formData,
      });
      expect(res.status).toBe(403);
    });

    test("should upload file and return xlsx response", async () => {
      mockCase12Handler.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": 'attachment; filename="verified_case12.xlsx"',
        }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      const formData = new FormData();
      const fileContent = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
      const blob = new Blob([fileContent], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      formData.append("file", blob, "test.xlsx");

      const res = await fetch(`${baseUrl}/api/case12`, {
        method: "POST",
        headers: { Cookie: adminCookie },
        body: formData,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("spreadsheetml");
    });

    test("should handle upstream API error response", async () => {
      mockCase12Handler.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      const formData = new FormData();
      const blob = new Blob(["test"], { type: "text/plain" });
      formData.append("file", blob, "test.txt");

      const res = await fetch(`${baseUrl}/api/case12`, {
        method: "POST",
        headers: { Cookie: adminCookie },
        body: formData,
      });
      expect(res.status).toBe(500);
    });

    test("should handle upstream API exception", async () => {
      mockCase12Handler.mockRejectedValueOnce(new Error("Network timeout"));

      const formData = new FormData();
      const blob = new Blob(["test"], { type: "text/plain" });
      formData.append("file", blob, "test.txt");

      const res = await fetch(`${baseUrl}/api/case12`, {
        method: "POST",
        headers: { Cookie: adminCookie },
        body: formData,
      });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("Case12 API error");
    });
  });

  describe("404 Handler", () => {
    test("should return 404 for unknown routes", async () => {
      const res = await fetch(`${baseUrl}/nonexistent`);
      expect(res.status).toBe(404);
    });
  });
});
