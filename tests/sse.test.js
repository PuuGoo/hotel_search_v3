import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import { SSEManager, getSSEManager, resetSSEManager } from "../middleware/sse.js";
import sseRoutes from "../routes/sse.js";

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
  app.use(sseRoutes);
  return app;
}

function makeRequest(app, path, options = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const req = http.request(
        {
          hostname: "localhost",
          port,
          path,
          method: options.method || "GET",
          headers: { ...options.headers },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            server.close();
            try {
              resolve({ status: res.statusCode, body: JSON.parse(body), headers: res.headers });
            } catch {
              resolve({ status: res.statusCode, body, headers: res.headers });
            }
          });
        }
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      req.setTimeout(3000, () => {
        req.destroy();
        server.close();
        resolve({ status: 0, body: "timeout", headers: {} });
      });
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    });
  });
}

describe("SSE", () => {
  let manager;

  beforeEach(() => {
    resetSSEManager();
    manager = getSSEManager();
  });

  afterEach(() => {
    resetSSEManager();
  });

  test("SSEManager creates singleton instance", () => {
    const m1 = getSSEManager();
    const m2 = getSSEManager();
    expect(m1).toBe(m2);
  });

  test("SSEManager tracks clients", () => {
    const mockRes = {
      writeHead: jest.fn(),
      write: jest.fn(),
      on: jest.fn(),
    };
    manager.addClient("user1", mockRes);
    const stats = manager.stats();
    expect(stats.totalClients).toBe(1);
    expect(stats.uniqueUsers).toBe(1);
    expect(stats.users["user1"]).toBe(1);
  });

  test("SSEManager removes client on disconnect", () => {
    let closeHandler;
    const mockRes = {
      writeHead: jest.fn(),
      write: jest.fn(),
      on: (_event, handler) => {
        closeHandler = handler;
      },
    };
    manager.addClient("user1", mockRes);
    expect(manager.stats().totalClients).toBe(1);
    closeHandler(); // Simulate disconnect
    expect(manager.stats().totalClients).toBe(0);
  });

  test("sendToUser returns count of sent messages", () => {
    const mockRes = {
      writeHead: jest.fn(),
      write: jest.fn(),
      on: jest.fn(),
    };
    manager.addClient("user1", mockRes);
    const sent = manager.sendToUser("user1", { type: "test", data: "hello" });
    expect(sent).toBe(1);
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('"type":"test"'));
  });

  test("sendToUser returns 0 for unknown user", () => {
    const sent = manager.sendToUser("unknown", { type: "test" });
    expect(sent).toBe(0);
  });

  test("broadcast sends to all connected users", () => {
    const mockRes1 = { writeHead: jest.fn(), write: jest.fn(), on: jest.fn() };
    const mockRes2 = { writeHead: jest.fn(), write: jest.fn(), on: jest.fn() };
    manager.addClient("user1", mockRes1);
    manager.addClient("user2", mockRes2);
    const sent = manager.broadcast({ type: "announcement", data: "hi" });
    expect(sent).toBe(2);
  });

  test("SSEManager sends initial connected event", () => {
    const mockRes = {
      writeHead: jest.fn(),
      write: jest.fn(),
      on: jest.fn(),
    };
    manager.addClient("user1", mockRes);
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('"type":"connected"'));
  });

  test("SSEManager sets correct headers", () => {
    const mockRes = {
      writeHead: jest.fn(),
      write: jest.fn(),
      on: jest.fn(),
    };
    manager.addClient("user1", mockRes);
    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    }));
  });

  test("heartbeat broadcasts to all clients", () => {
    const mockRes = { writeHead: jest.fn(), write: jest.fn(), on: jest.fn() };
    manager.addClient("user1", mockRes);
    manager.broadcast({ type: "heartbeat", timestamp: Date.now() });
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('"type":"heartbeat"'));
  });

  test("resetSSEManager clears singleton", () => {
    const m1 = getSSEManager();
    resetSSEManager();
    const m2 = getSSEManager();
    expect(m1).not.toBe(m2);
  });

  test("multiple clients for same user", () => {
    const mockRes1 = { writeHead: jest.fn(), write: jest.fn(), on: jest.fn() };
    const mockRes2 = { writeHead: jest.fn(), write: jest.fn(), on: jest.fn() };
    manager.addClient("user1", mockRes1);
    manager.addClient("user1", mockRes2);
    const stats = manager.stats();
    expect(stats.totalClients).toBe(2);
    expect(stats.uniqueUsers).toBe(1);
    expect(stats.users["user1"]).toBe(2);
  });

  test("GET /api/sse requires authentication", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/sse");
    expect(status).toBe(401);
  });

  test("POST /api/sse/send requires userId and type", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/sse/send", {
      method: "POST",
      headers: { "x-test-user": "user1", "content-type": "application/json" },
      body: {},
    });
    expect(status).toBe(400);
    expect(body.error).toContain("required");
  });

  test("POST /api/sse/broadcast requires admin role", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/sse/broadcast", {
      method: "POST",
      headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
      body: { type: "test" },
    });
    expect(status).toBe(403);
    expect(body.error).toContain("Admin");
  });

  test("GET /api/sse/stats requires admin role", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/sse/stats", {
      headers: { "x-test-user": "user1", "x-test-role": "user" },
    });
    expect(status).toBe(403);
  });

  test("GET /api/sse/stats returns stats for admin", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/sse/stats", {
      headers: { "x-test-user": "admin1", "x-test-role": "admin" },
    });
    expect(status).toBe(200);
    expect(body).toHaveProperty("totalClients");
    expect(body).toHaveProperty("uniqueUsers");
  });

  test("POST /api/sse/send succeeds with valid params", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/sse/send", {
      method: "POST",
      headers: { "x-test-user": "user1", "content-type": "application/json" },
      body: { userId: "user2", type: "test", data: "hello" },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.sent).toBe(0); // No connected clients
  });

  test("POST /api/sse/broadcast succeeds for admin", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/sse/broadcast", {
      method: "POST",
      headers: { "x-test-user": "admin1", "x-test-role": "admin", "content-type": "application/json" },
      body: { type: "announcement", data: "hello all" },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("sendToUser formats SSE data correctly", () => {
    const written = [];
    const mockRes = {
      writeHead: jest.fn(),
      write: jest.fn((data) => written.push(data)),
      on: jest.fn(),
    };
    manager.addClient("user1", mockRes);
    manager.sendToUser("user1", { type: "notification", data: { title: "Test" } });

    // Should have: initial connected event, then the notification event
    const eventLines = written.join("");
    expect(eventLines).toContain("id:");
    expect(eventLines).toContain("data:");
    expect(eventLines).toContain('"type":"notification"');
  });

  test("SSEManager handles send error gracefully", () => {
    let callCount = 0;
    const mockRes = {
      writeHead: jest.fn(),
      write: jest.fn(() => {
        callCount++;
        // First _send (connected event) = 2 write calls (id + data). Allow those.
        // Third write call onward = sendToUser attempts. Throw on those.
        if (callCount > 2) throw new Error("Connection closed");
      }),
      on: jest.fn(),
    };
    manager.addClient("user1", mockRes);
    expect(manager.stats().totalClients).toBe(1);
    manager.sendToUser("user1", { type: "test" });
    expect(manager.stats().totalClients).toBe(0);
  });
});
