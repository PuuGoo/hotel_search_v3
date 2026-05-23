import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import querySuggestionRoutes from "../routes/querySuggestions.js";
import { getSuggestions, expandQuery, getTrendingQueries } from "../utils/querySuggestions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");

let historyBackup;

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
  app.use(querySuggestionRoutes);
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

describe("Query Suggestions", () => {
  beforeEach(() => {
    try { historyBackup = fs.readFileSync(HISTORY_FILE, "utf8"); } catch { historyBackup = null; }
  });

  afterEach(() => {
    if (historyBackup) fs.writeFileSync(HISTORY_FILE, historyBackup);
  });

  describe("Utility functions", () => {
    test("getSuggestions returns empty for short prefix", () => {
      expect(getSuggestions("h", "user1")).toEqual([]);
      expect(getSuggestions("", "user1")).toEqual([]);
    });

    test("getSuggestions matches user history", () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date().toISOString() },
        { userId: "user1", query: "hotel london", timestamp: new Date().toISOString() },
      ]));
      const suggestions = getSuggestions("hotel", "user1");
      expect(suggestions.length).toBeGreaterThan(0);
    });

    test("getSuggestions includes modifier suggestions", () => {
      const suggestions = getSuggestions("luxury h", "user1");
      expect(suggestions.some((s) => s.source === "modifier" || s.source === "suffix")).toBe(true);
    });

    test("expandQuery expands abbreviations", () => {
      expect(expandQuery("hotel in NYC")).toContain("new york city");
      expect(expandQuery("hotel in SF")).toContain("san francisco");
      expect(expandQuery("hotel in LA")).toContain("los angeles");
    });

    test("expandQuery expands wifi", () => {
      expect(expandQuery("hotel with wifi")).toContain("wireless internet");
    });

    test("expandQuery returns original if no expansion", () => {
      expect(expandQuery("hotel paris")).toBe("hotel paris");
    });

    test("expandQuery handles null", () => {
      expect(expandQuery(null)).toBeNull();
    });

    test("getTrendingQueries returns trending", () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { query: "hotel paris", timestamp: new Date().toISOString() },
        { query: "hotel paris", timestamp: new Date().toISOString() },
        { query: "resort bali", timestamp: new Date().toISOString() },
      ]));
      const trending = getTrendingQueries(24, 10);
      expect(trending[0].query).toBe("hotel paris");
      expect(trending[0].count).toBe(2);
    });

    test("getTrendingQueries handles empty history", () => {
      fs.writeFileSync(HISTORY_FILE, "[]");
      expect(getTrendingQueries()).toEqual([]);
    });
  });

  describe("API Routes", () => {
    test("GET /api/suggestions/autocomplete requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/suggestions/autocomplete?q=hotel");
      expect(status).toBe(401);
    });

    test("GET /api/suggestions/autocomplete returns empty for short query", async () => {
      const app = createTestApp();
      const { body } = await makeRequest(app, "/api/suggestions/autocomplete?q=h", {
        headers: { "x-test-user": "user1" },
      });
      expect(body.suggestions).toEqual([]);
    });

    test("GET /api/suggestions/autocomplete returns suggestions", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/suggestions/autocomplete?q=hotel", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("suggestions");
      expect(body).toHaveProperty("query");
    });

    test("POST /api/suggestions/expand requires query", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/suggestions/expand", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/suggestions/expand expands query", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/suggestions/expand", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { query: "hotel in NYC" },
      });
      expect(status).toBe(200);
      expect(body.expanded).toContain("new york city");
      expect(body.changed).toBe(true);
    });

    test("POST /api/suggestions/expand returns unchanged for normal query", async () => {
      const app = createTestApp();
      const { body } = await makeRequest(app, "/api/suggestions/expand", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { query: "hotel paris" },
      });
      expect(body.changed).toBe(false);
    });

    test("GET /api/suggestions/trending requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/suggestions/trending");
      expect(status).toBe(401);
    });

    test("GET /api/suggestions/trending returns trending", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/suggestions/trending", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("trending");
      expect(body).toHaveProperty("period");
    });
  });
});
