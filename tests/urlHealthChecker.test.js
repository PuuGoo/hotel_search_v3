import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import healthRoutes from "../routes/urlHealthChecker.js";
import {
  batchCheckUrls,
  getUrlHealthHistory,
  getHealthStats,
  clearHealthData,
} from "../utils/urlHealthChecker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HEALTH_FILE = path.join(__dirname, "..", "url_health.json");

let healthBackup;

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
  app.use(healthRoutes);
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

describe("URL Health Checker", () => {
  beforeEach(() => {
    try { healthBackup = fs.readFileSync(HEALTH_FILE, "utf8"); } catch { healthBackup = null; }
    clearHealthData();
  });

  afterEach(() => {
    if (healthBackup) saveWithRetry(HEALTH_FILE, healthBackup);
    else { try { fs.unlinkSync(HEALTH_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("getHealthStats returns empty stats", () => {
      const stats = getHealthStats();
      expect(stats.totalUrls).toBe(0);
      expect(stats.healthyUrls).toBe(0);
    });

    test("getUrlHealthHistory returns null for unknown URL", () => {
      expect(getUrlHealthHistory("https://unknown.com")).toBeNull();
    });

    test("clearHealthData clears data", () => {
      clearHealthData();
      const stats = getHealthStats();
      expect(stats.totalUrls).toBe(0);
    });

    test("batchCheckUrls checks URLs and stores results", async () => {
      // Use a local server for testing
      const testServer = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("OK");
      });

      await new Promise((resolve) => testServer.listen(0, resolve));
      const port = testServer.address().port;

      try {
        const results = await batchCheckUrls([`http://localhost:${port}`], { timeout: 2000 });
        expect(results.length).toBe(1);
        expect(results[0].healthy).toBe(true);
        expect(results[0].status).toBe(200);

        const stats = getHealthStats();
        expect(stats.totalUrls).toBe(1);
        expect(stats.healthyUrls).toBe(1);
      } finally {
        testServer.close();
      }
    });

    test("getUrlHealthHistory returns history after check", async () => {
      const testServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end();
      });

      await new Promise((resolve) => testServer.listen(0, resolve));
      const port = testServer.address().port;
      const url = `http://localhost:${port}`;

      try {
        await batchCheckUrls([url]);
        const history = getUrlHealthHistory(url);
        expect(history).not.toBeNull();
        expect(history.totalChecks).toBe(1);
        expect(history.healthRate).toBe(100);
      } finally {
        testServer.close();
      }
    });
  });

  describe("API Routes", () => {
    test("POST /api/url-health/check requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/url-health/check", {
        method: "POST",
        body: { url: "https://example.com" },
      });
      expect(status).toBe(401);
    });

    test("POST /api/url-health/check requires url", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/url-health/check", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/url-health/batch requires urls", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/url-health/batch", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("GET /api/url-health/history requires url param", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/url-health/history", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(400);
    });

    test("GET /api/url-health/history returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/url-health/history?url=https://unknown.com", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(404);
    });

    test("GET /api/url-health/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/url-health/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/url-health/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/url-health/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalUrls");
    });

    test("DELETE /api/url-health/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/url-health/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/url-health/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/url-health/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
