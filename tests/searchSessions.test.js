import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import searchSessionRoutes from "../routes/searchSessions.js";
import {
  groupSearchSessions,
  getSessionSummary,
  getSession,
  getSessionStats,
  saveSession,
  getSavedSessions,
  deleteSavedSession,
} from "../utils/searchSessions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const SESSIONS_FILE = path.join(__dirname, "..", "search_sessions.json");

let historyBackup;
let sessionsBackup;

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
  app.use(searchSessionRoutes);
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

function createHistory(entries) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries));
}

function createSessionsFile(entries) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(entries));
}

describe("Search Sessions", () => {
  beforeEach(() => {
    try { historyBackup = fs.readFileSync(HISTORY_FILE, "utf8"); } catch { historyBackup = null; }
    try { sessionsBackup = fs.readFileSync(SESSIONS_FILE, "utf8"); } catch { sessionsBackup = null; }
  });

  afterEach(() => {
    if (historyBackup) fs.writeFileSync(HISTORY_FILE, historyBackup);
    else { try { fs.unlinkSync(HISTORY_FILE); } catch { /* ignore */ } }
    if (sessionsBackup) fs.writeFileSync(SESSIONS_FILE, sessionsBackup);
    else { try { fs.unlinkSync(SESSIONS_FILE); } catch { /* ignore */ } }
  });

  describe("Utility functions", () => {
    test("groupSearchSessions groups by time proximity", () => {
      const now = Date.now();
      createHistory([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now - 120000).toISOString(), engine: "ddg" },
        { userId: "user1", query: "hotel paris cheap", timestamp: new Date(now - 60000).toISOString(), engine: "ddg" },
        { userId: "user1", query: "paris hotel deals", timestamp: new Date(now).toISOString(), engine: "google" },
        // Long gap = new session
        { userId: "user1", query: "resort bali", timestamp: new Date(now + 60 * 60 * 1000).toISOString(), engine: "tavily" },
      ]);

      const sessions = groupSearchSessions("user1");
      expect(sessions.length).toBeGreaterThanOrEqual(2);
      expect(sessions[0].searchCount).toBe(1); // Most recent first
      expect(sessions[1].searchCount).toBe(3);
    });

    test("groupSearchSessions returns empty for no history", () => {
      createHistory([]);
      expect(groupSearchSessions("user1")).toEqual([]);
    });

    test("groupSearchSessions filters by userId", () => {
      const now = Date.now();
      createHistory([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
        { userId: "user2", query: "resort", timestamp: new Date(now).toISOString() },
      ]);

      const sessions = groupSearchSessions("user1");
      expect(sessions.length).toBe(1);
      expect(sessions[0].searches[0].query).toBe("hotel");
    });

    test("groupSearchSessions enriches with metadata", () => {
      const now = Date.now();
      createHistory([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString(), engine: "ddg" },
        { userId: "user1", query: "paris hotels", timestamp: new Date(now + 60000).toISOString(), engine: "google" },
      ]);

      const sessions = groupSearchSessions("user1");
      expect(sessions[0]).toHaveProperty("id");
      expect(sessions[0]).toHaveProperty("userId");
      expect(sessions[0]).toHaveProperty("queries");
      expect(sessions[0]).toHaveProperty("searchCount");
      expect(sessions[0]).toHaveProperty("engines");
      expect(sessions[0]).toHaveProperty("startTime");
      expect(sessions[0]).toHaveProperty("endTime");
      expect(sessions[0]).toHaveProperty("duration");
    });

    test("getSessionSummary returns summaries without searches", () => {
      const now = Date.now();
      createHistory([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
      ]);

      const summaries = getSessionSummary("user1");
      expect(summaries.length).toBe(1);
      expect(summaries[0]).not.toHaveProperty("searches");
      expect(summaries[0]).toHaveProperty("searchCount");
    });

    test("getSession returns specific session", () => {
      const now = Date.now();
      createHistory([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString() },
        { userId: "user1", query: "paris cheap", timestamp: new Date(now + 60000).toISOString() },
      ]);

      const sessions = groupSearchSessions("user1");
      const session = getSession("user1", sessions[0].id);
      expect(session).not.toBeNull();
      expect(session.id).toBe(sessions[0].id);
    });

    test("getSession returns null for nonexistent", () => {
      createHistory([]);
      expect(getSession("user1", "nonexistent")).toBeNull();
    });

    test("getSessionStats returns statistics", () => {
      const now = Date.now();
      createHistory([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString(), engine: "ddg" },
        { userId: "user1", query: "hotel london", timestamp: new Date(now + 60000).toISOString(), engine: "google" },
      ]);

      const stats = getSessionStats("user1");
      expect(stats).toHaveProperty("totalSessions");
      expect(stats).toHaveProperty("totalSearches");
      expect(stats).toHaveProperty("avgSearchesPerSession");
      expect(stats).toHaveProperty("avgSessionDuration");
      expect(stats).toHaveProperty("topQueries");
      expect(stats).toHaveProperty("topEngines");
      expect(stats.totalSearches).toBe(2);
    });

    test("getSessionStats handles empty history", () => {
      createHistory([]);
      const stats = getSessionStats("user1");
      expect(stats.totalSessions).toBe(0);
      expect(stats.totalSearches).toBe(0);
    });

    test("saveSession saves a session", () => {
      const now = Date.now();
      createHistory([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString() },
      ]);

      const sessions = groupSearchSessions("user1");
      const saved = saveSession("user1", sessions[0].id, "Paris Trip");
      expect(saved).not.toBeNull();
      expect(saved.name).toBe("Paris Trip");
      expect(saved.userId).toBe("user1");
    });

    test("saveSession returns null for nonexistent session", () => {
      createHistory([]);
      createSessionsFile([]);
      expect(saveSession("user1", "nonexistent")).toBeNull();
    });

    test("getSavedSessions returns saved sessions", () => {
      const now = Date.now();
      createHistory([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
      ]);

      const sessions = groupSearchSessions("user1");
      saveSession("user1", sessions[0].id, "Test Session");

      const saved = getSavedSessions("user1");
      expect(saved.length).toBe(1);
      expect(saved[0].name).toBe("Test Session");
    });

    test("deleteSavedSession deletes a saved session", () => {
      const now = Date.now();
      createHistory([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
      ]);

      const sessions = groupSearchSessions("user1");
      saveSession("user1", sessions[0].id, "To Delete");

      const deleted = deleteSavedSession("user1", sessions[0].id);
      expect(deleted).toBe(true);
      expect(getSavedSessions("user1").length).toBe(0);
    });

    test("deleteSavedSession returns false for nonexistent", () => {
      createSessionsFile([]);
      expect(deleteSavedSession("user1", "nonexistent")).toBe(false);
    });
  });

  describe("API Routes", () => {
    test("GET /api/sessions requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/sessions");
      expect(status).toBe(401);
    });

    test("GET /api/sessions returns sessions", async () => {
      const now = Date.now();
      createHistory([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
      ]);

      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/sessions", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("sessions");
      expect(body).toHaveProperty("count");
    });

    test("GET /api/sessions/summary returns summaries", async () => {
      const now = Date.now();
      createHistory([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
      ]);

      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/sessions/summary", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("sessions");
      expect(body.sessions.length).toBe(1);
    });

    test("GET /api/sessions/stats returns statistics", async () => {
      const now = Date.now();
      createHistory([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
      ]);

      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/sessions/stats", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalSessions");
      expect(body).toHaveProperty("totalSearches");
    });

    test("GET /api/sessions/saved returns saved sessions", async () => {
      createSessionsFile([
        { userId: "user1", sessionId: "s1", name: "Test", savedAt: new Date().toISOString() },
      ]);

      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/sessions/saved", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("sessions");
      expect(body.sessions.length).toBe(1);
    });

    test("GET /api/sessions/:sessionId returns 404 for nonexistent", async () => {
      createHistory([]);
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/sessions/nonexistent", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(404);
    });

    test("POST /api/sessions/:sessionId/save saves session", async () => {
      const now = Date.now();
      createHistory([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
      ]);

      const sessions = groupSearchSessions("user1");
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/sessions/${sessions[0].id}/save`, {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { name: "My Session" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("My Session");
    });

    test("DELETE /api/sessions/saved/:sessionId deletes saved session", async () => {
      createSessionsFile([
        { userId: "user1", sessionId: "s1", name: "Test", savedAt: new Date().toISOString() },
      ]);

      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/sessions/saved/s1", {
        method: "DELETE",
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
    });

    test("DELETE /api/sessions/saved/:sessionId returns 404 for nonexistent", async () => {
      createSessionsFile([]);
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/sessions/saved/nonexistent", {
        method: "DELETE",
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(404);
    });
  });
});
