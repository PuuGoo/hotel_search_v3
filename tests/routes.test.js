import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import authRoutes from "../routes/auth.js";
import userRoutes from "../routes/users.js";
import chatRoutes from "../routes/chat.js";
import wsRoutes from "../routes/websocket.js";
import realtimeNotifRoutes from "../routes/realtimeNotifications.js";
import pageRoutes from "../routes/pages.js";
import { getChatManager } from "../utils/websocket.js";
import { _loginAttempts } from "../middleware/rateLimit.js";
import { csrfProtection } from "../middleware/csrf.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_USERS_FILE = path.join(__dirname, "..", "users.json");
const TEST_CHAT_FILE = path.join(__dirname, "..", "chatbox_data.json");
const TEST_SOCKET_CHAT_FILE = path.join(__dirname, "..", "chat_messages.json");

let originalUsers;
let originalChat;
let originalSocketChat;
let adminCookie;
let userCookie;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
    })
  );

  app.use(csrfProtection);
  app.use(authRoutes);
  app.use(userRoutes);
  app.use(chatRoutes);
  app.use(wsRoutes);
  app.use(realtimeNotifRoutes);
  app.use(pageRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

describe("Route Integration Tests", () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE)) {
      originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");
    }
    if (fs.existsSync(TEST_CHAT_FILE)) {
      originalChat = fs.readFileSync(TEST_CHAT_FILE, "utf8");
    }
    if (fs.existsSync(TEST_SOCKET_CHAT_FILE)) {
      originalSocketChat = fs.readFileSync(TEST_SOCKET_CHAT_FILE, "utf8");
    }

    const testUsers = [
      {
        id: 1,
        username: "admin",
        password: await bcrypt.hash("Admin123!", 10),
        displayName: "Admin",
        role: "admin",
        features: ["tavily", "ddg", "case12"],
        createdAt: new Date().toISOString(),
      },
      {
        id: 2,
        username: "testuser",
        password: await bcrypt.hash("Testpass1!", 10),
        displayName: "Test User",
        role: "user",
        features: ["tavily"],
        createdAt: new Date().toISOString(),
      },
    ];
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(testUsers, null, 2), "utf8");

    const app = createTestApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });

    // Login once and reuse cookies to avoid rate limiting
    adminCookie = await loginAs("admin", "Admin123!");
    userCookie = await loginAs("testuser", "Testpass1!");
  });

  afterAll((done) => {
    if (originalUsers !== undefined) {
      fs.writeFileSync(TEST_USERS_FILE, originalUsers, "utf8");
    }
    if (originalChat !== undefined) {
      fs.writeFileSync(TEST_CHAT_FILE, originalChat, "utf8");
    } else if (fs.existsSync(TEST_CHAT_FILE)) {
      fs.unlinkSync(TEST_CHAT_FILE);
    }
    if (originalSocketChat !== undefined) {
      fs.writeFileSync(TEST_SOCKET_CHAT_FILE, originalSocketChat, "utf8");
    } else if (fs.existsSync(TEST_SOCKET_CHAT_FILE)) {
      fs.unlinkSync(TEST_SOCKET_CHAT_FILE);
    }
    server.close(done);
  });

  beforeEach(() => {
    if (fs.existsSync(TEST_CHAT_FILE)) {
      fs.unlinkSync(TEST_CHAT_FILE);
    }
    if (fs.existsSync(TEST_SOCKET_CHAT_FILE)) {
      fs.unlinkSync(TEST_SOCKET_CHAT_FILE);
    }
    // Clear rate limiter state between tests
    _loginAttempts.clear();
  });

  async function loginAs(username, password) {
    const res = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      redirect: "manual",
    });
    return res.headers.get("set-cookie");
  }

  describe("Auth Routes", () => {
    test("GET / should serve login page", async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);
    });

    test("POST /login with valid credentials should redirect", async () => {
      expect(adminCookie).toBeDefined();
    });

    test("POST /login with invalid credentials should redirect with error", async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "wrongpassword" }),
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/?error=1");
    });

    test("GET /api/me should return current user info", async () => {
      const res = await fetch(`${baseUrl}/api/me`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.username).toBe("admin");
      expect(data.role).toBe("admin");
    });

    test("GET /api/me without auth should return 401", async () => {
      const res = await fetch(`${baseUrl}/api/me`);
      expect(res.status).toBe(401);
    });

    test("POST /logout should destroy session", async () => {
      // Login a fresh session to logout
      const cookie = await loginAs("admin", "Admin123!");
      const res = await fetch(`${baseUrl}/logout`, {
        method: "POST",
        headers: { Cookie: cookie },
        redirect: "manual",
      });
      expect(res.status).toBe(302);
    });

    test("PUT /api/change-password should work with correct old password", async () => {
      const res = await fetch(`${baseUrl}/api/change-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ oldPassword: "Testpass1!", newPassword: "Newpass123!" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Reset password immediately
      const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
      const user = users.find((u) => u.username === "testuser");
      user.password = await bcrypt.hash("Testpass1!", 10);
      fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(users, null, 2), "utf8");
    });

    test("PUT /api/change-password should reject wrong old password", async () => {
      const res = await fetch(`${baseUrl}/api/change-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ oldPassword: "wrong", newPassword: "Newpass123!" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("User Management Routes", () => {
    test("GET /api/users should return user list for admin", async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach((u) => {
        expect(u.password).toBeUndefined();
      });
    });

    test("GET /api/users should deny non-admin", async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        headers: { Cookie: userCookie },
      });
      expect(res.status).toBe(403);
    });

    test("POST /api/users should create a new user", async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({
          username: "newuser",
          password: "Newpass123!",
          displayName: "New User",
          role: "user",
          features: ["ddg"],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.user.username).toBe("newuser");

      // Cleanup
      const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
      const filtered = users.filter((u) => u.username !== "newuser");
      fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(filtered, null, 2), "utf8");
    });

    test("POST /api/users should reject duplicate username", async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ username: "admin", password: "Admin1234567!" }),
      });
      expect(res.status).toBe(400);
    });

    test("PUT /api/users/:id should update user", async () => {
      const res = await fetch(`${baseUrl}/api/users/2`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ displayName: "Updated Name" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user.displayName).toBe("Updated Name");
    });

    test("DELETE /api/users/:id should prevent deleting admin", async () => {
      const res = await fetch(`${baseUrl}/api/users/1`, {
        method: "DELETE",
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(400);
    });
  });

  describe("CSRF Integration", () => {
    test("should block POST with mismatched origin", async () => {
      const cookie = await loginAs("admin", "Admin123!");
      const res = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: "https://evil.com",
        },
        body: JSON.stringify({ text: "test", type: "issue" }),
      });
      expect(res.status).toBe(403);
    });

    test("should allow POST with matching origin", async () => {
      const cookie = await loginAs("admin", "Admin123!");
      const res = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: baseUrl,
        },
        body: JSON.stringify({ text: "test message", type: "issue" }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe("Chat Routes", () => {
    test("GET /api/chat/messages should return paginated response", async () => {
      const res = await fetch(`${baseUrl}/api/chat/messages`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("messages");
      expect(data).toHaveProperty("total");
      expect(data).toHaveProperty("page");
      expect(data).toHaveProperty("totalPages");
      expect(Array.isArray(data.messages)).toBe(true);
    });

    test("GET /api/chat/messages supports keyword filter", async () => {
      await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ text: "booking confirmation needed", type: "question" }),
      });
      await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ text: "maintenance request", type: "issue" }),
      });

      const res = await fetch(`${baseUrl}/api/chat/messages?keyword=booking`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.messages.length).toBe(1);
      expect(data.messages[0].text).toContain("booking");
    });

    test("GET /api/chat/messages supports sender filter", async () => {
      await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ text: "sent by regular user", type: "feedback" }),
      });

      const res = await fetch(`${baseUrl}/api/chat/messages?sender=testuser`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.messages.length).toBeGreaterThanOrEqual(1);
      expect(data.messages.every((m) => m.sender === "testuser")).toBe(true);
    });

    test("GET /api/chat/messages supports time range filter", async () => {
      const olderTs = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const newerTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      fs.writeFileSync(
        TEST_CHAT_FILE,
        JSON.stringify([
          { id: 101, text: "older message", type: "issue", status: "open", sender: "testuser", timestamp: olderTs },
          { id: 102, text: "newer message", type: "issue", status: "open", sender: "testuser", timestamp: newerTs },
        ], null, 2),
        "utf8",
      );

      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const res = await fetch(`${baseUrl}/api/chat/messages?from=${encodeURIComponent(since)}`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.messages.length).toBe(1);
      expect(data.messages[0].id).toBe(102);
    });

    test("POST /api/chat/messages should create message", async () => {
      const res = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ text: "Test message", type: "feedback" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message.type).toBe("feedback");
    });

    test("POST /api/chat/messages accepts valid attachment metadata", async () => {
      const res = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({
          text: "Attachment message",
          type: "feedback",
          attachment: {
            name: "invoice.pdf",
            mimeType: "application/pdf",
            size: 2048,
            url: "https://example.com/files/invoice.pdf",
          },
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toHaveProperty("attachment");
      expect(data.message.attachment.name).toBe("invoice.pdf");
    });

    test("POST /api/chat/messages rejects malformed attachment metadata", async () => {
      const res = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({
          text: "Bad attachment",
          type: "feedback",
          attachment: {
            name: "",
            mimeType: "text/plain",
            size: -1,
            url: "javascript:alert(1)",
          },
        }),
      });
      expect(res.status).toBe(400);
    });

    test("PUT /api/chat/preferences/language saves language preference", async () => {
      const res = await fetch(`${baseUrl}/api/chat/preferences/language`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ language: "vi" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.language).toBe("vi");
    });

    test("GET /api/chat/preferences/language returns saved language preference", async () => {
      await fetch(`${baseUrl}/api/chat/preferences/language`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ language: "en" }),
      });

      const res = await fetch(`${baseUrl}/api/chat/preferences/language`, {
        headers: { Cookie: userCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("language", "en");
    });

    test("POST /api/chat/support/intake assigns support room deterministically and returns routing metadata", async () => {
      const res = await fetch(`${baseUrl}/api/chat/support/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ topic: "billing", priority: "high" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.room.type).toBe("support");
      expect(data.routing).toHaveProperty("assignedAdminId");
      expect(data.routing).toHaveProperty("candidates");
      expect(Array.isArray(data.routing.candidates)).toBe(true);
      expect(data.routing.topic).toBe("billing");
      expect(data.routing.priority).toBe("high");
    });

    test("GET /api/chat/support/rooms/:roomId/assignment-suggestion returns explainable scoring factors", async () => {
      const manager = getChatManager();
      manager.createRoom("phase16-route-room", "Phase16 Route Room", "support");
      manager.users.set("phase16-admin-seed", {
        userId: 1,
        username: "admin",
        role: "admin",
        joinedRooms: new Set(["general"]),
      });

      const res = await fetch(`${baseUrl}/api/chat/support/rooms/phase16-route-room/assignment-suggestion?topic=billing&priority=urgent`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("suggestion");
      expect(data.suggestion).toHaveProperty("suggestedAssigneeId");
      expect(data.suggestion).toHaveProperty("factors");
      expect(data.suggestion.factors).toHaveProperty("load");
      expect(data.suggestion.factors).toHaveProperty("topicScore");
      expect(data.suggestion.factors).toHaveProperty("priorityScore");
      expect(data.suggestion.factors).toHaveProperty("totalScore");
    });

    test("POST /api/chat/support/rooms/:roomId/assignment-decision accepts explicit accept/reject", async () => {
      const manager = getChatManager();
      manager.createRoom("phase16-decision-room", "Phase16 Decision Room", "support");
      manager.users.set("phase16-admin-seed-2", {
        userId: 1,
        username: "admin",
        role: "admin",
        joinedRooms: new Set(["general"]),
      });

      const rejectRes = await fetch(`${baseUrl}/api/chat/support/rooms/phase16-decision-room/assignment-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ decision: "reject", topic: "booking", priority: "normal" }),
      });
      expect(rejectRes.status).toBe(200);
      const rejectData = await rejectRes.json();
      expect(rejectData.success).toBe(true);
      expect(rejectData.assignment.decision).toBe("reject");
      expect(rejectData.assignment.appliedAssigneeId).toBeNull();

      const acceptRes = await fetch(`${baseUrl}/api/chat/support/rooms/phase16-decision-room/assignment-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ decision: "accept", topic: "booking", priority: "high" }),
      });
      expect(acceptRes.status).toBe(200);
      const acceptData = await acceptRes.json();
      expect(acceptData.success).toBe(true);
      expect(acceptData.assignment.decision).toBe("accept");
      expect(acceptData.assignment.appliedAssigneeId).not.toBeNull();
    });

    test("POST /api/chat/support/rooms/:roomId/assignment-decision denies non-admin", async () => {
      const manager = getChatManager();
      manager.createRoom("phase16-deny-room", "Phase16 Deny Room", "support");

      const res = await fetch(`${baseUrl}/api/chat/support/rooms/phase16-deny-room/assignment-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ decision: "accept" }),
      });
      expect(res.status).toBe(403);
    });

    test("GET /api/chat/rooms/:roomId/summary returns structured summary", async () => {
      const manager = getChatManager();
      manager.createRoom("summary-route-room", "Summary Route Room", "group");
      manager._saveMessage("summary-route-room", {
        id: "sum-route-1",
        roomId: "summary-route-room",
        from: { userId: 1, username: "admin", role: "admin" },
        text: "initial summary seed",
        timestamp: new Date().toISOString(),
        type: "text",
      });

      const res = await fetch(`${baseUrl}/api/chat/rooms/summary-route-room/summary`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("roomId", "summary-route-room");
      expect(data).toHaveProperty("summaryText");
      expect(data).toHaveProperty("participants");
    });

    test("POST /api/chat/rooms/:roomId/handoff-notes persists note and returns it", async () => {
      const manager = getChatManager();
      manager.createRoom("handoff-route-room", "Handoff Route Room", "support");

      const create = await fetch(`${baseUrl}/api/chat/rooms/handoff-route-room/handoff-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ note: "handoff: follow up tomorrow" }),
      });
      expect(create.status).toBe(200);
      const created = await create.json();
      expect(created.success).toBe(true);
      expect(created.note.note).toContain("follow up");

      const list = await fetch(`${baseUrl}/api/chat/rooms/handoff-route-room/handoff-notes`, {
        headers: { Cookie: adminCookie },
      });
      expect(list.status).toBe(200);
      const listed = await list.json();
      expect(Array.isArray(listed.notes)).toBe(true);
      expect(listed.notes.length).toBeGreaterThanOrEqual(1);
    });

    test("POST /api/chat/messages/:id/resolve should work for admin", async () => {
      const createRes = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ text: "To resolve" }),
      });
      const createData = await createRes.json();
      expect(createData.success).toBe(true);

      const res = await fetch(`${baseUrl}/api/chat/messages/${createData.message.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });



    test("POST /api/chat/messages/:id/resolve should deny non-admin", async () => {
      const createRes = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ text: "To resolve" }),
      });
      const createData = await createRes.json();
      expect(createData.success).toBe(true);

      const res = await fetch(`${baseUrl}/api/chat/messages/${createData.message.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
      });
      expect(res.status).toBe(403);
    });

    test("POST /api/chat/messages/:id/resolve should return 404 for non-existent", async () => {
      const res = await fetch(`${baseUrl}/api/chat/messages/99999/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
      });
      expect(res.status).toBe(404);
    });

    test("POST /api/chat/rooms/:roomId/messages/:messageId/reactions toggles reaction", async () => {
      const manager = getChatManager();
      manager.createRoom("integration-room", "Integration Room", "group");
      manager._saveMessage("integration-room", {
        id: "integration-msg-1",
        roomId: "integration-room",
        from: { userId: 1, username: "admin", role: "admin" },
        text: "seed message",
        timestamp: new Date().toISOString(),
        type: "text",
      });

      const addRes = await fetch(`${baseUrl}/api/chat/rooms/integration-room/messages/integration-msg-1/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ emoji: "👍" }),
      });
      expect(addRes.status).toBe(200);
      const addData = await addRes.json();
      expect(addData.success).toBe(true);
      expect(addData.reaction.action).toBe("added");
      expect(addData.reaction.reactions["👍"]).toBeDefined();

      const removeRes = await fetch(`${baseUrl}/api/chat/rooms/integration-room/messages/integration-msg-1/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ emoji: "👍" }),
      });
      expect(removeRes.status).toBe(200);
      const removeData = await removeRes.json();
      expect(removeData.success).toBe(true);
      expect(removeData.reaction.action).toBe("removed");
      expect(removeData.reaction.reactions["👍"]).toBeUndefined();
    });

    test("POST /api/chat/rooms/:roomId/messages/:messageId/reactions validates emoji", async () => {
      const res = await fetch(`${baseUrl}/api/chat/rooms/general/messages/no-message/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ emoji: "" }),
      });
      expect(res.status).toBe(400);
    });

    test("POST /api/websocket/moderation/rooms/:roomId/lock should deny non-admin", async () => {
      const res = await fetch(`${baseUrl}/api/websocket/moderation/rooms/general/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
      });
      expect(res.status).toBe(403);
    });

    test("POST /api/websocket/moderation/rooms/:roomId/unlock should deny non-admin", async () => {
      const res = await fetch(`${baseUrl}/api/websocket/moderation/rooms/general/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
      });
      expect(res.status).toBe(403);
    });

    test("POST /api/websocket/moderation/rooms/:roomId/mute should deny non-admin", async () => {
      const res = await fetch(`${baseUrl}/api/websocket/moderation/rooms/general/mute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ targetUserId: "2" }),
      });
      expect(res.status).toBe(403);
    });

    test("GET /api/realtime-notifications/quality-signals returns deterministic metrics for admin", async () => {
      const res = await fetch(`${baseUrl}/api/realtime-notifications/quality-signals`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("roomsAnalyzed");
      expect(data).toHaveProperty("responseLatencyMsAvg");
      expect(data).toHaveProperty("reopenRate");
      expect(data).toHaveProperty("unresolvedCount");
    });

    test("GET /api/realtime-notifications/sla-predictions returns deterministic payload for admin", async () => {
      const res = await fetch(`${baseUrl}/api/realtime-notifications/sla-predictions`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("predictions");
      expect(Array.isArray(data.predictions)).toBe(true);
    });

    test("GET /api/realtime-notifications/sla-predictions denies non-admin", async () => {
      const res = await fetch(`${baseUrl}/api/realtime-notifications/sla-predictions`, {
        headers: { Cookie: userCookie },
      });
      expect(res.status).toBe(403);
    });

    test("POST /api/chat/rooms/:roomId/feedback validates and stores post-chat feedback", async () => {
      const manager = getChatManager();
      manager.createRoom("phase17-feedback-room", "Phase17 Feedback Room", "support");

      const badRes = await fetch(`${baseUrl}/api/chat/rooms/phase17-feedback-room/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ rating: 0, comment: "invalid" }),
      });
      expect(badRes.status).toBe(400);

      const goodRes = await fetch(`${baseUrl}/api/chat/rooms/phase17-feedback-room/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ rating: 5, comment: "very helpful" }),
      });
      expect(goodRes.status).toBe(200);
      const goodData = await goodRes.json();
      expect(goodData.success).toBe(true);
      expect(goodData.feedback.rating).toBe(5);
      expect(goodData).toHaveProperty("metrics");
      expect(goodData.metrics).toHaveProperty("feedbackCount");
      expect(goodData.metrics).toHaveProperty("avgRating");
    });

    test("GET /api/chat/feedback/metrics is admin protected and returns aggregates", async () => {
      const adminRes = await fetch(`${baseUrl}/api/chat/feedback/metrics`, {
        headers: { Cookie: adminCookie },
      });
      expect(adminRes.status).toBe(200);
      const data = await adminRes.json();
      expect(data).toHaveProperty("feedbackCount");
      expect(data).toHaveProperty("avgRating");
      expect(data).toHaveProperty("lowRatingRate");

      const userRes = await fetch(`${baseUrl}/api/chat/feedback/metrics`, {
        headers: { Cookie: userCookie },
      });
      expect(userRes.status).toBe(403);
    });

    test("GET /feedback-quality dashboard page is admin protected", async () => {
      const adminRes = await fetch(`${baseUrl}/feedback-quality`, {
        headers: { Cookie: adminCookie },
      });
      expect(adminRes.status).toBe(200);

      const userRes = await fetch(`${baseUrl}/feedback-quality`, {
        headers: { Cookie: userCookie },
      });
      expect(userRes.status).toBe(403);
    });

  });

  describe("User Management - Extended", () => {
    test("GET /admin should serve admin page for admin", async () => {
      const res = await fetch(`${baseUrl}/admin`, {
        headers: { Cookie: adminCookie },
        redirect: "manual",
      });
      expect(res.status).toBe(200);
    });

    test("GET /admin should deny non-admin", async () => {
      const res = await fetch(`${baseUrl}/admin`, {
        headers: { Cookie: userCookie },
        redirect: "manual",
      });
      expect(res.status).toBe(403);
    });

    test("PUT /api/users/:id should update displayName", async () => {
      const res = await fetch(`${baseUrl}/api/users/2`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ displayName: "New Display Name" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user.displayName).toBe("New Display Name");
    });

    test("PUT /api/users/:id should update password", async () => {
      const res = await fetch(`${baseUrl}/api/users/2`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ password: "Newpassword123!" }),
      });
      expect(res.status).toBe(200);

      // Reset password back
      const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
      const user = users.find((u) => u.id === 2);
      user.password = await bcrypt.hash("Testpass1!", 10);
      fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(users, null, 2), "utf8");
    });

    test("PUT /api/users/:id should update features", async () => {
      const res = await fetch(`${baseUrl}/api/users/2`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ features: ["tavily", "ddg"] }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user.features).toContain("tavily");
      expect(data.user.features).toContain("ddg");

      // Reset features
      const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
      const user = users.find((u) => u.id === 2);
      user.features = ["tavily"];
      fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(users, null, 2), "utf8");
    });

    test("PUT /api/users/:id should reject invalid features", async () => {
      const res = await fetch(`${baseUrl}/api/users/2`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ features: ["invalid_feature", "tavily"] }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user.features).toContain("tavily");
      expect(data.user.features).not.toContain("invalid_feature");
    });

    test("PUT /api/users/:id should return 404 for non-existent user", async () => {
      const res = await fetch(`${baseUrl}/api/users/99999`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ displayName: "Ghost" }),
      });
      expect(res.status).toBe(404);
    });

    test("DELETE /api/users/:id should prevent deleting last admin", async () => {
      const res = await fetch(`${baseUrl}/api/users/1`, {
        method: "DELETE",
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    test("DELETE /api/users/:id should delete non-admin user", async () => {
      // Create a user to delete
      const createRes = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({
          username: "to_delete",
          password: "Deletepass123!",
          displayName: "To Delete",
          role: "user",
          features: [],
        }),
      });
      const createData = await createRes.json();
      expect(createData.success).toBe(true);
      const userId = createData.user.id;

      const res = await fetch(`${baseUrl}/api/users/${userId}`, {
        method: "DELETE",
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    test("DELETE /api/users/:id should return 404 for non-existent user", async () => {
      const res = await fetch(`${baseUrl}/api/users/99999`, {
        method: "DELETE",
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(404);
    });

    test("PUT /api/users/:id should reject invalid displayName", async () => {
      const res = await fetch(`${baseUrl}/api/users/2`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ displayName: 123 }),
      });
      expect(res.status).toBe(400);
    });

    test("PUT /api/users/:id should reject invalid password", async () => {
      const res = await fetch(`${baseUrl}/api/users/2`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ password: 123 }),
      });
      expect(res.status).toBe(400);
    });

    test("PUT /api/users/:id should reject short password", async () => {
      const res = await fetch(`${baseUrl}/api/users/2`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ password: "short" }),
      });
      expect(res.status).toBe(400);
    });

    test("PUT /api/users/:id/password admin can change any password", async () => {
      const res = await fetch(`${baseUrl}/api/users/2/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ newPassword: "Newpass123!" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Reset password back
      const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
      const user = users.find((u) => u.id === 2);
      user.password = await bcrypt.hash("Testpass1!", 10);
      fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(users, null, 2), "utf8");
    });

    test("PUT /api/users/:id/password user can change own password", async () => {
      const res = await fetch(`${baseUrl}/api/users/2/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ oldPassword: "Testpass1!", newPassword: "Newpass123!" }),
      });
      expect(res.status).toBe(200);

      // Reset password back
      const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
      const user = users.find((u) => u.id === 2);
      user.password = await bcrypt.hash("Testpass1!", 10);
      fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(users, null, 2), "utf8");
    });

    test("PUT /api/users/:id/password user cannot change another user's password", async () => {
      const res = await fetch(`${baseUrl}/api/users/1/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ oldPassword: "Testpass1!", newPassword: "Newpass123!" }),
      });
      expect(res.status).toBe(403);
    });

    test("PUT /api/users/:id/password rejects wrong old password", async () => {
      const res = await fetch(`${baseUrl}/api/users/2/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ oldPassword: "wrongpassword", newPassword: "Newpass123!" }),
      });
      expect(res.status).toBe(400);
    });

    test("PUT /api/users/:id/password rejects short new password", async () => {
      const res = await fetch(`${baseUrl}/api/users/2/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ oldPassword: "Testpass1!", newPassword: "short" }),
      });
      expect(res.status).toBe(400);
    });

    test("PUT /api/users/:id/password rejects unauthenticated request", async () => {
      const res = await fetch(`${baseUrl}/api/users/2/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: "Newpass123!" }),
      });
      expect(res.status).toBe(401);
    });

    test("PUT /api/users/:id/password returns 404 for non-existent user", async () => {
      const res = await fetch(`${baseUrl}/api/users/99999/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ newPassword: "Newpass123!" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("Chat Messages - Extended", () => {
    test("GET /api/chat/messages should handle read error gracefully", async () => {
      // Corrupt the chat file temporarily
      const chatFile = path.join(__dirname, "..", "chatbox_data.json");
      let originalChat;
      if (fs.existsSync(chatFile)) {
        originalChat = fs.readFileSync(chatFile, "utf8");
      }
      fs.writeFileSync(chatFile, "not valid json", "utf8");

      const res = await fetch(`${baseUrl}/api/chat/messages`, {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBeDefined();

      // Restore
      if (originalChat) {
        fs.writeFileSync(chatFile, originalChat, "utf8");
      } else if (fs.existsSync(chatFile)) {
        fs.unlinkSync(chatFile);
      }
    });

    test("POST /api/chat/messages should handle write error gracefully", async () => {
      // Use a directory path to force write error
      const chatFile = path.join(__dirname, "..", "chatbox_data.json");
      let originalChat;
      if (fs.existsSync(chatFile)) {
        originalChat = fs.readFileSync(chatFile, "utf8");
      }
      // Write valid JSON first so read works
      fs.writeFileSync(chatFile, "[]", "utf8");

      // Now make it a directory (write will fail)
      fs.unlinkSync(chatFile);
      fs.mkdirSync(chatFile);

      const res = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ text: "test message" }),
      });
      expect(res.status).toBe(500);

      // Restore
      fs.rmdirSync(chatFile);
      if (originalChat) {
        fs.writeFileSync(chatFile, originalChat, "utf8");
      }
    });

    test("POST /api/chat/messages/:id/resolve should handle write error gracefully", async () => {
      const chatFile = path.join(__dirname, "..", "chatbox_data.json");
      let originalChat;
      if (fs.existsSync(chatFile)) {
        originalChat = fs.readFileSync(chatFile, "utf8");
      }
      // Write a message so resolve finds it
      fs.writeFileSync(chatFile, JSON.stringify([{ id: 12345, text: "test", status: "open" }]), "utf8");

      // Make chatFile a directory so writeFileSync in resolve fails
      fs.unlinkSync(chatFile);
      fs.mkdirSync(chatFile);

      const res = await fetch(`${baseUrl}/api/chat/messages/12345/resolve`, {
        method: "POST",
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("Failed to resolve message");

      // Restore
      fs.rmdirSync(chatFile);
      if (originalChat) {
        fs.writeFileSync(chatFile, originalChat, "utf8");
      }
    });
  });

  describe("Change Password", () => {
    test("PUT /api/change-password should change password successfully", async () => {
      const res = await fetch(`${baseUrl}/api/change-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ oldPassword: "Testpass1!", newPassword: "Newtestpass123!" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Reset password back
      const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
      const user = users.find((u) => u.id === 2);
      user.password = await bcrypt.hash("Testpass1!", 10);
      fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(users, null, 2), "utf8");
    });

    test("PUT /api/change-password should reject wrong old password", async () => {
      const res = await fetch(`${baseUrl}/api/change-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ oldPassword: "wrongpassword", newPassword: "Newtestpass123!" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Incorrect old password");
    });

    test("PUT /api/change-password should reject unauthenticated request", async () => {
      const res = await fetch(`${baseUrl}/api/change-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword: "Testpass1!", newPassword: "Newtestpass123!" }),
      });
      expect(res.status).toBe(401);
    });

    test("PUT /api/change-password should reject short new password", async () => {
      const res = await fetch(`${baseUrl}/api/change-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ oldPassword: "Testpass1!", newPassword: "short" }),
      });
      expect(res.status).toBe(400);
    });

    test("PUT /api/change-password should reject missing fields", async () => {
      const res = await fetch(`${baseUrl}/api/change-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ oldPassword: "Testpass1!" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("Auth Error Paths", () => {
    test("POST /login should redirect with error when bcrypt.compare throws", async () => {
      // Write users.json with a user whose password field is invalid (null)
      // This causes bcrypt.compare to throw, hitting the catch block
      const usersFile = path.join(__dirname, "..", "users.json");
      const backup = fs.readFileSync(usersFile, "utf8");
      fs.writeFileSync(usersFile, JSON.stringify([{ id: 99, username: "admin", password: null }]), "utf8");

      const res = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "Admin123!" }),
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/?error=2");

      // Restore
      fs.writeFileSync(usersFile, backup, "utf8");
    });

    test("PUT /api/change-password should return 404 when user not found in file", async () => {
      // Login to get a valid session
      const cookie = await loginAs("admin", "Admin123!");

      // Now overwrite users.json to remove the admin user
      const usersFile = path.join(__dirname, "..", "users.json");
      const backup = fs.readFileSync(usersFile, "utf8");
      const users = JSON.parse(backup);
      const withoutAdmin = users.filter((u) => u.username !== "admin");
      fs.writeFileSync(usersFile, JSON.stringify(withoutAdmin, null, 2), "utf8");

      const res = await fetch(`${baseUrl}/api/change-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ oldPassword: "Admin123!", newPassword: "Newpass123!" }),
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("User not found");

      // Restore
      fs.writeFileSync(usersFile, backup, "utf8");
    });
  });

  describe("404 Handler", () => {
    test("should return 404 for unknown routes", async () => {
      const res = await fetch(`${baseUrl}/nonexistent`);
      expect(res.status).toBe(404);
    });
  });
});
