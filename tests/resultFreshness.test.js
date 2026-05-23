import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import resultFreshnessRoutes from "../routes/resultFreshness.js";
import {
  extractDateHints,
  calculateFreshnessScore,
  scoreByFreshness,
  sortByFreshness,
  filterByFreshness,
  getFreshnessStats,
} from "../utils/resultFreshness.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    if (req.headers["x-test-user"]) {
      req.session.isAuthenticated = true;
      req.session.user = { id: req.headers["x-test-user"], role: "user" };
    }
    next();
  });
  app.use(resultFreshnessRoutes);
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

describe("Result Freshness", () => {
  describe("Utility functions", () => {
    test("extractDateHints finds explicit date fields", () => {
      const result = {
        title: "Test Hotel",
        date: "2026-05-20",
        publishedDate: "2026-05-19",
      };
      const hints = extractDateHints(result);
      expect(hints.length).toBeGreaterThanOrEqual(2);
      expect(hints.some((h) => h.source === "date")).toBe(true);
      expect(hints.some((h) => h.source === "publishedDate")).toBe(true);
    });

    test("extractDateHints finds ISO dates in text", () => {
      const result = {
        title: "Hotel updated on 2026-05-15",
        description: "Great hotel",
      };
      const hints = extractDateHints(result);
      expect(hints.some((h) => h.source === "text_iso")).toBe(true);
    });

    test("extractDateHints finds month year in text", () => {
      const result = {
        title: "Best hotels January 2026",
        description: "Updated listing",
      };
      const hints = extractDateHints(result);
      expect(hints.some((h) => h.source === "text_month_year")).toBe(true);
    });

    test("extractDateHints finds year in URL", () => {
      const result = {
        title: "Hotel Guide",
        url: "https://example.com/2026/hotel-guide",
      };
      const hints = extractDateHints(result);
      expect(hints.some((h) => h.source === "url_year")).toBe(true);
    });

    test("extractDateHints returns empty for no dates", () => {
      const result = {
        title: "Hotel without dates",
        description: "Nice place",
      };
      const hints = extractDateHints(result);
      expect(hints).toEqual([]);
    });

    test("calculateFreshnessScore gives high score for recent date", () => {
      const result = {
        title: "Recent Hotel",
        date: new Date().toISOString().split("T")[0],
      };
      const freshness = calculateFreshnessScore(result);
      expect(freshness.score).toBeGreaterThan(90);
      expect(freshness.source).toBe("date");
    });

    test("calculateFreshnessScore gives low score for old date", () => {
      const result = {
        title: "Old Hotel",
        date: "2020-01-01",
      };
      const freshness = calculateFreshnessScore(result);
      expect(freshness.score).toBeLessThan(10);
    });

    test("calculateFreshnessScore returns neutral for no dates", () => {
      const result = {
        title: "No Date Hotel",
        description: "Nice place",
      };
      const freshness = calculateFreshnessScore(result);
      expect(freshness.score).toBe(50);
      expect(freshness.source).toBe("none");
    });

    test("calculateFreshnessScore includes age in days", () => {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - 30);
      const result = {
        title: "30 Day Old Hotel",
        date: daysAgo.toISOString().split("T")[0],
      };
      const freshness = calculateFreshnessScore(result);
      expect(freshness.age).toBe(30);
    });

    test("scoreByFreshness adds freshness to results", () => {
      const results = [
        { title: "Recent", date: new Date().toISOString().split("T")[0] },
        { title: "Old", date: "2020-01-01" },
      ];
      const scored = scoreByFreshness(results);
      expect(scored.length).toBe(2);
      expect(scored[0]).toHaveProperty("freshness");
      expect(scored[0].freshness).toHaveProperty("score");
      expect(scored[0].freshness).toHaveProperty("bestDate");
      expect(scored[0].freshness).toHaveProperty("age");
    });

    test("scoreByFreshness handles non-array input", () => {
      expect(scoreByFreshness(null)).toBeNull();
      expect(scoreByFreshness(undefined)).toBeUndefined();
    });

    test("sortByFreshness sorts descending by default", () => {
      const results = [
        { title: "Old", date: "2020-01-01" },
        { title: "Recent", date: new Date().toISOString().split("T")[0] },
        { title: "Medium", date: "2025-01-01" },
      ];
      const sorted = sortByFreshness(results);
      expect(sorted[0].title).toBe("Recent");
      expect(sorted[sorted.length - 1].title).toBe("Old");
    });

    test("sortByFreshness sorts ascending when specified", () => {
      const results = [
        { title: "Recent", date: new Date().toISOString().split("T")[0] },
        { title: "Old", date: "2020-01-01" },
      ];
      const sorted = sortByFreshness(results, "asc");
      expect(sorted[0].title).toBe("Old");
    });

    test("filterByFreshness filters by minimum score", () => {
      const results = [
        { title: "Fresh", date: new Date().toISOString().split("T")[0] },
        { title: "Old", date: "2020-01-01" },
      ];
      const filtered = filterByFreshness(results, 80);
      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe("Fresh");
    });

    test("getFreshnessStats returns statistics", () => {
      const results = [
        { title: "Fresh", date: new Date().toISOString().split("T")[0] },
        { title: "Old", date: "2020-01-01" },
        { title: "No Date", description: "No date info" },
      ];
      const stats = getFreshnessStats(results);
      expect(stats).toHaveProperty("total");
      expect(stats).toHaveProperty("avgScore");
      expect(stats).toHaveProperty("distribution");
      expect(stats).toHaveProperty("dated");
      expect(stats).toHaveProperty("undated");
      expect(stats.total).toBe(3);
      expect(stats.dated).toBe(2);
      expect(stats.undated).toBe(1);
    });

    test("getFreshnessStats handles empty array", () => {
      const stats = getFreshnessStats([]);
      expect(stats.total).toBe(0);
      expect(stats.avgScore).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/freshness/score requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/freshness/score", {
        method: "POST",
        body: { result: { title: "Test" } },
      });
      expect(status).toBe(401);
    });

    test("POST /api/freshness/score requires result", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/freshness/score", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/freshness/score returns freshness", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/freshness/score", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { result: { title: "Test Hotel", date: "2026-05-20" } },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("freshness");
      expect(body.freshness).toHaveProperty("score");
    });

    test("POST /api/freshness/batch requires results array", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/freshness/batch", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/freshness/batch scores multiple results", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/freshness/batch", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {
          results: [
            { title: "Recent", date: "2026-05-20" },
            { title: "Old", date: "2020-01-01" },
          ],
        },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("results");
      expect(body).toHaveProperty("stats");
      expect(body.results.length).toBe(2);
    });

    test("POST /api/freshness/sort sorts results", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/freshness/sort", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {
          results: [
            { title: "Old", date: "2020-01-01" },
            { title: "Recent", date: "2026-05-20" },
          ],
        },
      });
      expect(status).toBe(200);
      expect(body.results[0].title).toBe("Recent");
    });

    test("POST /api/freshness/filter filters results", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/freshness/filter", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {
          results: [
            { title: "Fresh", date: new Date().toISOString().split("T")[0] },
            { title: "Old", date: "2020-01-01" },
          ],
          minScore: 80,
        },
      });
      expect(status).toBe(200);
      expect(body.results.length).toBe(1);
      expect(body.results[0].title).toBe("Fresh");
      expect(body.filter).toHaveProperty("passed");
    });

    test("POST /api/freshness/stats returns statistics", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/freshness/stats", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {
          results: [
            { title: "Hotel A", date: "2026-05-20" },
            { title: "Hotel B", date: "2025-01-01" },
          ],
        },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("avgScore");
      expect(body).toHaveProperty("distribution");
      expect(body.total).toBe(2);
    });
  });
});
