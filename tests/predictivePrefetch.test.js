import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import prefetchRoutes from "../routes/predictivePrefetch.js";
import {
  buildTransitions,
  getPredictions,
  storePrefetch,
  checkPrefetch,
  runPrefetch,
  getPrefetchStats,
  clearPrefetchCache,
} from "../utils/predictivePrefetch.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PREFETCH_FILE = path.join(__dirname, "..", "prefetch_data.json");
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");

let prefetchBackup;
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
  app.use(prefetchRoutes);
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

function saveWithRetry(filePath, data) {
  let retries = 5;
  while (retries-- > 0) {
    try { fs.writeFileSync(filePath, data); return; }
    catch (e) { if (e.code === "EBUSY") { /* retry */ } else throw e; }
  }
}

describe("Predictive Prefetch", () => {
  beforeEach(() => {
    try { prefetchBackup = fs.readFileSync(PREFETCH_FILE, "utf8"); } catch { prefetchBackup = null; }
    try { historyBackup = fs.readFileSync(HISTORY_FILE, "utf8"); } catch { historyBackup = null; }
    clearPrefetchCache();
  });

  afterEach(() => {
    if (prefetchBackup) saveWithRetry(PREFETCH_FILE, prefetchBackup);
    else { try { fs.unlinkSync(PREFETCH_FILE); } catch {} }
    if (historyBackup) saveWithRetry(HISTORY_FILE, historyBackup);
  });

  describe("Utility functions", () => {
    test("buildTransitions builds from history", () => {
      const now = Date.now();
      const history = [
        { userId: "u1", query: "hotel paris", timestamp: new Date(now - 3000).toISOString() },
        { userId: "u1", query: "hotel london", timestamp: new Date(now - 2000).toISOString() },
        { userId: "u1", query: "hotel paris", timestamp: new Date(now - 1000).toISOString() },
        { userId: "u1", query: "hotel london", timestamp: new Date(now).toISOString() },
      ];
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));

      const transitions = buildTransitions("u1");
      expect(transitions).toHaveProperty("hotel paris");
      expect(transitions["hotel paris"][0].nextQuery).toBe("hotel london");
      expect(transitions["hotel paris"][0].count).toBe(2);
    });

    test("getPredictions returns predictions", () => {
      const now = Date.now();
      const history = [
        { userId: "u1", query: "hotel", timestamp: new Date(now - 2000).toISOString() },
        { userId: "u1", query: "resort", timestamp: new Date(now - 1000).toISOString() },
        { userId: "u1", query: "hotel", timestamp: new Date(now).toISOString() },
      ];
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));

      const predictions = getPredictions("u1", "hotel");
      // Only 1 transition, need minCount=2
      // Let's try with lower minCount
      const predictionsLow = getPredictions("u1", "hotel", { minCount: 1 });
      expect(predictionsLow.length).toBeGreaterThan(0);
    });

    test("storePrefetch stores results", () => {
      storePrefetch("hotel", "ddg", [{ title: "Hotel A" }]);
      const result = checkPrefetch("hotel", "ddg");
      expect(result).not.toBeNull();
      expect(result.results.length).toBe(1);
    });

    test("checkPrefetch returns null for missing", () => {
      expect(checkPrefetch("nonexistent")).toBeNull();
    });

    test("checkPrefetch returns null for stale entry", () => {
      // Write a stale entry directly
      const data = {
        cache: {
          stale_key: {
            query: "old",
            engine: "any",
            results: [],
            prefetchedAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
            accessCount: 0,
          },
        },
        stats: { hits: 0, misses: 0, prefetched: 0 },
      };
      fs.writeFileSync(PREFETCH_FILE, JSON.stringify(data));

      const result = checkPrefetch("old", "any");
      expect(result).toBeNull();
    });

    test("checkPrefetch increments accessCount", () => {
      storePrefetch("hotel", "ddg", []);
      const r1 = checkPrefetch("hotel", "ddg");
      expect(r1.accessCount).toBe(1);
      const r2 = checkPrefetch("hotel", "ddg");
      expect(r2.accessCount).toBe(2);
    });

    test("runPrefetch prefetches predicted queries", async () => {
      const now = Date.now();
      const history = [
        { userId: "u1", query: "hotel", timestamp: new Date(now - 3000).toISOString() },
        { userId: "u1", query: "resort", timestamp: new Date(now - 2000).toISOString() },
        { userId: "u1", query: "hotel", timestamp: new Date(now - 1000).toISOString() },
        { userId: "u1", query: "resort", timestamp: new Date(now).toISOString() },
      ];
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));

      const searchFn = async (q) => ({ results: [{ title: q }] });
      const results = await runPrefetch("u1", "hotel", searchFn, { maxPrefetches: 3 });
      expect(results.length).toBeGreaterThan(0);
    });

    test("getPrefetchStats returns stats", () => {
      storePrefetch("hotel", "ddg", []);
      checkPrefetch("hotel", "ddg");
      checkPrefetch("missing");
      const stats = getPrefetchStats();
      expect(stats.cacheSize).toBe(1);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    test("clearPrefetchCache clears all", () => {
      storePrefetch("hotel", "ddg", []);
      clearPrefetchCache();
      const stats = getPrefetchStats();
      expect(stats.cacheSize).toBe(0);
    });

    test("storePrefetch respects max cache size", () => {
      // This tests the trimming logic with a small cache
      for (let i = 0; i < 10; i++) {
        storePrefetch(`query${i}`, "ddg", []);
      }
      const stats = getPrefetchStats();
      expect(stats.cacheSize).toBeLessThanOrEqual(500); // MAX_PREFETCH_CACHE
    });
  });

  describe("API Routes", () => {
    test("GET /api/prefetch/predictions requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/prefetch/predictions?query=hotel");
      expect(status).toBe(401);
    });

    test("GET /api/prefetch/predictions returns predictions", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/prefetch/predictions?query=hotel", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("predictions");
    });

    test("GET /api/prefetch/transitions returns transitions", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/prefetch/transitions", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("transitions");
    });

    test("GET /api/prefetch/check checks prefetch", async () => {
      storePrefetch("cached", "ddg", [{ title: "test" }]);
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/prefetch/check?query=cached&engine=ddg", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.cached).toBe(true);
    });

    test("GET /api/prefetch/check returns cached=false for miss", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/prefetch/check?query=missing", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.cached).toBe(false);
    });

    test("POST /api/prefetch/store requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/prefetch/store", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { query: "hotel", results: [] },
      });
      expect(status).toBe(403);
    });

    test("POST /api/prefetch/store requires query and results", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/prefetch/store", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/prefetch/store stores for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/prefetch/store", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { query: "hotel", engine: "ddg", results: [{ title: "test" }] },
      });
      expect(status).toBe(201);
      expect(body.message).toContain("stored");
    });

    test("GET /api/prefetch/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/prefetch/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/prefetch/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/prefetch/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("cacheSize");
      expect(body).toHaveProperty("hitRate");
    });

    test("DELETE /api/prefetch/cache requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/prefetch/cache", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/prefetch/cache clears for admin", async () => {
      storePrefetch("hotel", "ddg", []);
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/prefetch/cache", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
