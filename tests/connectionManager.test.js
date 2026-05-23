import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import connectionRoutes from "../routes/connectionManager.js";
import {
  registerConnection,
  unregisterConnection,
  getActiveConnections,
  getConnection,
  getUserConnectionCount,
  disconnectUser,
  getConnectionStats,
  getConnectionHistory,
  clearConnectionData,
  cleanupStale,
} from "../utils/connectionManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "connection_manager.json");

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
  app.use(connectionRoutes);
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

describe("Connection Manager", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearConnectionData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("registerConnection registers a connection", () => {
      const conn = registerConnection({ userId: "user1", type: "websocket" });
      expect(conn).toHaveProperty("id");
      expect(conn.userId).toBe("user1");
      expect(conn.type).toBe("websocket");
    });

    test("registerConnection enforces per-user limit", () => {
      for (let i = 0; i < 5; i++) registerConnection({ userId: "user1" });
      const result = registerConnection({ userId: "user1" });
      expect(result.error).toContain("Max connections");
    });

    test("unregisterConnection unregisters a connection", () => {
      const conn = registerConnection({ userId: "user1" });
      expect(unregisterConnection(conn.id)).toBe(true);
      expect(getConnection(conn.id)).toBeNull();
    });

    test("unregisterConnection returns false for unknown", () => {
      expect(unregisterConnection("unknown")).toBe(false);
    });

    test("getActiveConnections returns connections", () => {
      registerConnection({ userId: "user1" });
      registerConnection({ userId: "user2" });
      const conns = getActiveConnections();
      expect(conns.length).toBe(2);
    });

    test("getActiveConnections filters by userId", () => {
      registerConnection({ userId: "user1" });
      registerConnection({ userId: "user2" });
      const conns = getActiveConnections({ userId: "user1" });
      expect(conns.length).toBe(1);
    });

    test("getConnection returns connection", () => {
      const conn = registerConnection({ userId: "user1" });
      expect(getConnection(conn.id)).not.toBeNull();
    });

    test("getConnection returns null for unknown", () => {
      expect(getConnection("unknown")).toBeNull();
    });

    test("getUserConnectionCount returns count", () => {
      registerConnection({ userId: "user1" });
      registerConnection({ userId: "user1" });
      expect(getUserConnectionCount("user1")).toBe(2);
    });

    test("disconnectUser disconnects all user connections", () => {
      registerConnection({ userId: "user1" });
      registerConnection({ userId: "user1" });
      const count = disconnectUser("user1");
      expect(count).toBe(2);
      expect(getUserConnectionCount("user1")).toBe(0);
    });

    test("getConnectionStats returns stats", () => {
      registerConnection({ userId: "user1", type: "websocket" });
      const stats = getConnectionStats();
      expect(stats.activeConnections).toBe(1);
      expect(stats.uniqueUsers).toBe(1);
      expect(stats.byType).toHaveProperty("websocket");
    });

    test("getConnectionHistory returns history", () => {
      registerConnection({ userId: "user1" });
      const history = getConnectionHistory();
      expect(history.total).toBeGreaterThan(0);
    });

    test("clearConnectionData clears all data", () => {
      registerConnection({ userId: "user1" });
      clearConnectionData();
      expect(getActiveConnections().length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/connections/register requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/connections/register", {
        method: "POST",
        body: { type: "websocket" },
      });
      expect(status).toBe(401);
    });

    test("POST /api/connections/register registers connection", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/connections/register", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { type: "websocket" },
      });
      expect(status).toBe(201);
      expect(body.type).toBe("websocket");
    });

    test("GET /api/connections requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/connections", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/connections returns connections for admin", async () => {
      registerConnection({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/connections", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/connections/user/count returns count", async () => {
      registerConnection({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/connections/user/count", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.connections).toBe(1);
    });

    test("GET /api/connections/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/connections/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/connections/stats returns stats for admin", async () => {
      registerConnection({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/connections/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("activeConnections");
    });

    test("GET /api/connections/history returns history for admin", async () => {
      registerConnection({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/connections/history", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("history");
    });

    test("POST /api/connections/cleanup requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/connections/cleanup", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/connections/cleanup cleans for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/connections/cleanup", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("cleaned");
    });

    test("DELETE /api/connections/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/connections/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/connections/clear clears for admin", async () => {
      registerConnection({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/connections/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
