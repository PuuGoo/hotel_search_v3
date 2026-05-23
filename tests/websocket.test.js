import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import wsRoutes from "../routes/websocket.js";
import {
  getConnectionStats,
  getActiveRooms,
  getUserConnections,
  clearConnectionHistory,
  sendToUser,
  sendToRoom,
} from "../utils/websocket.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "websocket_data.json");

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
  app.use(wsRoutes);
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

describe("WebSocket", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearConnectionHistory();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("getConnectionStats returns stats", () => {
      const stats = getConnectionStats();
      expect(stats).toHaveProperty("activeConnections");
      expect(stats).toHaveProperty("activeRooms");
      expect(stats).toHaveProperty("maxConnections");
      expect(stats.activeConnections).toBe(0);
    });

    test("getActiveRooms returns empty array", () => {
      const rooms = getActiveRooms();
      expect(Array.isArray(rooms)).toBe(true);
      expect(rooms.length).toBe(0);
    });

    test("getUserConnections returns empty array", () => {
      const connections = getUserConnections("user1");
      expect(Array.isArray(connections)).toBe(true);
      expect(connections.length).toBe(0);
    });

    test("sendToUser does not throw when no connections", () => {
      expect(() => sendToUser("user1", { type: "test" })).not.toThrow();
    });

    test("sendToRoom does not throw when no room", () => {
      expect(() => sendToRoom("test-room", { type: "test" })).not.toThrow();
    });

    test("clearConnectionHistory clears data", () => {
      clearConnectionHistory();
      const stats = getConnectionStats();
      expect(stats.totalConnections).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("GET /api/websocket/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/websocket/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/websocket/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/websocket/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("activeConnections");
    });

    test("GET /api/websocket/rooms requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/websocket/rooms", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/websocket/rooms returns rooms for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/websocket/rooms", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("rooms");
    });

    test("GET /api/websocket/connections/:userId requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/websocket/connections/user1", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/websocket/connections/:userId returns connections for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/websocket/connections/user1", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("connections");
    });

    test("POST /api/websocket/send/user requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/websocket/send/user", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
        body: { userId: "user1", message: { type: "test" } },
      });
      expect(status).toBe(403);
    });

    test("POST /api/websocket/send/user validates input", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/websocket/send/user", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/websocket/send/user sends for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/websocket/send/user", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { userId: "user1", message: { type: "test" } },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("sent");
    });

    test("POST /api/websocket/send/room requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/websocket/send/room", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
        body: { room: "test", message: { type: "test" } },
      });
      expect(status).toBe(403);
    });

    test("POST /api/websocket/send/room validates input", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/websocket/send/room", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/websocket/send/room sends for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/websocket/send/room", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { room: "test", message: { type: "test" } },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("sent");
    });

    test("POST /api/websocket/disconnect/:userId requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/websocket/disconnect/user1", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/websocket/disconnect/:userId disconnects for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/websocket/disconnect/user1", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("count");
    });

    test("DELETE /api/websocket/history requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/websocket/history", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/websocket/history clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/websocket/history", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
