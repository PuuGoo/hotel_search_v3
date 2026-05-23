import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import notificationRoutes from "../routes/realtimeNotifications.js";
import {
  sendNotification,
  broadcastNotification,
  getNotifications,
  getPendingNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getNotificationStats,
  clearNotifications,
  clearAllNotificationData,
} from "../utils/realtimeNotifications.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "realtime_notifications.json");

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
  app.use(notificationRoutes);
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

describe("Real-time Notifications", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearAllNotificationData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("sendNotification creates a notification", () => {
      const notification = sendNotification({
        userId: "user1",
        type: "info",
        title: "Test",
        message: "Hello",
      });
      expect(notification).toHaveProperty("id");
      expect(notification.type).toBe("info");
      expect(notification.read).toBe(false);
    });

    test("broadcastNotification sends to multiple users", () => {
      const results = broadcastNotification({
        userIds: ["user1", "user2"],
        title: "Broadcast",
        message: "Hello all",
      });
      expect(results.length).toBe(2);
    });

    test("getNotifications returns user notifications", () => {
      sendNotification({ userId: "user1", title: "A" });
      sendNotification({ userId: "user1", title: "B" });
      sendNotification({ userId: "user2", title: "C" });
      const result = getNotifications("user1");
      expect(result.total).toBe(2);
    });

    test("getNotifications filters unread", () => {
      const n = sendNotification({ userId: "user1" });
      sendNotification({ userId: "user1" });
      markAsRead(n.id, "user1");
      const result = getNotifications("user1", { unreadOnly: true });
      expect(result.total).toBe(1);
    });

    test("getPendingNotifications returns and clears pending", () => {
      sendNotification({ userId: "user1", title: "Pending" });
      const pending = getPendingNotifications("user1");
      expect(pending.length).toBe(1);
      // Should be cleared after retrieval
      const pending2 = getPendingNotifications("user1");
      expect(pending2.length).toBe(0);
    });

    test("markAsRead marks notification as read", () => {
      const n = sendNotification({ userId: "user1" });
      expect(markAsRead(n.id, "user1")).toBe(true);
      const result = getNotifications("user1", { unreadOnly: true });
      expect(result.unread).toBe(0);
    });

    test("markAsRead returns false for unknown", () => {
      expect(markAsRead("unknown", "user1")).toBe(false);
    });

    test("markAllAsRead marks all as read", () => {
      sendNotification({ userId: "user1" });
      sendNotification({ userId: "user1" });
      const count = markAllAsRead("user1");
      expect(count).toBe(2);
    });

    test("deleteNotification deletes a notification", () => {
      const n = sendNotification({ userId: "user1" });
      expect(deleteNotification(n.id, "user1")).toBe(true);
      const result = getNotifications("user1");
      expect(result.total).toBe(0);
    });

    test("deleteNotification returns false for unknown", () => {
      expect(deleteNotification("unknown", "user1")).toBe(false);
    });

    test("getNotificationStats returns stats", () => {
      sendNotification({ userId: "user1", type: "info" });
      sendNotification({ userId: "user1", type: "alert" });
      const stats = getNotificationStats("user1");
      expect(stats.total).toBe(2);
      expect(stats.unread).toBe(2);
      expect(stats.byType).toHaveProperty("info");
    });

    test("clearNotifications clears user notifications", () => {
      sendNotification({ userId: "user1" });
      clearNotifications("user1");
      expect(getNotifications("user1").total).toBe(0);
    });

    test("clearAllNotificationData clears all data", () => {
      sendNotification({ userId: "user1" });
      clearAllNotificationData();
      expect(getNotifications("user1").total).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/realtime-notifications/send requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/realtime-notifications/send", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
        body: { userId: "user1", title: "Test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/realtime-notifications/send sends for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/send", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { userId: "user1", type: "info", title: "Test", message: "Hello" },
      });
      expect(status).toBe(201);
      expect(body.title).toBe("Test");
    });

    test("POST /api/realtime-notifications/broadcast broadcasts for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/broadcast", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { userIds: ["user1", "user2"], title: "Broadcast" },
      });
      expect(status).toBe(201);
      expect(body.count).toBe(2);
    });

    test("GET /api/realtime-notifications requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/realtime-notifications");
      expect(status).toBe(401);
    });

    test("GET /api/realtime-notifications returns notifications", async () => {
      sendNotification({ userId: "user1", title: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("GET /api/realtime-notifications/pending returns pending", async () => {
      sendNotification({ userId: "user1", title: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/pending", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("PUT /api/realtime-notifications/:id/read marks as read", async () => {
      const n = sendNotification({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/realtime-notifications/${n.id}/read`, {
        method: "PUT",
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("read");
    });

    test("PUT /api/realtime-notifications/read-all marks all as read", async () => {
      sendNotification({ userId: "user1" });
      sendNotification({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/read-all", {
        method: "PUT",
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(2);
    });

    test("DELETE /api/realtime-notifications/:id deletes notification", async () => {
      const n = sendNotification({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/realtime-notifications/${n.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });

    test("GET /api/realtime-notifications/stats returns stats", async () => {
      sendNotification({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/stats", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("total");
    });

    test("DELETE /api/realtime-notifications/clear clears user notifications", async () => {
      sendNotification({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("DELETE /api/realtime-notifications/clear-all requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/realtime-notifications/clear-all", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });
  });
});
