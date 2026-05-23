import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import http from "http";
import {
  normalizeUrl,
  stringSimilarity,
  areDuplicates,
  findDuplicateGroups,
  mergeDuplicates,
  deduplicateResults,
} from "../utils/deduplication.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_USERS_FILE = path.join(__dirname, "..", "users.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: deduplicationRoutes } = await import("../routes/deduplication.js");

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
  app.use(deduplicationRoutes);
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

describe("Deduplication Utils", () => {
  test("normalizeUrl strips protocol and www", () => {
    expect(normalizeUrl("https://www.example.com/path/")).toBe("example.com/path");
    expect(normalizeUrl("http://example.com")).toBe("example.com");
  });

  test("normalizeUrl handles empty input", () => {
    expect(normalizeUrl("")).toBe("");
    expect(normalizeUrl(null)).toBe("");
  });

  test("stringSimilarity returns 1 for identical strings", () => {
    expect(stringSimilarity("hello", "hello")).toBe(1);
  });

  test("stringSimilarity returns 0 for completely different strings", () => {
    expect(stringSimilarity("abc", "xyz")).toBeLessThan(0.1);
  });

  test("stringSimilarity returns high value for similar strings", () => {
    const sim = stringSimilarity("Hotel Da Nang Beach", "Hotel Đà Nẵng Beach");
    expect(sim).toBeGreaterThan(0.5);
  });

  test("areDuplicates detects exact URL match", () => {
    const a = { title: "Hotel A", url: "https://example.com/hotel" };
    const b = { title: "Completely Different", url: "https://example.com/hotel" };
    expect(areDuplicates(a, b)).toBe(true);
  });

  test("areDuplicates detects similar titles", () => {
    const a = { title: "Hotel Da Nang Beach Resort" };
    const b = { title: "Hotel Da Nang Beach Resort & Spa" };
    expect(areDuplicates(a, b)).toBe(true);
  });

  test("areDuplicates returns false for different results", () => {
    const a = { title: "Luxury Beach Resort", url: "https://beach-resort.com" };
    const b = { title: "Mountain Cabin Lodge", url: "https://mountain-lodge.com" };
    expect(areDuplicates(a, b)).toBe(false);
  });

  test("findDuplicateGroups finds groups", () => {
    const results = [
      { title: "Hotel A", url: "https://example.com/a" },
      { title: "Hotel A", url: "https://example.com/a" },
      { title: "Hotel B", url: "https://example.com/b" },
      { title: "Hotel A copy", url: "https://example.com/a" },
    ];
    const groups = findDuplicateGroups(results);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    // Group 0 contains indices with same URL
    const allDupes = groups.flat();
    expect(allDupes).toContain(0);
    expect(allDupes).toContain(1);
    expect(allDupes).toContain(3);
  });

  test("mergeDuplicates picks best data and merges engines", () => {
    const results = [
      { title: "Hotel", url: "https://example.com", engine: "tavily", score: 0.9 },
      { title: "Hotel", url: "https://example.com", engine: "google", score: 0.8, snippet: "Nice hotel" },
    ];
    const merged = mergeDuplicates([0, 1], results);
    expect(merged._engines).toContain("tavily");
    expect(merged._engines).toContain("google");
    expect(merged._duplicateCount).toBe(2);
    expect(merged.snippet).toBe("Nice hotel");
  });

  test("deduplicateResults returns correct counts", () => {
    const results = [
      { title: "Hotel A", url: "https://example.com/a", engine: "tavily" },
      { title: "Hotel A", url: "https://example.com/a", engine: "google" },
      { title: "Hotel B", url: "https://example.com/b", engine: "tavily" },
    ];
    const { deduplicated, duplicates, groups } = deduplicateResults(results);
    expect(duplicates).toBeGreaterThanOrEqual(1);
    expect(groups).toBeGreaterThanOrEqual(1);
    expect(deduplicated.length).toBeLessThanOrEqual(2);
    expect(deduplicated.length).toBeGreaterThanOrEqual(1);
  });

  test("deduplicateResults handles empty input", () => {
    const { deduplicated, duplicates, groups } = deduplicateResults([]);
    expect(deduplicated).toEqual([]);
    expect(duplicates).toBe(0);
    expect(groups).toBe(0);
  });
});

describe("Deduplication API", () => {
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
  });

  test("POST /api/deduplicate requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/deduplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results: [] }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/deduplicate deduplicates results", async () => {
    const results = [
      { title: "Hotel A", url: "https://example.com/a", engine: "tavily" },
      { title: "Hotel A", url: "https://example.com/a", engine: "google" },
      { title: "Hotel B", url: "https://example.com/b", engine: "tavily" },
    ];
    const res = await makeRequest(`${baseUrl}/api/deduplicate`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ results }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.duplicates).toBeGreaterThanOrEqual(1);
    expect(data.deduplicated.length).toBeLessThanOrEqual(2);
  });

  test("POST /api/deduplicate rejects non-array results", async () => {
    const res = await makeRequest(`${baseUrl}/api/deduplicate`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ results: "not an array" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/deduplicate rejects invalid threshold", async () => {
    const res = await makeRequest(`${baseUrl}/api/deduplicate`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ results: [], threshold: 1.5 }),
    });
    expect(res.status).toBe(400);
  });
});
