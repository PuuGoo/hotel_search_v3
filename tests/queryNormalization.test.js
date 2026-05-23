import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import normalizationRoutes from "../routes/queryNormalization.js";
import {
  normalizeQuery,
  generateCacheKey,
  areQueriesEquivalent,
  batchNormalize,
  getNormalizationStats,
  getNormalizationOptions,
} from "../utils/queryNormalization.js";

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
  app.use(normalizationRoutes);
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

describe("Query Normalization", () => {
  describe("Utility functions", () => {
    test("normalizeQuery lowercases", () => {
      const result = normalizeQuery("HOTEL Paris");
      expect(result.normalized).toBe("hotel paris");
      expect(result.changed).toBe(true);
    });

    test("normalizeQuery trims whitespace", () => {
      const result = normalizeQuery("  hotel paris  ");
      expect(result.normalized).toBe("hotel paris");
      expect(result.changed).toBe(true);
    });

    test("normalizeQuery removes extra spaces", () => {
      const result = normalizeQuery("hotel   paris   france");
      expect(result.normalized).toBe("hotel paris france");
    });

    test("normalizeQuery removes stop words", () => {
      const result = normalizeQuery("a hotel in the paris", { removeStopWords: true });
      expect(result.normalized).toBe("hotel paris");
    });

    test("normalizeQuery expands abbreviations", () => {
      const result = normalizeQuery("hotel on main st", { expandAbbreviations: true });
      expect(result.normalized).toBe("hotel on main street");
    });

    test("normalizeQuery applies synonyms", () => {
      const result = normalizeQuery("hotels in paris", { applySynonyms: true });
      expect(result.normalized).toBe("hotel in paris");
    });

    test("normalizeQuery removes punctuation", () => {
      const result = normalizeQuery("hotel-paris, france!", { removePunctuation: true });
      expect(result.normalized).toBe("hotel paris france");
    });

    test("normalizeQuery handles empty input", () => {
      const result = normalizeQuery("");
      expect(result.normalized).toBe("");
      expect(result.changed).toBe(false);
    });

    test("normalizeQuery handles null input", () => {
      const result = normalizeQuery(null);
      expect(result.normalized).toBe("");
      expect(result.changed).toBe(false);
    });

    test("generateCacheKey generates consistent keys", () => {
      const key1 = generateCacheKey("Hotel Paris");
      const key2 = generateCacheKey("hotel paris");
      expect(key1).toBe(key2);
    });

    test("areQueriesEquivalent detects equivalent queries", () => {
      expect(areQueriesEquivalent("Hotel Paris", "hotel paris")).toBe(true);
      expect(areQueriesEquivalent("Hotel Paris", "London Hotel")).toBe(false);
    });

    test("batchNormalize normalizes multiple queries", () => {
      const results = batchNormalize(["HOTEL", "  PARIS  ", "resort"]);
      expect(results.length).toBe(3);
      expect(results[0].normalized).toBe("hotel");
    });

    test("getNormalizationStats returns stats", () => {
      const stats = getNormalizationStats(["HOTEL", "hotel", "  PARIS  "]);
      expect(stats.total).toBe(3);
      expect(stats.changed).toBe(2);
      expect(stats.unique).toBe(2);
    });

    test("getNormalizationOptions returns options", () => {
      const options = getNormalizationOptions();
      expect(options).toHaveProperty("lowercase");
      expect(options).toHaveProperty("removeStopWords");
    });
  });

  describe("API Routes", () => {
    test("POST /api/normalize/query requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/normalize/query", {
        method: "POST",
        body: { query: "hotel" },
      });
      expect(status).toBe(401);
    });

    test("POST /api/normalize/query requires query", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/normalize/query", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/normalize/query normalizes query", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/normalize/query", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { query: "HOTEL Paris" },
      });
      expect(status).toBe(200);
      expect(body.normalized).toBe("hotel paris");
    });

    test("POST /api/normalize/batch requires queries array", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/normalize/batch", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/normalize/batch normalizes batch", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/normalize/batch", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { queries: ["HOTEL", "PARIS"] },
      });
      expect(status).toBe(200);
      expect(body.results.length).toBe(2);
    });

    test("POST /api/normalize/equivalent checks equivalence", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/normalize/equivalent", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { query1: "HOTEL", query2: "hotel" },
      });
      expect(status).toBe(200);
      expect(body.equivalent).toBe(true);
    });

    test("POST /api/normalize/cache-key generates key", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/normalize/cache-key", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { query: "HOTEL Paris" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("key");
    });

    test("POST /api/normalize/stats returns stats", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/normalize/stats", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { queries: ["HOTEL", "hotel"] },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("total");
    });

    test("GET /api/normalize/options returns options", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/normalize/options", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("lowercase");
    });
  });
});
