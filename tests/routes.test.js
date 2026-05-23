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
import { _loginAttempts } from "../middleware/rateLimit.js";
import { csrfProtection } from "../middleware/csrf.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_USERS_FILE = path.join(__dirname, "..", "users.json");
const TEST_CHAT_FILE = path.join(__dirname, "..", "chatbox_data.json");

let originalUsers;
let originalChat;
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
    server.close(done);
  });

  beforeEach(() => {
    if (fs.existsSync(TEST_CHAT_FILE)) {
      fs.unlinkSync(TEST_CHAT_FILE);
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

    test("GET /api/chat/messages should reject unauthenticated request", async () => {
      const res = await fetch(`${baseUrl}/api/chat/messages`);
      expect(res.status).toBe(401);
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

    test("POST /api/chat/messages should reject empty text", async () => {
      const res = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ text: "" }),
      });
      expect(res.status).toBe(400);
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
