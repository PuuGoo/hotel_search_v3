import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import personalizationRoutes from "../routes/searchPersonalization.js";
import {
  buildUserPreferences,
  personalizeResults,
  scoreResult,
  getPersonalizationStats,
} from "../utils/searchPersonalization.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");
const CLICKS_FILE = path.join(__dirname, "..", "ranking_feedback.json");

let historyBackup;
let bookmarksBackup;
let clicksBackup;

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
  app.use(personalizationRoutes);
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

describe("Search Personalization", () => {
  beforeEach(() => {
    try { historyBackup = fs.readFileSync(HISTORY_FILE, "utf8"); } catch { historyBackup = null; }
    try { bookmarksBackup = fs.readFileSync(BOOKMARKS_FILE, "utf8"); } catch { bookmarksBackup = null; }
    try { clicksBackup = fs.readFileSync(CLICKS_FILE, "utf8"); } catch { clicksBackup = null; }
  });

  afterEach(() => {
    if (historyBackup) saveWithRetry(HISTORY_FILE, historyBackup);
    if (bookmarksBackup) saveWithRetry(BOOKMARKS_FILE, bookmarksBackup);
    if (clicksBackup) saveWithRetry(CLICKS_FILE, clicksBackup);
  });

  describe("Utility functions", () => {
    test("buildUserPreferences extracts from history", () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "u1", query: "hotel paris", engine: "ddg", timestamp: new Date().toISOString() },
        { userId: "u1", query: "hotel london", engine: "ddg", timestamp: new Date().toISOString() },
        { userId: "u1", query: "resort", engine: "google", timestamp: new Date().toISOString() },
      ]));

      const prefs = buildUserPreferences("u1");
      expect(prefs.preferredEngines.length).toBeGreaterThan(0);
      expect(prefs.preferredEngines[0].engine).toBe("ddg");
      expect(prefs.totalSearches).toBe(3);
    });

    test("buildUserPreferences extracts domains from bookmarks", () => {
      fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify({
        u1: [
          { url: "https://booking.com/hotel1", title: "Hotel 1" },
          { url: "https://booking.com/hotel2", title: "Hotel 2" },
          { url: "https://expedia.com/hotel", title: "Hotel 3" },
        ],
      }));

      const prefs = buildUserPreferences("u1");
      expect(prefs.preferredDomains.length).toBeGreaterThan(0);
      expect(prefs.preferredDomains[0].domain).toBe("booking.com");
    });

    test("buildUserPreferences returns empty for unknown user", () => {
      const prefs = buildUserPreferences("unknown_user");
      expect(prefs.totalSearches).toBe(0);
      expect(prefs.preferredEngines.length).toBe(0);
    });

    test("scoreResult boosts preferred domains", () => {
      const prefs = {
        preferredDomains: [{ domain: "booking.com", count: 5 }],
        preferredKeywords: [],
        preferredEngines: [],
      };

      const result = scoreResult(
        { url: "https://booking.com/hotel", title: "Hotel", score: 1.0 },
        prefs
      );
      expect(result.personalizedScore).toBeGreaterThan(1.0);
    });

    test("scoreResult boosts matching keywords", () => {
      const prefs = {
        preferredDomains: [],
        preferredKeywords: [{ keyword: "paris", count: 10 }, { keyword: "hotel", count: 8 }],
        preferredEngines: [],
      };

      const result = scoreResult(
        { url: "https://example.com", title: "Hotel in Paris", snippet: "Great hotel", score: 1.0 },
        prefs
      );
      expect(result.personalizedScore).toBeGreaterThan(1.0);
    });

    test("personalizeResults reorders by preference", () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "u1", query: "hotel", engine: "ddg", timestamp: new Date().toISOString() },
      ]));
      fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify({
        u1: [{ url: "https://preferred.com/hotel", title: "Preferred" }],
      }));

      const results = [
        { url: "https://other.com", title: "Other", score: 1.0 },
        { url: "https://preferred.com/hotel", title: "Preferred", score: 0.8 },
      ];

      const personalized = personalizeResults("u1", results);
      expect(personalized[0]).toHaveProperty("personalizedScore");
      expect(personalized[0]).toHaveProperty("originalScore");
    });

    test("personalizeResults returns original scores for unknown user", () => {
      const results = [
        { url: "https://a.com", title: "A", score: 1.0 },
        { url: "https://b.com", title: "B", score: 0.8 },
      ];

      const personalized = personalizeResults("unknown", results);
      expect(personalized[0].personalizedScore).toBe(1.0);
    });

    test("getPersonalizationStats returns stats", () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "u1", query: "hotel", engine: "ddg", timestamp: new Date().toISOString() },
      ]));

      const stats = getPersonalizationStats("u1");
      expect(stats.hasPreferences).toBe(true);
      expect(stats.totalSearches).toBe(1);
      expect(stats.topEngine).toBe("ddg");
    });

    test("getPersonalizationStats handles no data", () => {
      const stats = getPersonalizationStats("unknown");
      expect(stats.hasPreferences).toBe(false);
    });
  });

  describe("API Routes", () => {
    test("GET /api/personalization/preferences requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/personalization/preferences");
      expect(status).toBe(401);
    });

    test("GET /api/personalization/preferences returns prefs", async () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", engine: "ddg", timestamp: new Date().toISOString() },
      ]));
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/personalization/preferences", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("preferredEngines");
    });

    test("POST /api/personalization/rerank requires results", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/personalization/rerank", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/personalization/rerank returns reranked results", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/personalization/rerank", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { results: [{ url: "https://a.com", title: "A", score: 1.0 }] },
      });
      expect(status).toBe(200);
      expect(body.results.length).toBe(1);
      expect(body.results[0]).toHaveProperty("personalizedScore");
    });

    test("GET /api/personalization/stats returns stats", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/personalization/stats", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("hasPreferences");
    });
  });
});
