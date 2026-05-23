import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import taskQueueRoutes from "../routes/taskQueue.js";
import {
  enqueue,
  peek,
  dequeue,
  complete,
  fail,
  cancel,
  getQueue,
  getHistory,
  getTask,
  getQueueStats,
  clearQueueData,
} from "../utils/taskQueue.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "task_queue.json");

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
  app.use(taskQueueRoutes);
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

describe("Task Queue", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearQueueData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("enqueue adds a task", () => {
      const task = enqueue({ type: "email", name: "Send email", priority: 5 });
      expect(task).toHaveProperty("id");
      expect(task.type).toBe("email");
      expect(task.priority).toBe(5);
      expect(task.status).toBe("pending");
    });

    test("enqueue sorts by priority", () => {
      enqueue({ name: "Low", priority: 1 });
      enqueue({ name: "High", priority: 10 });
      enqueue({ name: "Medium", priority: 5 });
      const next = peek();
      expect(next.name).toBe("High");
    });

    test("peek returns next task without removing", () => {
      enqueue({ name: "Test" });
      const task = peek();
      expect(task.name).toBe("Test");
      expect(getQueue().total).toBe(1);
    });

    test("peek returns null for empty queue", () => {
      expect(peek()).toBeNull();
    });

    test("dequeue claims a task", () => {
      enqueue({ name: "Test" });
      const task = dequeue();
      expect(task.status).toBe("processing");
      expect(task.startedAt).toBeDefined();
    });

    test("dequeue returns null for empty queue", () => {
      expect(dequeue()).toBeNull();
    });

    test("complete marks task as completed", () => {
      enqueue({ name: "Test" });
      const task = dequeue();
      const result = complete(task.id, { success: true });
      expect(result.status).toBe("completed");
      expect(getQueue().total).toBe(0);
      expect(getHistory().total).toBe(1);
    });

    test("complete returns error for unknown", () => {
      expect(complete("unknown").error).toContain("not found");
    });

    test("fail retries task on first failure", () => {
      enqueue({ name: "Test", maxRetries: 3 });
      const task = dequeue();
      const result = fail(task.id, "timeout");
      expect(result.retried).toBe(true);
      expect(result.status).toBe("pending");
      expect(getQueue().total).toBe(1);
    });

    test("fail marks as failed after max retries", () => {
      const task = enqueue({ name: "Test", maxRetries: 0 });
      dequeue();
      const result = fail(task.id, "error");
      expect(result.status).toBe("failed");
      expect(getQueue().total).toBe(0);
      expect(getHistory().total).toBe(1);
    });

    test("fail returns error for unknown", () => {
      expect(fail("unknown").error).toContain("not found");
    });

    test("cancel cancels a task", () => {
      enqueue({ name: "Test" });
      const task = peek();
      const result = cancel(task.id);
      expect(result.status).toBe("cancelled");
      expect(getQueue().total).toBe(0);
    });

    test("cancel returns error for unknown", () => {
      expect(cancel("unknown").error).toContain("not found");
    });

    test("getQueue returns queue contents", () => {
      enqueue({ name: "Test" });
      const queue = getQueue();
      expect(queue.total).toBe(1);
    });

    test("getHistory returns history", () => {
      enqueue({ name: "Test" });
      const task = dequeue();
      complete(task.id);
      expect(getHistory().total).toBe(1);
    });

    test("getTask returns specific task", () => {
      const task = enqueue({ name: "Test" });
      expect(getTask(task.id).name).toBe("Test");
    });

    test("getTask returns null for unknown", () => {
      expect(getTask("unknown")).toBeNull();
    });

    test("getQueueStats returns stats", () => {
      enqueue({ name: "Test" });
      const stats = getQueueStats();
      expect(stats.queueSize).toBe(1);
      expect(stats).toHaveProperty("queueStatusCounts");
    });

    test("clearQueueData clears all data", () => {
      enqueue({ name: "Test" });
      clearQueueData();
      expect(getQueue().total).toBe(0);
    });

    test("respects scheduledAt for future tasks", () => {
      enqueue({ name: "Now" });
      enqueue({ name: "Later", scheduledAt: Date.now() + 60000 });
      const task = dequeue();
      expect(task.name).toBe("Now");
      // Second dequeue should return null (future task)
      expect(dequeue()).toBeNull();
    });
  });

  describe("API Routes", () => {
    test("POST /api/task-queue/enqueue requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/task-queue/enqueue", {
        method: "POST",
        body: { name: "Test" },
      });
      expect(status).toBe(401);
    });

    test("POST /api/task-queue/enqueue adds task", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/task-queue/enqueue", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { name: "Test Task", type: "email" },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("Test Task");
    });

    test("GET /api/task-queue requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/task-queue", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/task-queue returns queue for admin", async () => {
      enqueue({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/task-queue", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("GET /api/task-queue/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/task-queue/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("queueSize");
    });

    test("GET /api/task-queue/history returns history for admin", async () => {
      enqueue({ name: "Test" });
      const task = dequeue();
      complete(task.id);
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/task-queue/history", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("POST /api/task-queue/dequeue dequeues for admin", async () => {
      enqueue({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/task-queue/dequeue", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("Test");
    });

    test("DELETE /api/task-queue/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/task-queue/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/task-queue/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/task-queue/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
