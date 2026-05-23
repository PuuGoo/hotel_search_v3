import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import dedupRoutes from "../routes/resultDedupV2.js";
import {
  deduplicateResults,
  findDuplicates,
  getDedupStats,
} from "../utils/resultDedupV2.js";

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
  app.use(dedupRoutes);
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

const sampleResults = [
  { title: "Hotel Paris Center", url: "https://booking.com/paris-center", snippet: "Luxury hotel in central Paris", price: 200 },
  { title: "Hotel Paris Center", url: "https://booking.com/paris-center", snippet: "Luxury hotel in central Paris", price: 200 }, // exact dup
  { title: "Paris Center Hotel", url: "https://booking.com/paris-center", snippet: "Hotel in Paris center location", price: 200 }, // near dup
  { title: "London Grand Hotel", url: "https://booking.com/london", snippet: "Historic hotel in London", price: 250 },
  { title: "London Grand", url: "https://booking.com/london-grand", snippet: "Grand hotel London", price: 250 }, // near dup of above
];

describe("Result Deduplication v2", () => {
  describe("Utility functions", () => {
    test("deduplicateResults removes exact duplicates", () => {
      const { unique, duplicates } = deduplicateResults(sampleResults, { threshold: 0.7 });
      expect(unique.length).toBeLessThan(sampleResults.length);
      expect(duplicates.length).toBeGreaterThan(0);
    });

    test("deduplicateResults keeps unique results", () => {
      const results = [
        { title: "Hotel A", url: "https://a.com", snippet: "First hotel" },
        { title: "Hotel B", url: "https://b.com", snippet: "Second hotel" },
        { title: "Hotel C", url: "https://c.com", snippet: "Third hotel" },
      ];
      const { unique } = deduplicateResults(results, { threshold: 0.7 });
      expect(unique.length).toBe(3);
    });

    test("deduplicateResults handles empty input", () => {
      const { unique, duplicates } = deduplicateResults([]);
      expect(unique).toEqual([]);
      expect(duplicates).toEqual([]);
    });

    test("deduplicateResults handles null input", () => {
      const { unique, duplicates } = deduplicateResults(null);
      expect(unique).toEqual([]);
      expect(duplicates).toEqual([]);
    });

    test("deduplicateResults respects threshold", () => {
      const results = [
        { title: "Hotel Paris", url: "https://a.com" },
        { title: "Paris Hotel", url: "https://b.com" },
      ];
      // High threshold = less deduplication
      const { unique: unique1 } = deduplicateResults(results, { threshold: 0.95 });
      expect(unique1.length).toBe(2);

      // Low threshold = more deduplication
      const { unique: unique2 } = deduplicateResults(results, { threshold: 0.3 });
      expect(unique2.length).toBe(1);
    });

    test("deduplicateResults adds metadata", () => {
      const { unique } = deduplicateResults(sampleResults, { threshold: 0.7 });
      expect(unique[0]).toHaveProperty("_dedupGroup");
      expect(unique[0]).toHaveProperty("_dedupIndices");
    });

    test("findDuplicates finds similar results", () => {
      const target = { title: "Hotel Paris Center", url: "https://booking.com/paris-center" };
      const duplicates = findDuplicates(target, sampleResults, { threshold: 0.7 });
      expect(duplicates.length).toBeGreaterThan(0);
      expect(duplicates[0]).toHaveProperty("similarity");
    });

    test("findDuplicates returns empty for no matches", () => {
      const target = { title: "Unique Hotel", url: "https://unique.com" };
      const results = [{ title: "Different", url: "https://different.com" }];
      const duplicates = findDuplicates(target, results, { threshold: 0.7 });
      expect(duplicates.length).toBe(0);
    });

    test("getDedupStats returns statistics", () => {
      const stats = getDedupStats(sampleResults, { threshold: 0.7 });
      expect(stats.totalResults).toBe(5);
      expect(stats.uniqueResults).toBeLessThan(5);
      expect(stats.duplicateCount).toBeGreaterThan(0);
      expect(stats).toHaveProperty("deduplicationRate");
    });

    test("getDedupStats handles empty input", () => {
      const stats = getDedupStats([]);
      expect(stats.totalResults).toBe(0);
      expect(stats.uniqueResults).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/dedup/results requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/dedup/results", {
        method: "POST",
        body: { results: [] },
      });
      expect(status).toBe(401);
    });

    test("POST /api/dedup/results requires results array", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/dedup/results", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/dedup/results returns deduplicated results", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/dedup/results", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { results: sampleResults, threshold: 0.7 },
      });
      expect(status).toBe(200);
      expect(body.unique.length).toBeLessThan(sampleResults.length);
      expect(body.stats.total).toBe(5);
    });

    test("POST /api/dedup/find requires target and results", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/dedup/find", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/dedup/find finds duplicates", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/dedup/find", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {
          target: { title: "Hotel Paris Center", url: "https://booking.com/paris-center" },
          results: sampleResults,
          threshold: 0.7,
        },
      });
      expect(status).toBe(200);
      expect(body.duplicates.length).toBeGreaterThan(0);
    });

    test("POST /api/dedup/stats returns stats", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/dedup/stats", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { results: sampleResults, threshold: 0.7 },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalResults");
      expect(body).toHaveProperty("uniqueResults");
    });
  });
});
