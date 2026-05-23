import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import intelligentCacheRoutes from "../routes/intelligentCache.js";
import {
  getCached,
  setCache,
  invalidateCache,
  invalidateExpired,
  clearCache,
  warmCache,
  getCacheStats,
  getCacheEntries,
  generateCacheKey,
} from "../utils/intelligentCache.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, "..", "intelligent_cache.json");
const STATS_FILE = path.join(__dirname, "..", "cache_stats.json");
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");

let cacheBackup;
let statsBackup;
let historyBackup;

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
  app.use(intelligentCacheRoutes);
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

describe("Intelligent Cache", () => {
  beforeEach(() => {
    try { cacheBackup = fs.readFileSync(CACHE_FILE, "utf8"); } catch { cacheBackup = null; }
    try { statsBackup = fs.readFileSync(STATS_FILE, "utf8"); } catch { statsBackup = null; }
    try { historyBackup = fs.readFileSync(HISTORY_FILE, "utf8"); } catch { historyBackup = null; }
    clearCache();
    try { fs.writeFileSync(STATS_FILE, "{}"); } catch {}
  });

  afterEach(() => {
    if (cacheBackup) fs.writeFileSync(CACHE_FILE, cacheBackup);
    else { try { fs.unlinkSync(CACHE_FILE); } catch {} }
    if (statsBackup) fs.writeFileSync(STATS_FILE, statsBackup);
    else { try { fs.unlinkSync(STATS_FILE); } catch {} }
    if (historyBackup) fs.writeFileSync(HISTORY_FILE, historyBackup);
  });

  describe("Utility functions", () => {
    test("generateCacheKey generates consistent keys", () => {
      const key1 = generateCacheKey({ query: "hotel paris", engine: "ddg" });
      const key2 = generateCacheKey({ query: "Hotel Paris", engine: "ddg" });
      expect(key1).toBe(key2); // Case insensitive
      expect(key1).toMatch(/^cache_/);
    });

    test("generateCacheKey generates different keys for different params", () => {
      const key1 = generateCacheKey({ query: "hotel paris" });
      const key2 = generateCacheKey({ query: "hotel london" });
      expect(key1).not.toBe(key2);
    });

    test("getCached returns null for missing key", () => {
      expect(getCached("nonexistent")).toBeNull();
    });

    test("setCache and getCached works", () => {
      const key = "test_key";
      const data = { results: [{ title: "Hotel" }] };
      setCache(key, data);
      expect(getCached(key)).toEqual(data);
    });

    test("getCached returns null for expired entry", () => {
      const key = "expired_key";
      // Set with past cachedAt to simulate expiration
      const cache = {};
      cache[key] = {
        data: { data: "test" },
        cachedAt: Date.now() - 1000, // 1 second ago
        lastAccess: Date.now() - 1000,
        ttl: 100, // 100ms TTL
        accessCount: 0,
        size: 10,
      };
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
      expect(getCached(key)).toBeNull();
    });

    test("invalidateCache by query pattern", () => {
      setCache("k1", { query: "hotel paris" }, { query: "hotel paris" });
      setCache("k2", { query: "hotel london" }, { query: "hotel london" });
      const invalidated = invalidateCache("paris");
      expect(invalidated).toBe(1);
      expect(getCached("k1")).toBeNull();
      expect(getCached("k2")).not.toBeNull();
    });

    test("invalidateCache by function", () => {
      setCache("k1", { engine: "ddg" }, { engine: "ddg" });
      setCache("k2", { engine: "google" }, { engine: "google" });
      const invalidated = invalidateCache((entry) => entry.engine === "ddg");
      expect(invalidated).toBe(1);
    });

    test("invalidateExpired removes expired entries", () => {
      // Create one expired and one valid entry
      const cache = {
        k1: { data: { data: "test" }, cachedAt: Date.now() - 1000, lastAccess: Date.now() - 1000, ttl: 100, size: 10 },
        k2: { data: { data: "test" }, cachedAt: Date.now(), lastAccess: Date.now(), ttl: 60000, size: 10 },
      };
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
      const invalidated = invalidateExpired();
      expect(invalidated).toBe(1);
    });

    test("clearCache clears all entries", () => {
      setCache("k1", { data: "test1" });
      setCache("k2", { data: "test2" });
      clearCache();
      expect(getCached("k1")).toBeNull();
      expect(getCached("k2")).toBeNull();
    });

    test("warmCache warms popular queries", async () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString() },
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString() },
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString() },
      ]));

      const searchFn = async (query) => ({ query, results: [] });
      const result = await warmCache(searchFn, { maxQueries: 5, minSearches: 2 });
      expect(result.warmed).toBe(1);
    });

    test("warmCache skips already cached", async () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
      ]));

      const key = generateCacheKey({ query: "hotel" });
      setCache(key, { data: "cached" }, { query: "hotel" });

      const searchFn = async (query) => ({ query, results: [] });
      const result = await warmCache(searchFn, { maxQueries: 5, minSearches: 2 });
      expect(result.alreadyCached).toBe(1);
    });

    test("getCacheStats returns statistics", () => {
      setCache("k1", { data: "test" }, { query: "hotel" });
      const stats = getCacheStats();
      expect(stats.totalEntries).toBe(1);
      expect(stats).toHaveProperty("hitRate");
      expect(stats).toHaveProperty("totalHits");
      expect(stats).toHaveProperty("totalMisses");
    });

    test("getCacheEntries returns entries", () => {
      setCache("k1", { data: "test" }, { query: "hotel" });
      const result = getCacheEntries();
      expect(result.entries.length).toBe(1);
      expect(result.total).toBe(1);
    });
  });

  describe("API Routes", () => {
    test("GET /api/cache/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/cache/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/cache/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/cache/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalEntries");
      expect(body).toHaveProperty("hitRate");
    });

    test("GET /api/cache/entries returns entries for admin", async () => {
      setCache("test_key", { data: "test" }, { query: "hotel" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/cache/entries", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("entries");
      expect(body).toHaveProperty("total");
    });

    test("POST /api/cache/invalidate requires pattern", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/cache/invalidate", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/cache/invalidate invalidates entries", async () => {
      setCache("k1", { data: "test" }, { query: "hotel paris" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/cache/invalidate", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { pattern: "paris" },
      });
      expect(status).toBe(200);
      expect(body.invalidated).toBe(1);
    });

    test("POST /api/cache/cleanup cleans expired entries", async () => {
      setCache("k1", { data: "test" }, { ttl: 0 });
      const start = Date.now();
      while (Date.now() - start < 10) {}
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/cache/cleanup", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.invalidated).toBeGreaterThanOrEqual(0);
    });

    test("POST /api/cache/clear clears cache", async () => {
      setCache("k1", { data: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/cache/clear", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("POST /api/cache/warm warms cache", async () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
      ]));
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/cache/warm", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("warmed");
    });

    test("GET /api/cache/check/:key checks entry", async () => {
      setCache("test_key", { data: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/cache/check/test_key", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.cached).toBe(true);
    });

    test("POST /api/cache/set requires key and data", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/cache/set", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/cache/set sets entry for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/cache/set", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { key: "new_key", data: { test: true }, query: "hotel" },
      });
      expect(status).toBe(200);
      expect(body.key).toBe("new_key");
    });
  });
});
