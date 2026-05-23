import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import webhookRoutes from "../routes/webhookRetry.js";
import {
  scheduleWebhook,
  getReadyWebhooks,
  recordSuccess,
  recordFailure,
  getPendingWebhooks,
  getWebhookHistory,
  getWebhook,
  cancelWebhook,
  getRetryStats,
  clearWebhookData,
} from "../utils/webhookRetry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "webhook_retry.json");

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
  app.use(webhookRoutes);
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

describe("Webhook Retry", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearWebhookData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("scheduleWebhook schedules a webhook", () => {
      const webhook = scheduleWebhook({
        url: "https://example.com/hook",
        event: "test",
        payload: { data: 1 },
      });
      expect(webhook).toHaveProperty("id");
      expect(webhook.url).toBe("https://example.com/hook");
      expect(webhook.status).toBe("pending");
    });

    test("getReadyWebhooks returns ready webhooks", () => {
      scheduleWebhook({ url: "https://example.com/hook" });
      const ready = getReadyWebhooks();
      expect(ready.length).toBe(1);
    });

    test("getReadyWebhooks excludes future webhooks", () => {
      scheduleWebhook({ url: "https://example.com/hook" });
      // Manually set nextRetryAt to future
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      data.pending[0].nextRetryAt = Date.now() + 60000;
      fs.writeFileSync(DATA_FILE, JSON.stringify(data));
      const ready = getReadyWebhooks();
      expect(ready.length).toBe(0);
    });

    test("recordSuccess marks as delivered", () => {
      const webhook = scheduleWebhook({ url: "https://example.com/hook" });
      const result = recordSuccess(webhook.id, 200, "OK");
      expect(result.status).toBe("delivered");
      expect(getPendingWebhooks().total).toBe(0);
      expect(getWebhookHistory().total).toBe(1);
    });

    test("recordSuccess returns error for unknown", () => {
      expect(recordSuccess("unknown", 200).error).toContain("not found");
    });

    test("recordFailure retries on first failure", () => {
      const webhook = scheduleWebhook({ url: "https://example.com/hook", maxRetries: 3 });
      const result = recordFailure(webhook.id, "timeout");
      expect(result.status).toBe("pending");
      expect(result.retryCount).toBe(1);
      expect(getPendingWebhooks().total).toBe(1);
    });

    test("recordFailure marks as failed after max retries", () => {
      const webhook = scheduleWebhook({ url: "https://example.com/hook", maxRetries: 0 });
      const result = recordFailure(webhook.id, "error");
      expect(result.status).toBe("failed");
      expect(getPendingWebhooks().total).toBe(0);
      expect(getWebhookHistory().total).toBe(1);
    });

    test("recordFailure returns error for unknown", () => {
      expect(recordFailure("unknown", "error").error).toContain("not found");
    });

    test("cancelWebhook cancels a webhook", () => {
      const webhook = scheduleWebhook({ url: "https://example.com/hook" });
      const result = cancelWebhook(webhook.id);
      expect(result.status).toBe("cancelled");
      expect(getPendingWebhooks().total).toBe(0);
    });

    test("cancelWebhook returns error for unknown", () => {
      expect(cancelWebhook("unknown").error).toContain("not found");
    });

    test("getPendingWebhooks returns pending webhooks", () => {
      scheduleWebhook({ url: "https://example.com/hook" });
      expect(getPendingWebhooks().total).toBe(1);
    });

    test("getWebhookHistory returns history", () => {
      const webhook = scheduleWebhook({ url: "https://example.com/hook" });
      recordSuccess(webhook.id, 200);
      expect(getWebhookHistory().total).toBe(1);
    });

    test("getWebhook returns specific webhook", () => {
      const webhook = scheduleWebhook({ url: "https://example.com/hook" });
      expect(getWebhook(webhook.id).url).toBe("https://example.com/hook");
    });

    test("getWebhook returns null for unknown", () => {
      expect(getWebhook("unknown")).toBeNull();
    });

    test("getRetryStats returns stats", () => {
      scheduleWebhook({ url: "https://example.com/hook" });
      const stats = getRetryStats();
      expect(stats.pendingCount).toBe(1);
      expect(stats).toHaveProperty("statusCounts");
    });

    test("clearWebhookData clears all data", () => {
      scheduleWebhook({ url: "https://example.com/hook" });
      clearWebhookData();
      expect(getPendingWebhooks().total).toBe(0);
    });

    test("exponential backoff increases delay", () => {
      const webhook = scheduleWebhook({ url: "https://example.com/hook", maxRetries: 5 });
      recordFailure(webhook.id, "error 1");
      const w1 = getWebhook(webhook.id);
      const delay1 = w1.nextRetryAt - Date.now();

      recordFailure(webhook.id, "error 2");
      const w2 = getWebhook(webhook.id);
      const delay2 = w2.nextRetryAt - Date.now();

      // Second delay should be roughly double the first
      expect(delay2).toBeGreaterThan(delay1);
    });
  });

  describe("API Routes", () => {
    test("POST /api/webhook-retry/schedule requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/webhook-retry/schedule", {
        method: "POST",
        body: { url: "https://example.com/hook" },
      });
      expect(status).toBe(401);
    });

    test("POST /api/webhook-retry/schedule schedules webhook", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/webhook-retry/schedule", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { url: "https://example.com/hook", event: "test" },
      });
      expect(status).toBe(201);
      expect(body.url).toBe("https://example.com/hook");
    });

    test("GET /api/webhook-retry/pending requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/webhook-retry/pending", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/webhook-retry/pending returns pending for admin", async () => {
      scheduleWebhook({ url: "https://example.com/hook" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/webhook-retry/pending", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("GET /api/webhook-retry/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/webhook-retry/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("pendingCount");
    });

    test("GET /api/webhook-retry/history returns history for admin", async () => {
      const webhook = scheduleWebhook({ url: "https://example.com/hook" });
      recordSuccess(webhook.id, 200);
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/webhook-retry/history", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("DELETE /api/webhook-retry/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/webhook-retry/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/webhook-retry/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/webhook-retry/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
