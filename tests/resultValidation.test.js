import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import resultValidationRoutes from "../routes/resultValidation.js";
import {
  validateUrl,
  validateUrls,
  validateSearchResults,
  getValidationStats,
  clearValidationCache,
} from "../utils/resultValidation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, "..", "url_validation_cache.json");

let cacheBackup;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    if (req.headers["x-test-user"]) {
      req.session.isAuthenticated = true;
      req.session.user = { id: req.headers["x-test-user"], role: req.headers["x-test-role"] || "user" };
    }
    next();
  });
  app.use(resultValidationRoutes);
  return app;
}

function makeRequest(app, urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const req = http.request(
        { hostname: "localhost", port, path: urlPath, method: options.method || "GET", headers: { ...options.headers } },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            server.close();
            try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
            catch { resolve({ status: res.statusCode, body }); }
          });
        }
      );
      req.on("error", (err) => { server.close(); reject(err); });
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    });
  });
}

describe("Result Validation", () => {
  beforeEach(() => {
    try { cacheBackup = fs.readFileSync(CACHE_FILE, "utf8"); } catch { cacheBackup = null; }
    clearValidationCache();
  });

  afterEach(() => {
    if (cacheBackup) fs.writeFileSync(CACHE_FILE, cacheBackup);
    else {
      try { fs.unlinkSync(CACHE_FILE); } catch { /* ignore */ }
    }
  });

  describe("Utility functions", () => {
    test("validateUrl returns result structure", async () => {
      // Use a URL that will likely fail (invalid domain) for fast test
      const result = await validateUrl("https://this-domain-does-not-exist-12345.com", { timeout: 2000, useCache: false });
      expect(result).toHaveProperty("url");
      expect(result).toHaveProperty("accessible");
      expect(result).toHaveProperty("responseTime");
      expect(result).toHaveProperty("checkedAt");
      expect(result.accessible).toBe(false);
    });

    test("validateUrl handles timeout", async () => {
      const result = await validateUrl("https://10.255.255.1", { timeout: 100, useCache: false });
      expect(result.accessible).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("validateUrl caches results", async () => {
      await validateUrl("https://example.com/test-validation-cache", { timeout: 3000, useCache: true });
      const stats = getValidationStats();
      expect(stats.totalCached).toBeGreaterThan(0);
    });

    test("validateUrl uses cached result", async () => {
      // First call
      const result1 = await validateUrl("https://example.com/test-cache-hit", { timeout: 3000, useCache: true });
      // Second call should use cache
      const result2 = await validateUrl("https://example.com/test-cache-hit", { timeout: 3000, useCache: true });
      expect(result2.cached).toBe(true);
      expect(result2.statusCode).toBe(result1.statusCode);
    });

    test("validateUrl forceRefresh bypasses cache", async () => {
      await validateUrl("https://example.com/test-force-refresh", { timeout: 3000, useCache: true });
      const result = await validateUrl("https://example.com/test-force-refresh", { timeout: 3000, useCache: true, forceRefresh: true });
      expect(result.cached).toBeUndefined();
    });

    test("validateUrls validates multiple URLs", async () => {
      const results = await validateUrls(
        ["https://example.com/1", "https://example.com/2"],
        { timeout: 3000, concurrency: 2, useCache: false }
      );
      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty("url");
      expect(results[1]).toHaveProperty("url");
    });

    test("validateUrls respects concurrency limit", async () => {
      const urls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`);
      const results = await validateUrls(urls, { timeout: 3000, concurrency: 2, useCache: false });
      expect(results).toHaveLength(6);
    });

    test("validateSearchResults adds validation info", async () => {
      const results = [
        { title: "Test Hotel", url: "https://example.com/hotel1", engine: "ddg" },
        { title: "Another Hotel", url: "https://example.com/hotel2", engine: "google" },
      ];
      const validated = await validateSearchResults(results, { timeout: 3000, useCache: false });
      expect(validated).toHaveLength(2);
      expect(validated[0]).toHaveProperty("validation");
      expect(validated[0].validation).toHaveProperty("accessible");
      expect(validated[0].validation).toHaveProperty("statusCode");
    });

    test("validateSearchResults handles results without URLs", async () => {
      const results = [
        { title: "No URL Hotel", engine: "ddg" },
        { title: "Has URL", url: "https://example.com/test", engine: "google" },
      ];
      const validated = await validateSearchResults(results, { timeout: 3000, useCache: false });
      expect(validated[0].validation).toBeNull();
      expect(validated[1].validation).not.toBeNull();
    });

    test("validateSearchResults handles empty array", async () => {
      const validated = await validateSearchResults([], { timeout: 3000 });
      expect(validated).toEqual([]);
    });

    test("validateSearchResults handles null input", async () => {
      const validated = await validateSearchResults(null, { timeout: 3000 });
      expect(validated).toBeNull();
    });

    test("getValidationStats returns stats", () => {
      const stats = getValidationStats();
      expect(stats).toHaveProperty("totalCached");
      expect(stats).toHaveProperty("accessible");
      expect(stats).toHaveProperty("inaccessible");
      expect(stats).toHaveProperty("avgResponseTime");
      expect(stats).toHaveProperty("statusCodes");
      expect(stats).toHaveProperty("errors");
      expect(stats).toHaveProperty("cacheTTL");
      expect(stats).toHaveProperty("maxCacheSize");
    });

    test("clearValidationCache clears cache", async () => {
      await validateUrl("https://example.com/test-clear", { timeout: 3000, useCache: true });
      clearValidationCache();
      const stats = getValidationStats();
      expect(stats.totalCached).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/validation/url requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/validation/url", {
        method: "POST",
        body: { url: "https://example.com" },
      });
      expect(status).toBe(401);
    });

    test("POST /api/validation/url requires url", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/validation/url", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/validation/url rejects invalid URL", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/validation/url", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { url: "not-a-url" },
      });
      expect(status).toBe(400);
    });

    test("POST /api/validation/url validates URL", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/validation/url", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { url: "https://example.com/test-api", timeout: 3000 },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("url");
      expect(body).toHaveProperty("accessible");
    });

    test("POST /api/validation/urls requires urls array", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/validation/urls", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/validation/urls rejects empty array", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/validation/urls", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { urls: [] },
      });
      expect(status).toBe(400);
    });

    test("POST /api/validation/urls rejects too many URLs", async () => {
      const app = createTestApp();
      const urls = Array.from({ length: 51 }, (_, i) => `https://example.com/${i}`);
      const { status } = await makeRequest(app, "/api/validation/urls", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { urls },
      });
      expect(status).toBe(400);
    });

    test("POST /api/validation/urls validates multiple URLs", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/validation/urls", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { urls: ["https://example.com/a", "https://example.com/b"], timeout: 3000 },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("results");
      expect(body).toHaveProperty("summary");
      expect(body.summary.total).toBe(2);
    });

    test("POST /api/validation/results requires results array", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/validation/results", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/validation/results validates search results", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/validation/results", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {
          results: [
            { title: "Test", url: "https://example.com/test", engine: "ddg" },
          ],
          timeout: 3000,
        },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("results");
      expect(body).toHaveProperty("summary");
    });

    test("GET /api/validation/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/validation/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/validation/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/validation/stats", {
        headers: { "x-test-user": "admin1", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalCached");
      expect(body).toHaveProperty("cacheTTL");
    });

    test("DELETE /api/validation/cache requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/validation/cache", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/validation/cache clears cache for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/validation/cache", {
        method: "DELETE",
        headers: { "x-test-user": "admin1", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
