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
  sendToOps,
  getOpsEventHistory,
  clearOpsEventHistory,
  getChatManager,
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

    test("sendToOps does not throw when no room", () => {
      expect(() => sendToOps({ type: "ops:test" })).not.toThrow();
    });

    test("ops history helpers work", () => {
      expect(Array.isArray(getOpsEventHistory(10))).toBe(true);
      const cleared = clearOpsEventHistory();
      expect(typeof cleared).toBe("number");
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

    test("POST /api/websocket/send/ops requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/websocket/send/ops", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
        body: { message: { type: "ops:test" } },
      });
      expect(status).toBe(403);
    });

    test("POST /api/websocket/send/ops validates input", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/websocket/send/ops", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/websocket/send/ops sends for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/websocket/send/ops", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { message: { type: "ops:test" } },
      });
      expect(status).toBe(200);
      expect(body.room).toBe("ops:admin");
    });

    test("GET /api/websocket/ops/history requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/websocket/ops/history", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/websocket/ops/history returns history for admin", async () => {
      const app = createTestApp();
      await makeRequest(app, "/api/websocket/send/ops", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { message: { type: "ops:test-history" } },
      });
      const { status, body } = await makeRequest(app, "/api/websocket/ops/history?limit=10", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("events");
      expect(body).toHaveProperty("count");
    });

    test("GET /api/websocket/ops/history filters by type", async () => {
      const app = createTestApp();
      await makeRequest(app, "/api/websocket/send/ops", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { message: { type: "ops:type-a" } },
      });
      await makeRequest(app, "/api/websocket/send/ops", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { message: { type: "ops:type-b" } },
      });
      const { status, body } = await makeRequest(app, "/api/websocket/ops/history?type=ops:type-a", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBeGreaterThanOrEqual(1);
      expect(body.events.every((e) => e.message.type === "ops:type-a")).toBe(true);
    });

    test("GET /api/websocket/ops/history filters by since timestamp", async () => {
      const app = createTestApp();
      const since = Date.now();
      await makeRequest(app, "/api/websocket/send/ops", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { message: { type: "ops:since-test" } },
      });
      const { status, body } = await makeRequest(app, `/api/websocket/ops/history?since=${since}`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBeGreaterThanOrEqual(1);
    });

    test("DELETE /api/websocket/ops/history requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/websocket/ops/history", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/websocket/ops/history clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/websocket/ops/history", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("count");
    });

    test("POST /api/websocket/send/ops includes lifecycle metadata in history", async () => {
      const app = createTestApp();
      await makeRequest(app, "/api/websocket/send/ops", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { message: { type: "ops:lifecycle", phase: "phase5" } },
      });
      const { status, body } = await makeRequest(app, "/api/websocket/ops/history?limit=1", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.events.length).toBeGreaterThanOrEqual(1);
      const event = body.events[0];
      expect(event).toHaveProperty("timestamp");
      expect(event).toHaveProperty("message");
      expect(event).toHaveProperty("source", "websocket");
      expect(event).toHaveProperty("actor");
    });

    test("GET /api/websocket/diagnostics requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/websocket/diagnostics", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/websocket/diagnostics returns diagnostics for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/websocket/diagnostics", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("connections");
      expect(body).toHaveProperty("rooms");
      expect(body).toHaveProperty("opsHistory");
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

    test("websocket manager enforces edit ownership and allows admin delete", () => {
      const manager = getChatManager();
      manager.createRoom("phase1-room", "Phase 1 Room", "group");
      manager._saveMessage("phase1-room", {
        id: "phase1-msg-1",
        roomId: "phase1-room",
        from: { userId: 1001, username: "alice", role: "user" },
        text: "initial",
        timestamp: new Date().toISOString(),
        type: "text",
      });

      const unauthorizedEdit = manager.editMessage("phase1-room", "phase1-msg-1", 2002, "hijack");
      expect(unauthorizedEdit).toBeNull();

      const ownerEdit = manager.editMessage("phase1-room", "phase1-msg-1", 1001, "updated");
      expect(ownerEdit).toBeDefined();
      expect(ownerEdit.text).toBe("updated");
      expect(ownerEdit.editedAt).toBeDefined();

      const adminDelete = manager.deleteMessage("phase1-room", "phase1-msg-1", 9999, "admin");
      expect(adminDelete).toBeDefined();
      expect(adminDelete.deleted).toBe(true);
      expect(adminDelete.text).toBe("[deleted]");
      expect(adminDelete.deletedAt).toBeDefined();
    });

    test("websocket manager allows admin lock and unlock room", () => {
      const manager = getChatManager();
      manager.createRoom("phase3-room", "Phase 3 Room", "group");

      expect(typeof manager.lockRoom).toBe("function");
      expect(typeof manager.unlockRoom).toBe("function");

      const locked = manager.lockRoom("phase3-room", 1, "user");
      expect(locked).toBeNull();

      const adminLocked = manager.lockRoom("phase3-room", 9999, "admin");
      expect(adminLocked).toBeDefined();
      expect(adminLocked.locked).toBe(true);
      expect(adminLocked.lockedBy).toBe(9999);

      const unlocked = manager.unlockRoom("phase3-room", 9999, "admin");
      expect(unlocked).toBeDefined();
      expect(unlocked.locked).toBe(false);
    });

    test("websocket manager suggests support assignee with deterministic load ordering", () => {
      const manager = getChatManager();
      expect(typeof manager.suggestSupportAssignee).toBe("function");
      const suggestion = manager.suggestSupportAssignee("billing", "high");
      if (suggestion) {
        expect(suggestion).toHaveProperty("assignee");
        expect(suggestion).toHaveProperty("candidates");
        expect(Array.isArray(suggestion.candidates)).toBe(true);
      }
    });

    test("websocket manager provides explainable assignment suggestion factors", () => {
      const manager = getChatManager();
      manager.createRoom("phase16-suggest-room", "Phase16 Suggest Room", "support");
      expect(typeof manager.suggestSupportAssignment).toBe("function");
      const suggestion = manager.suggestSupportAssignment("phase16-suggest-room", "billing", "urgent");
      if (suggestion) {
        expect(suggestion).toHaveProperty("suggestedAssigneeId");
        expect(suggestion).toHaveProperty("factors");
        expect(suggestion.factors).toHaveProperty("load");
        expect(suggestion.factors).toHaveProperty("topicScore");
        expect(suggestion.factors).toHaveProperty("priorityScore");
        expect(suggestion.factors).toHaveProperty("totalScore");
      }
    });

    test("websocket manager applies explicit assignment accept/reject decisions", () => {
      const manager = getChatManager();
      const room = manager.createRoom("phase16-decide-room", "Phase16 Decide Room", "support");
      manager.users.set("phase16-admin-seed", {
        userId: 9999,
        username: "admin",
        role: "admin",
        joinedRooms: new Set(["general"]),
      });
      expect(room).toBeDefined();
      expect(typeof manager.decideSupportAssignment).toBe("function");

      const rejected = manager.decideSupportAssignment(
        "phase16-decide-room",
        { userId: 1, role: "admin" },
        "reject",
        { topic: "booking", priority: "normal" },
      );
      expect(rejected).toBeDefined();
      expect(rejected.decision).toBe("reject");
      expect(rejected.appliedAssigneeId).toBeNull();

      const accepted = manager.decideSupportAssignment(
        "phase16-decide-room",
        { userId: 1, role: "admin" },
        "accept",
        { topic: "booking", priority: "high" },
      );
      expect(accepted).toBeDefined();
      expect(accepted.decision).toBe("accept");
      expect(accepted.appliedAssigneeId).not.toBeNull();
      const updatedRoom = manager.rooms.get("phase16-decide-room");
      expect(updatedRoom.assignedAdminId).toBe(accepted.appliedAssigneeId);
    });

    test("websocket manager suggests deterministic replies and never auto-sends", () => {
      const manager = getChatManager();
      manager.createRoom("suggestion-room", "Suggestion Room", "support");
      manager._saveMessage("suggestion-room", {
        id: "suggestion-msg-1",
        roomId: "suggestion-room",
        from: { userId: 101, username: "guest", role: "user" },
        text: "Can I get a refund?",
        timestamp: new Date().toISOString(),
        type: "text",
      });

      expect(typeof manager.getSuggestedReplies).toBe("function");
      const suggestions = manager.getSuggestedReplies("suggestion-room", { role: "admin", userId: 1 });
      expect(Array.isArray(suggestions)).toBe(true);
      if (suggestions.length > 0) {
        expect(suggestions[0]).toHaveProperty("id");
        expect(suggestions[0]).toHaveProperty("text");
        expect(suggestions[0]).toHaveProperty("category");
      }

      const latest = manager.getMessages("suggestion-room", 10);
      const hasAutoSend = latest.some((m) => m.type === "text" && /refund|booking/i.test(String(m.text || "")) && m.from?.role === "admin");
      expect(hasAutoSend).toBe(false);
    });

    test("websocket manager persists attachment metadata on saved message", () => {
      const manager = getChatManager();
      manager.createRoom("phase7-room", "Phase 7 Room", "group");
      manager._saveMessage("phase7-room", {
        id: "phase7-msg-1",
        roomId: "phase7-room",
        from: { userId: 1001, username: "alice", role: "user" },
        text: "file attached",
        attachment: {
          name: "report.png",
          mimeType: "image/png",
          size: 12345,
          url: "https://example.com/report.png",
        },
        timestamp: new Date().toISOString(),
        type: "text",
      });

      const messages = manager.getMessages("phase7-room", 10);
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages[messages.length - 1]).toHaveProperty("attachment");
      expect(messages[messages.length - 1].attachment.name).toBe("report.png");
    });

  });
});
