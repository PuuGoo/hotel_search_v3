import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import collaborativeRoutes from "../routes/collaborativeFiltering.js";
import {
  findSimilarUsers,
  getRecommendations,
  getCollaborativeStats,
} from "../utils/collaborativeFiltering.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");

let historyBackup;
let bookmarksBackup;

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
  app.use(collaborativeRoutes);
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

describe("Collaborative Filtering", () => {
  beforeEach(() => {
    try { historyBackup = fs.readFileSync(HISTORY_FILE, "utf8"); } catch { historyBackup = null; }
    try { bookmarksBackup = fs.readFileSync(BOOKMARKS_FILE, "utf8"); } catch { bookmarksBackup = null; }
  });

  afterEach(() => {
    if (historyBackup) fs.writeFileSync(HISTORY_FILE, historyBackup);
    else { try { fs.unlinkSync(HISTORY_FILE); } catch {} }
    if (bookmarksBackup) fs.writeFileSync(BOOKMARKS_FILE, bookmarksBackup);
    else { try { fs.unlinkSync(BOOKMARKS_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("findSimilarUsers returns empty for user with no history", () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "other", query: "hotel paris", timestamp: new Date().toISOString() },
      ]));
      expect(findSimilarUsers("newuser")).toEqual([]);
    });

    test("findSimilarUsers finds similar users", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString() },
        { userId: "user2", query: "hotel paris cheap", timestamp: new Date(now).toISOString() },
        { userId: "user3", query: "resort bali", timestamp: new Date(now).toISOString() },
      ]));
      const similar = findSimilarUsers("user1");
      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0]).toHaveProperty("userId");
      expect(similar[0]).toHaveProperty("similarity");
    });

    test("findSimilarUsers respects maxSimilar", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
        { userId: "user2", query: "hotel paris", timestamp: new Date(now).toISOString() },
        { userId: "user3", query: "hotel london", timestamp: new Date(now).toISOString() },
        { userId: "user4", query: "hotel rome", timestamp: new Date(now).toISOString() },
      ]));
      const similar = findSimilarUsers("user1", 2);
      expect(similar.length).toBeLessThanOrEqual(2);
    });

    test("getRecommendations returns empty for no similar users", () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", timestamp: new Date().toISOString() },
      ]));
      const recs = getRecommendations("user1");
      expect(recs.totalRecommendations).toBe(0);
    });

    test("getRecommendations returns recommendations from similar users", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString() },
        { userId: "user2", query: "hotel paris cheap", timestamp: new Date(now).toISOString() },
      ]));
      fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify({
        user2: [{ url: "https://example.com/hotel", title: "Test Hotel" }],
      }));
      const recs = getRecommendations("user1");
      expect(recs).toHaveProperty("urlRecommendations");
      expect(recs).toHaveProperty("queryRecommendations");
      expect(recs).toHaveProperty("similarUsers");
    });

    test("getRecommendations excludes already bookmarked", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString() },
        { userId: "user2", query: "hotel paris", timestamp: new Date(now).toISOString() },
      ]));
      fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify({
        user1: [{ url: "https://example.com/hotel" }],
        user2: [{ url: "https://example.com/hotel" }],
      }));
      const recs = getRecommendations("user1");
      expect(recs.urlRecommendations.some((r) => r.url === "https://example.com/hotel")).toBe(false);
    });

    test("getCollaborativeStats returns statistics", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
        { userId: "user2", query: "resort", timestamp: new Date(now).toISOString() },
      ]));
      const stats = getCollaborativeStats();
      expect(stats.totalUsers).toBe(2);
      expect(stats.totalSearches).toBe(2);
      expect(stats).toHaveProperty("avgSimilarity");
    });

    test("getCollaborativeStats handles empty history", () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));
      const stats = getCollaborativeStats();
      expect(stats.totalUsers).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("GET /api/collaborative/similar requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/collaborative/similar");
      expect(status).toBe(401);
    });

    test("GET /api/collaborative/similar returns similar users", async () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString() },
        { userId: "user2", query: "hotel paris cheap", timestamp: new Date(now).toISOString() },
      ]));
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/collaborative/similar", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("users");
      expect(body).toHaveProperty("count");
    });

    test("GET /api/collaborative/recommendations requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/collaborative/recommendations");
      expect(status).toBe(401);
    });

    test("GET /api/collaborative/recommendations returns recommendations", async () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString() },
        { userId: "user2", query: "hotel paris cheap", timestamp: new Date(now).toISOString() },
      ]));
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/collaborative/recommendations", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("urlRecommendations");
      expect(body).toHaveProperty("queryRecommendations");
      expect(body).toHaveProperty("similarUsers");
    });

    test("GET /api/collaborative/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/collaborative/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/collaborative/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/collaborative/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalUsers");
      expect(body).toHaveProperty("totalSearches");
    });
  });
});
