import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logRoutes from "../routes/requestResponseLogger.js";
import {
  logEntry,
  getEntries,
  getEntry,
  getLogStats,
  clearLog,
  getConfig,
  updateConfig,
} from "../utils/requestResponseLogger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "req_res_log.json");

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
  app.use(logRoutes);
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

describe("Request/Response Logger", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearLog();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("logEntry creates a log entry", () => {
      const entry = logEntry({
        method: "GET",
        path: "/api/test",
        statusCode: 200,
        duration: 150,
      });
      expect(entry).toHaveProperty("id");
      expect(entry).toHaveProperty("timestamp");
      expect(entry.request.method).toBe("GET");
      expect(entry.response.statusCode).toBe(200);
    });

    test("logEntry truncates large bodies", () => {
      const largeBody = "x".repeat(20000);
      const entry = logEntry({
        method: "POST",
        path: "/api/test",
        requestBody: largeBody,
      });
      expect(entry.request.body.length).toBeLessThan(largeBody.length);
      expect(entry.request.body).toContain("truncated");
    });

    test("getEntries returns entries", () => {
      logEntry({ method: "GET", path: "/test1" });
      logEntry({ method: "POST", path: "/test2" });
      const result = getEntries();
      expect(result.entries.length).toBe(2);
      expect(result.total).toBe(2);
    });

    test("getEntries filters by method", () => {
      logEntry({ method: "GET", path: "/test" });
      logEntry({ method: "POST", path: "/test" });
      const result = getEntries({ method: "GET" });
      expect(result.entries.length).toBe(1);
    });

    test("getEntries filters by path", () => {
      logEntry({ path: "/api/search" });
      logEntry({ path: "/api/bookmarks" });
      const result = getEntries({ path: "search" });
      expect(result.entries.length).toBe(1);
    });

    test("getEntries filters by status code", () => {
      logEntry({ statusCode: 200 });
      logEntry({ statusCode: 500 });
      const result = getEntries({ statusCode: "500" });
      expect(result.entries.length).toBe(1);
    });

    test("getEntry returns specific entry", () => {
      const created = logEntry({ method: "GET", path: "/test" });
      const found = getEntry(created.id);
      expect(found.id).toBe(created.id);
    });

    test("getEntry returns null for unknown", () => {
      expect(getEntry("nonexistent")).toBeNull();
    });

    test("getLogStats returns stats", () => {
      logEntry({ method: "GET", path: "/api/test", statusCode: 200, duration: 100 });
      logEntry({ method: "POST", path: "/api/test", statusCode: 201, duration: 200 });
      const stats = getLogStats({ minutes: 1 });
      expect(stats.totalEntries).toBe(2);
      expect(stats.methodCounts).toHaveProperty("GET");
      expect(stats.topPaths.length).toBeGreaterThan(0);
    });

    test("getLogStats handles empty data", () => {
      const stats = getLogStats({ minutes: 1 });
      expect(stats.totalEntries).toBe(0);
    });

    test("getConfig returns config", () => {
      const config = getConfig();
      expect(typeof config).toBe("object");
    });

    test("updateConfig updates config", () => {
      updateConfig({ enabled: true });
      const config = getConfig();
      expect(config.enabled).toBe(true);
    });

    test("clearLog clears all data", () => {
      logEntry({ method: "GET", path: "/test" });
      clearLog();
      const result = getEntries();
      expect(result.entries.length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("GET /api/req-res-log requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/req-res-log", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/req-res-log returns entries for admin", async () => {
      logEntry({ method: "GET", path: "/api/test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/req-res-log", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.entries.length).toBe(1);
    });

    test("GET /api/req-res-log/stats/overview requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/req-res-log/stats/overview", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/req-res-log/stats/overview returns stats for admin", async () => {
      logEntry({ method: "GET", path: "/api/test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/req-res-log/stats/overview", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalEntries");
    });

    test("GET /api/req-res-log/config requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/req-res-log/config", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/req-res-log/config returns config for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/req-res-log/config", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(typeof body).toBe("object");
    });

    test("PUT /api/req-res-log/config updates config for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/req-res-log/config", {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { enabled: true },
      });
      expect(status).toBe(200);
      expect(body.config.enabled).toBe(true);
    });

    test("DELETE /api/req-res-log/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/req-res-log/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/req-res-log/clear clears for admin", async () => {
      logEntry({ method: "GET", path: "/test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/req-res-log/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
