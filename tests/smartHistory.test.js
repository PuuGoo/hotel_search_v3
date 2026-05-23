import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import smartHistoryRoutes from "../routes/smartHistory.js";
import {
  analyzeSearchPatterns,
  predictNextQueries,
  getSearchInsights,
} from "../utils/smartHistory.js";

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
  app.use(smartHistoryRoutes);
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

describe("Smart History", () => {
  beforeEach(() => {
    try { historyBackup = fs.readFileSync(HISTORY_FILE, "utf8"); } catch { historyBackup = null; }
  });

  afterEach(() => {
    if (historyBackup) fs.writeFileSync(HISTORY_FILE, historyBackup);
    else { try { fs.unlinkSync(HISTORY_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("analyzeSearchPatterns returns empty for insufficient data", () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", timestamp: new Date().toISOString() },
      ]));
      const analysis = analyzeSearchPatterns("user1");
      expect(analysis.patterns).toEqual([]);
      expect(analysis.predictions).toEqual([]);
      expect(analysis.stats.totalSearches).toBe(1);
    });

    test("analyzeSearchPatterns finds sequential patterns", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now - 300000).toISOString() },
        { userId: "user1", query: "hotel london", timestamp: new Date(now - 200000).toISOString() },
        { userId: "user1", query: "hotel paris", timestamp: new Date(now - 100000).toISOString() },
        { userId: "user1", query: "hotel london", timestamp: new Date(now).toISOString() },
      ]));
      const analysis = analyzeSearchPatterns("user1", { minPatternOccurrences: 2 });
      expect(analysis.patterns.length).toBeGreaterThan(0);
      expect(analysis.patterns[0].type).toBe("sequence");
    });

    test("analyzeSearchPatterns finds time patterns", () => {
      const morning = new Date();
      morning.setHours(9, 0, 0, 0);
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "morning hotel", timestamp: morning.toISOString() },
        { userId: "user1", query: "morning hotel", timestamp: new Date(morning.getTime() + 86400000).toISOString() },
        { userId: "user1", query: "morning hotel", timestamp: new Date(morning.getTime() + 172800000).toISOString() },
      ]));
      const analysis = analyzeSearchPatterns("user1", { minPatternOccurrences: 2 });
      const timePattern = analysis.patterns.find((p) => p.type === "time");
      expect(timePattern).toBeDefined();
      expect(timePattern.timeSlot).toBe("morning");
    });

    test("predictNextQueries returns empty for insufficient data", () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", timestamp: new Date().toISOString() },
      ]));
      expect(predictNextQueries("user1")).toEqual([]);
    });

    test("predictNextQueries predicts based on sequence", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now - 200000).toISOString() },
        { userId: "user1", query: "hotel london", timestamp: new Date(now - 100000).toISOString() },
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString() },
      ]));
      const predictions = predictNextQueries("user1", "hotel paris", { maxPredictions: 3 });
      expect(predictions.length).toBeGreaterThan(0);
      expect(predictions[0]).toHaveProperty("query");
      expect(predictions[0]).toHaveProperty("confidence");
      expect(predictions[0]).toHaveProperty("reason");
    });

    test("predictNextQueries includes recent queries", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now - 200000).toISOString() },
        { userId: "user1", query: "hotel london", timestamp: new Date(now - 100000).toISOString() },
        { userId: "user1", query: "hotel rome", timestamp: new Date(now).toISOString() },
      ]));
      const predictions = predictNextQueries("user1", null, { maxPredictions: 5 });
      expect(predictions.some((p) => p.type === "recent")).toBe(true);
    });

    test("getSearchInsights returns insights", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now - 200000).toISOString(), engine: "ddg" },
        { userId: "user1", query: "hotel london", timestamp: new Date(now - 100000).toISOString(), engine: "ddg" },
        { userId: "user1", query: "hotel rome", timestamp: new Date(now).toISOString(), engine: "google" },
      ]));
      const insights = getSearchInsights("user1");
      expect(insights.totalSearches).toBe(3);
      expect(insights.insights.length).toBeGreaterThan(0);
      expect(insights.insights.some((i) => i.type === "favorite_engine")).toBe(true);
    });

    test("getSearchInsights handles empty history", () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));
      const insights = getSearchInsights("user1");
      expect(insights.totalSearches).toBe(0);
      expect(insights.insights).toEqual([]);
    });
  });

  describe("API Routes", () => {
    test("GET /api/smart-history/patterns requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/smart-history/patterns");
      expect(status).toBe(401);
    });

    test("GET /api/smart-history/patterns returns patterns", async () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now - 200000).toISOString() },
        { userId: "user1", query: "hotel london", timestamp: new Date(now - 100000).toISOString() },
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString() },
      ]));
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/smart-history/patterns", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("patterns");
      expect(body).toHaveProperty("stats");
    });

    test("GET /api/smart-history/predictions requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/smart-history/predictions");
      expect(status).toBe(401);
    });

    test("GET /api/smart-history/predictions returns predictions", async () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now - 200000).toISOString() },
        { userId: "user1", query: "hotel london", timestamp: new Date(now - 100000).toISOString() },
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString() },
      ]));
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/smart-history/predictions?currentQuery=hotel%20paris", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("predictions");
      expect(body).toHaveProperty("count");
    });

    test("GET /api/smart-history/insights requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/smart-history/insights");
      expect(status).toBe(401);
    });

    test("GET /api/smart-history/insights returns insights", async () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString(), engine: "ddg" },
      ]));
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/smart-history/insights", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalSearches");
      expect(body).toHaveProperty("insights");
    });
  });
});
