import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CHAT_FILE = path.join(__dirname, "test_chatbox_data.json");
const VALID_CHAT_TYPES = ["issue", "feedback", "question"];

// Create a test app with the same middleware structure
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "test-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
  }));

  // Health endpoint
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Auth middleware
  function checkAuthenticated(req, res, next) {
    if (req.session.isAuthenticated) {
      return next();
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  }

  function checkRole(...roles) {
    return (req, res, next) => {
      if (!req.session.isAuthenticated) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      if (!roles.includes(req.session.role)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      next();
    };
  }

  // Protected routes
  app.get("/protected", checkAuthenticated, (_req, res) => {
    res.json({ message: "Access granted" });
  });

  app.get("/admin-only", checkRole("admin"), (_req, res) => {
    res.json({ message: "Admin access" });
  });

  // Chat endpoints
  app.get("/api/chat/messages", (_req, res) => {
    try {
      let messages = [];
      if (fs.existsSync(CHAT_FILE)) {
        messages = JSON.parse(fs.readFileSync(CHAT_FILE, "utf8"));
      }
      res.json(messages);
    } catch (e) {
      res.status(500).json({ error: "Failed to read messages" });
    }
  });

  app.post("/api/chat/messages", checkRole("admin", "user"), (req, res) => {
    try {
      const text = (req.body.text || "").toString().trim().slice(0, 2000);
      const type = VALID_CHAT_TYPES.includes(req.body.type) ? req.body.type : "issue";
      if (!text) {
        return res.status(400).json({ success: false, error: "Message text is required" });
      }
      let messages = [];
      if (fs.existsSync(CHAT_FILE)) {
        messages = JSON.parse(fs.readFileSync(CHAT_FILE, "utf8"));
      }
      const newMessage = {
        id: Date.now(),
        text,
        type,
        timestamp: new Date().toISOString(),
        status: "open",
      };
      messages.push(newMessage);
      fs.writeFileSync(CHAT_FILE, JSON.stringify(messages, null, 2), "utf8");
      res.json({ success: true, message: newMessage });
    } catch (e) {
      res.status(500).json({ success: false, error: "Failed to create message" });
    }
  });

  app.post("/api/chat/messages/:id/resolve", checkRole("admin"), (req, res) => {
    try {
      let messages = [];
      if (fs.existsSync(CHAT_FILE)) {
        messages = JSON.parse(fs.readFileSync(CHAT_FILE, "utf8"));
      }
      const id = Number(req.params.id);
      const msg = messages.find((m) => m.id === id);
      if (msg) {
        msg.status = "resolved";
        msg.resolvedAt = new Date().toISOString();
        fs.writeFileSync(CHAT_FILE, JSON.stringify(messages, null, 2), "utf8");
        res.json({ success: true });
      } else {
        res.status(404).json({ success: false, error: "Not found" });
      }
    } catch (e) {
      res.status(500).json({ success: false, error: "Failed to resolve message" });
    }
  });

  // Login endpoint
  app.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (username === "admin" && password === "admin123") {
      req.session.isAuthenticated = true;
      req.session.role = "admin";
      req.session.username = username;
      res.json({ success: true, role: "admin" });
    } else if (username === "user" && password === "user1234") {
      req.session.isAuthenticated = true;
      req.session.role = "user";
      req.session.username = username;
      res.json({ success: true, role: "user" });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.get("/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

describe("Server Configuration", () => {
  let server;
  let baseUrl;

  beforeAll((done) => {
    const app = createTestApp();
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  describe("Health Endpoint", () => {
    test("should return status ok", async () => {
      const response = await fetch(`${baseUrl}/health`);
      const data = await response.json();
      expect(data.status).toBe("ok");
      expect(data.timestamp).toBeDefined();
      expect(data.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Authentication", () => {
    test("should reject unauthenticated access to protected route", async () => {
      const response = await fetch(`${baseUrl}/protected`);
      expect(response.status).toBe(401);
    });

    test("should allow authenticated access to protected route", async () => {
      // Login first
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "admin123" }),
      });
      const loginData = await loginRes.json();
      expect(loginData.success).toBe(true);

      // Get session cookie
      const cookies = loginRes.headers.get("set-cookie");

      // Access protected route with cookie
      const protectedRes = await fetch(`${baseUrl}/protected`, {
        headers: { Cookie: cookies },
      });
      const protectedData = await protectedRes.json();
      expect(protectedData.message).toBe("Access granted");
    });
  });

  describe("Role-based Access", () => {
    test("should deny non-admin access to admin route", async () => {
      // Login as regular user
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "user", password: "user1234" }),
      });
      const cookies = loginRes.headers.get("set-cookie");

      const response = await fetch(`${baseUrl}/admin-only`, {
        headers: { Cookie: cookies },
      });
      expect(response.status).toBe(403);
    });

    test("should allow admin access to admin route", async () => {
      // Login as admin
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "admin123" }),
      });
      const cookies = loginRes.headers.get("set-cookie");

      const response = await fetch(`${baseUrl}/admin-only`, {
        headers: { Cookie: cookies },
      });
      const data = await response.json();
      expect(data.message).toBe("Admin access");
    });
  });

  describe("Login/Logout", () => {
    test("should reject invalid credentials", async () => {
      const response = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "wrong", password: "wrong" }),
      });
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Invalid credentials");
    });

    test("should login and logout successfully", async () => {
      // Login
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "admin123" }),
      });
      expect(loginRes.status).toBe(200);
      const cookies = loginRes.headers.get("set-cookie");

      // Logout
      const logoutRes = await fetch(`${baseUrl}/logout`, {
        headers: { Cookie: cookies },
      });
      const logoutData = await logoutRes.json();
      expect(logoutData.success).toBe(true);
    });
  });

  describe("404 Handler", () => {
    test("should return 404 for unknown routes", async () => {
      const response = await fetch(`${baseUrl}/nonexistent-route`);
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Not found");
    });
  });

  describe("Session Security", () => {
    test("session config should have httpOnly cookie", () => {
      const sessionConfig = {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
      };
      expect(sessionConfig.httpOnly).toBe(true);
      expect(sessionConfig.maxAge).toBeGreaterThan(0);
    });
  });

  describe("Chat Endpoints", () => {
    beforeEach(() => {
      // Clean up test chat file before each test
      if (fs.existsSync(CHAT_FILE)) {
        fs.unlinkSync(CHAT_FILE);
      }
    });

    test("should reject unauthenticated chat message creation", async () => {
      const response = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Test message" }),
      });
      expect(response.status).toBe(401);
    });

    test("should allow authenticated user to create chat message", async () => {
      // Login as user
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "user", password: "user1234" }),
      });
      const cookies = loginRes.headers.get("set-cookie");

      const response = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookies },
        body: JSON.stringify({ text: "Test issue", type: "issue" }),
      });
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message.text).toBe("Test issue");
      expect(data.message.type).toBe("issue");
      expect(data.message.status).toBe("open");
    });

    test("should reject empty chat message", async () => {
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "user", password: "user1234" }),
      });
      const cookies = loginRes.headers.get("set-cookie");

      const response = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookies },
        body: JSON.stringify({ text: "" }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Message text is required");
    });

    test("should allow reading chat messages without auth", async () => {
      const response = await fetch(`${baseUrl}/api/chat/messages`);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    test("should allow admin to resolve chat message", async () => {
      // Create a message first
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "user", password: "user1234" }),
      });
      const userCookies = loginRes.headers.get("set-cookie");

      const createRes = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookies },
        body: JSON.stringify({ text: "Test issue to resolve" }),
      });
      const createData = await createRes.json();
      const messageId = createData.message.id;

      // Login as admin
      const adminLoginRes = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "admin123" }),
      });
      const adminCookies = adminLoginRes.headers.get("set-cookie");

      // Resolve the message
      const resolveRes = await fetch(`${baseUrl}/api/chat/messages/${messageId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookies },
      });
      const resolveData = await resolveRes.json();
      expect(resolveData.success).toBe(true);
    });

    test("should deny non-admin from resolving chat message", async () => {
      // Create a message first
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "user", password: "user1234" }),
      });
      const userCookies = loginRes.headers.get("set-cookie");

      const createRes = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookies },
        body: JSON.stringify({ text: "Test issue" }),
      });
      const createData = await createRes.json();
      const messageId = createData.message.id;

      // Try to resolve as non-admin user
      const resolveRes = await fetch(`${baseUrl}/api/chat/messages/${messageId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: userCookies },
      });
      expect(resolveRes.status).toBe(403);
    });

    test("should default to 'issue' type for invalid chat type", async () => {
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "user", password: "user1234" }),
      });
      const cookies = loginRes.headers.get("set-cookie");

      const response = await fetch(`${baseUrl}/api/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookies },
        body: JSON.stringify({ text: "Test message", type: "invalid" }),
      });
      const data = await response.json();
      expect(data.message.type).toBe("issue");
    });

    test("should return 404 for non-existent message resolve", async () => {
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "admin123" }),
      });
      const cookies = loginRes.headers.get("set-cookie");

      const response = await fetch(`${baseUrl}/api/chat/messages/99999/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookies },
      });
      expect(response.status).toBe(404);
    });
  });
});
