import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sessionRoutes from "../routes/sessionRecommendations.js";
import {
  getSessionHistory,
  getSessionContext,
  getSessionRecommendations,
  getSessionStats,
} from "../utils/sessionRecommendations.js";

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
  app.use(sessionRoutes);
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

describe("Session Recommendations", () => {
  beforeEach(() => {
    try { historyBackup = fs.readFileSync(HISTORY_FILE, "utf8"); } catch { historyBackup = null; }
    try { bookmarksBackup = fs.readFileSync(BOOKMARKS_FILE, "utf8"); } catch { bookmarksBackup = null; }
  });

  afterEach(() => {
    if (historyBackup) saveWithRetry(HISTORY_FILE, historyBackup);
    if (bookmarksBackup) saveWithRetry(BOOKMARKS_FILE, bookmarksBackup);
  });

  describe("Utility functions", () => {
    test("getSessionHistory returns recent searches", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "u1", query: "hotel paris", engine: "ddg", timestamp: new Date(now - 1000).toISOString() },
        { userId: "u1", query: "resort", engine: "google", timestamp: new Date(now).toISOString() },
        { userId: "u2", query: "other", engine: "ddg", timestamp: new Date(now).toISOString() },
      ]));

      const history = getSessionHistory("u1");
      expect(history.length).toBe(2);
    });

    test("getSessionHistory excludes old entries", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "u1", query: "old", engine: "ddg", timestamp: new Date(now - 60 * 60 * 1000).toISOString() },
        { userId: "u1", query: "recent", engine: "ddg", timestamp: new Date(now).toISOString() },
      ]));

      const history = getSessionHistory("u1");
      expect(history.length).toBe(1);
      expect(history[0].query).toBe("recent");
    });

    test("getSessionContext returns context", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "u1", query: "hotel in paris", engine: "ddg", timestamp: new Date(now - 1000).toISOString() },
        { userId: "u1", query: "paris resort", engine: "ddg", timestamp: new Date(now).toISOString() },
      ]));

      const context = getSessionContext("u1");
      expect(context.active).toBe(true);
      expect(context.queryCount).toBe(2);
      expect(context.topics.length).toBeGreaterThan(0);
    });

    test("getSessionContext returns inactive for no session", () => {
      const context = getSessionContext("unknown");
      expect(context.active).toBe(false);
    });

    test("getSessionRecommendations returns recommendations", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "u1", query: "hotel paris", engine: "ddg", timestamp: new Date(now).toISOString() },
        { userId: "u2", query: "hotel paris cheap", engine: "google", timestamp: new Date(now).toISOString() },
      ]));

      const result = getSessionRecommendations("u1");
      expect(result).toHaveProperty("recommendations");
      expect(result).toHaveProperty("context");
    });

    test("getSessionRecommendations returns empty for no session", () => {
      const result = getSessionRecommendations("unknown");
      expect(result.recommendations).toEqual([]);
    });

    test("getSessionStats returns stats", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "u1", query: "hotel", engine: "ddg", timestamp: new Date(now).toISOString() },
      ]));

      const stats = getSessionStats("u1");
      expect(stats.active).toBe(true);
      expect(stats.queryCount).toBe(1);
    });

    test("getSessionStats handles no session", () => {
      const stats = getSessionStats("unknown");
      expect(stats.active).toBe(false);
    });
  });

  describe("API Routes", () => {
    test("GET /api/session/history requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/session/history");
      expect(status).toBe(401);
    });

    test("GET /api/session/history returns history", async () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", engine: "ddg", timestamp: new Date(now).toISOString() },
      ]));
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/session/history", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("history");
    });

    test("GET /api/session/context returns context", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/session/context", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("active");
    });

    test("GET /api/session/recommendations returns recommendations", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/session/recommendations", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("recommendations");
    });

    test("GET /api/session/stats returns stats", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/session/stats", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("active");
    });
  });
});
