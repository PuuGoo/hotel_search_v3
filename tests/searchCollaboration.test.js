import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import collaborationRoutes from "../routes/searchCollaboration.js";
import {
  createSession,
  joinSession,
  leaveSession,
  recordSearch,
  getActiveSessions,
  getSession,
  getCollaborationStats,
  clearCollaborationData,
} from "../utils/searchCollaboration.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "collaboration_data.json");

let dataBackup;

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
  app.use(collaborationRoutes);
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

describe("Search Collaboration", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearCollaborationData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("createSession creates a session", () => {
      const session = createSession({ name: "Test Session", userId: "user1" });
      expect(session).toHaveProperty("id");
      expect(session.name).toBe("Test Session");
      expect(session.participants).toContain("user1");
    });

    test("joinSession adds participant", () => {
      const session = createSession({ userId: "user1" });
      const result = joinSession(session.id, "user2");
      expect(result.participants).toContain("user2");
    });

    test("joinSession returns null for unknown session", () => {
      expect(joinSession("unknown", "user1")).toBeNull();
    });

    test("leaveSession removes participant", () => {
      const session = createSession({ userId: "user1" });
      joinSession(session.id, "user2");
      const result = leaveSession(session.id, "user2");
      expect(result).toBe(true);
    });

    test("leaveSession removes empty session", () => {
      const session = createSession({ userId: "user1" });
      leaveSession(session.id, "user1");
      expect(getActiveSessions().length).toBe(0);
    });

    test("recordSearch records a search", () => {
      const session = createSession({ userId: "user1" });
      const record = recordSearch(session.id, {
        userId: "user1",
        query: "hotel paris",
        engine: "tavily",
        resultCount: 5,
      });
      expect(record).toHaveProperty("query", "hotel paris");
      expect(record).toHaveProperty("timestamp");
    });

    test("recordSearch returns null for unknown session", () => {
      expect(recordSearch("unknown", { query: "test" })).toBeNull();
    });

    test("getActiveSessions returns sessions", () => {
      createSession({ name: "Session 1", userId: "user1" });
      createSession({ name: "Session 2", userId: "user2" });
      const sessions = getActiveSessions();
      expect(sessions.length).toBe(2);
    });

    test("getSession returns session details", () => {
      const created = createSession({ name: "Test", userId: "user1" });
      const session = getSession(created.id);
      expect(session.name).toBe("Test");
      expect(session).toHaveProperty("participants");
      expect(session).toHaveProperty("recentSearches");
    });

    test("getSession returns null for unknown", () => {
      expect(getSession("unknown")).toBeNull();
    });

    test("getCollaborationStats returns stats", () => {
      createSession({ userId: "user1" });
      const stats = getCollaborationStats();
      expect(stats.totalSessions).toBeGreaterThan(0);
      expect(stats).toHaveProperty("activeSessions");
    });

    test("clearCollaborationData clears all data", () => {
      createSession({ userId: "user1" });
      clearCollaborationData();
      expect(getActiveSessions().length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/collaboration/sessions requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/collaboration/sessions", {
        method: "POST",
        body: { name: "Test" },
      });
      expect(status).toBe(401);
    });

    test("POST /api/collaboration/sessions creates session", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/collaboration/sessions", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { name: "Test Session" },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("Test Session");
    });

    test("GET /api/collaboration/sessions requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/collaboration/sessions");
      expect(status).toBe(401);
    });

    test("GET /api/collaboration/sessions returns sessions", async () => {
      createSession({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/collaboration/sessions", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("POST /api/collaboration/sessions/:id/join joins session", async () => {
      const created = createSession({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/collaboration/sessions/${created.id}/join`, {
        method: "POST",
        headers: { "x-test-user": "user2" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("Joined");
    });

    test("POST /api/collaboration/sessions/:id/leave leaves session", async () => {
      const created = createSession({ userId: "user1" });
      joinSession(created.id, "user2");
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/collaboration/sessions/${created.id}/leave`, {
        method: "POST",
        headers: { "x-test-user": "user2" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("Left");
    });

    test("POST /api/collaboration/sessions/:id/search records search", async () => {
      const created = createSession({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/collaboration/sessions/${created.id}/search`, {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { query: "hotel paris", engine: "tavily" },
      });
      expect(status).toBe(201);
      expect(body.query).toBe("hotel paris");
    });

    test("GET /api/collaboration/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/collaboration/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/collaboration/stats returns stats for admin", async () => {
      createSession({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/collaboration/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalSessions");
    });

    test("DELETE /api/collaboration/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/collaboration/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/collaboration/clear clears for admin", async () => {
      createSession({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/collaboration/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
