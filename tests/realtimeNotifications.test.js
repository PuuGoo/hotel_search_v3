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
  acknowledgePendingNotification,
  retryPendingNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getNotificationStats,
  clearNotifications,
  clearAllNotificationData,
  evaluateSupportRoomSLA,
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

    test("acknowledgePendingNotification removes pending item", () => {
      const n = sendNotification({ userId: "user1", title: "Ack me" });
      const acknowledged = acknowledgePendingNotification(n.id, "user1");
      expect(acknowledged).toBe(true);
      const pending = getPendingNotifications("user1");
      expect(pending.length).toBe(0);
    });

    test("retryPendingNotifications re-emits pending for user", () => {
      sendNotification({ userId: "user1", title: "Retry me" });
      const retried = retryPendingNotifications("user1");
      expect(retried).toBe(1);
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
      expect(stats).toHaveProperty("delivery");
      expect(stats.delivery).toHaveProperty("emitted");
      expect(stats.delivery).toHaveProperty("retries");
      expect(stats.delivery).toHaveProperty("acknowledged");
      expect(stats.delivery).toHaveProperty("ackLatencyMsTotal");
      expect(stats.delivery).toHaveProperty("ackLatencyCount");
      expect(stats.delivery).toHaveProperty("ackLatencyMsMax");
      expect(stats.delivery).toHaveProperty("ackLatencyMsAvg");
      expect(stats.delivery).toHaveProperty("ackLatencyMsP50");
      expect(stats.delivery).toHaveProperty("ackLatencyMsP95");
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

    describe("SLA automation", () => {
      test("evaluateSupportRoomSLA tags stale support room and notifies admins once per stage", () => {
        const now = Date.parse("2026-05-25T12:00:00.000Z");
        const room = {
          id: "support-room-1",
          type: "support",
          createdAt: "2026-05-25T08:00:00.000Z",
        };
        const messages = [
          { timestamp: "2026-05-25T08:00:00.000Z" },
          { timestamp: "2026-05-25T08:10:00.000Z" },
        ];

        const first = evaluateSupportRoomSLA({
          room,
          messages,
          now,
          adminUserIds: ["admin1", "admin2"],
        });

        expect(first.tagged).toBe(true);
        expect(first.stages).toEqual(["warning", "critical"]);
        expect(first.notificationsSent).toBe(4);

        const admin1Pending = getPendingNotifications("admin1");
        expect(admin1Pending.length).toBe(2);
        expect(admin1Pending[0].data.stage).toBe("critical");
        expect(admin1Pending[1].data.stage).toBe("warning");

        const second = evaluateSupportRoomSLA({
          room,
          messages,
          now,
          adminUserIds: ["admin1", "admin2"],
        });

        expect(second.tagged).toBe(true);
        expect(second.stages).toEqual([]);
        expect(second.notificationsSent).toBe(0);
      });

      test("evaluateSupportRoomSLA dedupes stage alerts across reconnect/retry cycles but allows new window", () => {
        const room = {
          id: "support-room-2",
          type: "support",
          createdAt: "2026-05-25T09:00:00.000Z",
        };
        const messages = [{ timestamp: "2026-05-25T09:15:00.000Z" }];

        const firstNow = Date.parse("2026-05-25T10:20:00.000Z");
        const first = evaluateSupportRoomSLA({ room, messages, now: firstNow, adminUserIds: ["admin1"] });
        expect(first.stages).toEqual(["warning"]);
        expect(first.notificationsSent).toBe(1);

        const replay = evaluateSupportRoomSLA({ room, messages, now: firstNow, adminUserIds: ["admin1"] });
        expect(replay.stages).toEqual([]);
        expect(replay.notificationsSent).toBe(0);

        const nextWindowNow = Date.parse("2026-05-25T11:25:00.000Z");
        const secondWindow = evaluateSupportRoomSLA({ room, messages, now: nextWindowNow, adminUserIds: ["admin1"] });
        expect(secondWindow.stages).toEqual(["warning", "critical"]);
        expect(secondWindow.notificationsSent).toBe(2);
      });
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

    test("POST /api/realtime-notifications/retry requires admin", async () => {
      sendNotification({ userId: "user1" });
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/realtime-notifications/retry", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { userId: "user1" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/realtime-notifications/retry retries for admin", async () => {
      sendNotification({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/retry", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { userId: "user1" },
      });
      expect(status).toBe(200);
      expect(body.count).toBeGreaterThanOrEqual(1);
    });

    test("POST /api/realtime-notifications/resend/:notificationId requires admin", async () => {
      const n = sendNotification({ userId: "user1", title: "Resend auth" });
      const app = createTestApp();
      const { status } = await makeRequest(app, `/api/realtime-notifications/resend/${n.id}`, {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/realtime-notifications/resend/:notificationId returns 404 when missing", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/realtime-notifications/resend/not-exists", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("POST /api/realtime-notifications/resend/:notificationId resends for admin", async () => {
      const n = sendNotification({ userId: "user1", title: "Resend ok" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/realtime-notifications/resend/${n.id}`, {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.resent).toBe(true);
      expect(body.notificationId).toBe(n.id);
    });

    test("GET /api/realtime-notifications/delivery-health requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/realtime-notifications/delivery-health", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/realtime-notifications/delivery-health returns health for admin", async () => {
      sendNotification({ userId: "user1", title: "Health" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/delivery-health", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("scheduler");
      expect(body).toHaveProperty("pendingTotal");
      expect(body).toHaveProperty("delivery");
    });

    test("GET /api/realtime-notifications/pending-details requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/realtime-notifications/pending-details", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/realtime-notifications/pending-details returns details for admin", async () => {
      sendNotification({ userId: "user1", title: "Pending details" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/pending-details?userId=user1", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBeGreaterThanOrEqual(1);
      expect(body.pending[0]).toHaveProperty("notificationId");
    });

    test("GET /api/realtime-notifications/dead-letter requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/realtime-notifications/dead-letter", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/realtime-notifications/dead-letter returns list for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/dead-letter?limit=5", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("deadLetter");
      expect(body).toHaveProperty("count");
    });

    test("POST /api/realtime-notifications/dead-letter/requeue/:notificationId requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/realtime-notifications/dead-letter/requeue/x1", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/realtime-notifications/dead-letter/requeue/:notificationId returns 404 when missing", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/realtime-notifications/dead-letter/requeue/not-found", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("DELETE /api/realtime-notifications/dead-letter/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/realtime-notifications/dead-letter/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/realtime-notifications/dead-letter/clear clears queue", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/dead-letter/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("count");
    });

    test("GET /api/realtime-notifications/delivery-status-config requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/realtime-notifications/delivery-status-config", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/realtime-notifications/delivery-status-config returns config", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/delivery-status-config", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("enabled");
      expect(body).toHaveProperty("opsThrottleMs");
    });

    test("GET /api/realtime-notifications/retry-scheduler-config requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/realtime-notifications/retry-scheduler-config", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/realtime-notifications/retry-scheduler-config returns config", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/retry-scheduler-config", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("active");
      expect(body).toHaveProperty("intervalMs");
    });

    test("PUT /api/realtime-notifications/retry-scheduler-config updates interval", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/retry-scheduler-config", {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { intervalMs: 12000 },
      });
      expect(status).toBe(200);
      expect(body.intervalMs).toBe(12000);
    });

    test("PUT /api/realtime-notifications/delivery-status-config updates config", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/realtime-notifications/delivery-status-config", {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { enabled: false, opsThrottleMs: 15000 },
      });
      expect(status).toBe(200);
      expect(body.enabled).toBe(false);
      expect(body.opsThrottleMs).toBe(15000);
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
