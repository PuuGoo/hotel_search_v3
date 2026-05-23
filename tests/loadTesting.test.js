import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import loadTestRoutes from "../routes/loadTesting.js";
import {
  createConfig,
  getConfigs,
  getConfig,
  deleteConfig,
  runLoadTest,
  getResults,
  getLoadTestStats,
  clearLoadTestData,
} from "../utils/loadTesting.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "load_tests.json");

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
  app.use(loadTestRoutes);
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

describe("Load Testing", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearLoadTestData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("createConfig creates a config", () => {
      const config = createConfig({
        name: "API Load Test",
        target: { url: "http://localhost:3000/api/health", method: "GET" },
        scenario: { duration: 10, concurrency: 5 },
        userId: "admin",
      });
      expect(config).toHaveProperty("id");
      expect(config.name).toBe("API Load Test");
    });

    test("getConfigs returns configs", () => {
      createConfig({ name: "C1" });
      createConfig({ name: "C2" });
      expect(getConfigs().length).toBe(2);
    });

    test("getConfig returns specific config", () => {
      const created = createConfig({ name: "Test" });
      expect(getConfig(created.id).name).toBe("Test");
    });

    test("getConfig returns null for unknown", () => {
      expect(getConfig("unknown")).toBeNull();
    });

    test("deleteConfig deletes a config", () => {
      const created = createConfig({ name: "Test" });
      expect(deleteConfig(created.id)).toBe(true);
      expect(getConfig(created.id)).toBeNull();
    });

    test("deleteConfig returns false for unknown", () => {
      expect(deleteConfig("unknown")).toBe(false);
    });

    test("runLoadTest runs a load test", () => {
      const config = createConfig({
        name: "Test",
        scenario: { duration: 2, concurrency: 5 },
      });
      const result = runLoadTest(config.id);
      expect(result.totalRequests).toBe(10);
      expect(result).toHaveProperty("latency");
      expect(result).toHaveProperty("throughput");
    });

    test("runLoadTest returns error for unknown config", () => {
      expect(runLoadTest("unknown").error).toContain("not found");
    });

    test("getResults returns results", () => {
      const config = createConfig({ name: "Test", scenario: { duration: 1, concurrency: 2 } });
      runLoadTest(config.id);
      expect(getResults().total).toBe(1);
    });

    test("getLoadTestStats returns stats", () => {
      createConfig({ name: "Test" });
      const stats = getLoadTestStats();
      expect(stats.totalConfigs).toBe(1);
      expect(stats).toHaveProperty("avgThroughput");
    });

    test("clearLoadTestData clears all data", () => {
      createConfig({ name: "Test" });
      clearLoadTestData();
      expect(getConfigs().length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/load-test/configs requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/load-test/configs", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "Test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/load-test/configs creates config for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/load-test/configs", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "Test Config", scenario: { duration: 5, concurrency: 3 } },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("Test Config");
    });

    test("GET /api/load-test/configs requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/load-test/configs", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/load-test/configs returns configs for admin", async () => {
      createConfig({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/load-test/configs", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/load-test/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/load-test/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalConfigs");
    });

    test("POST /api/load-test/run/:id runs test for admin", async () => {
      const config = createConfig({ name: "Test", scenario: { duration: 1, concurrency: 2 } });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/load-test/run/${config.id}`, {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(201);
      expect(body.totalRequests).toBe(2);
    });

    test("GET /api/load-test/results returns results for admin", async () => {
      const config = createConfig({ name: "Test", scenario: { duration: 1, concurrency: 1 } });
      runLoadTest(config.id);
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/load-test/results", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("DELETE /api/load-test/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/load-test/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/load-test/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/load-test/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
