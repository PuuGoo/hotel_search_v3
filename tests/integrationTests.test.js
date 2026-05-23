import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import testRoutes from "../routes/integrationTests.js";
import {
  createSuite,
  getSuites,
  getSuite,
  updateSuite,
  deleteSuite,
  runSuite,
  getResults,
  getTestStats,
  clearTestData,
} from "../utils/integrationTests.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "integration_tests.json");

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
  app.use(testRoutes);
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

describe("Integration Test Suite", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearTestData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("createSuite creates a suite", () => {
      const suite = createSuite({
        name: "Auth Tests",
        tests: [
          { name: "Login", method: "POST", path: "/api/login", expected: { status: 200 } },
          { name: "Get Profile", method: "GET", path: "/api/profile", expected: { status: 200 } },
        ],
        userId: "admin",
      });
      expect(suite).toHaveProperty("id");
      expect(suite.name).toBe("Auth Tests");
      expect(suite.tests.length).toBe(2);
    });

    test("getSuites returns suites", () => {
      createSuite({ name: "S1" });
      createSuite({ name: "S2" });
      expect(getSuites().length).toBe(2);
    });

    test("getSuites filters by enabled", () => {
      createSuite({ name: "Enabled", enabled: true });
      createSuite({ name: "Disabled", enabled: false });
      expect(getSuites({ enabled: true }).length).toBe(1);
    });

    test("getSuite returns specific suite", () => {
      const created = createSuite({ name: "Test" });
      expect(getSuite(created.id).name).toBe("Test");
    });

    test("getSuite returns null for unknown", () => {
      expect(getSuite("unknown")).toBeNull();
    });

    test("updateSuite updates a suite", () => {
      const created = createSuite({ name: "Old" });
      const updated = updateSuite(created.id, { name: "New" });
      expect(updated.name).toBe("New");
    });

    test("updateSuite returns null for unknown", () => {
      expect(updateSuite("unknown", {})).toBeNull();
    });

    test("deleteSuite deletes a suite", () => {
      const created = createSuite({ name: "Test" });
      expect(deleteSuite(created.id)).toBe(true);
      expect(getSuite(created.id)).toBeNull();
    });

    test("deleteSuite returns false for unknown", () => {
      expect(deleteSuite("unknown")).toBe(false);
    });

    test("runSuite runs a suite", () => {
      const suite = createSuite({
        name: "Test",
        tests: [
          { name: "Test 1", method: "GET", path: "/api/health", expected: { status: 200 } },
          { name: "Test 2", method: "GET", path: "/api/status", expected: { status: 200 } },
        ],
      });
      const result = runSuite(suite.id);
      expect(result.totalTests).toBe(2);
      expect(result.passed).toBe(2);
      expect(result.passRate).toBe(100);
    });

    test("runSuite returns error for disabled suite", () => {
      const suite = createSuite({ name: "Test", enabled: false });
      expect(runSuite(suite.id).error).toContain("disabled");
    });

    test("runSuite returns error for unknown suite", () => {
      expect(runSuite("unknown").error).toContain("not found");
    });

    test("getResults returns results", () => {
      const suite = createSuite({ name: "Test", tests: [{ name: "T1", expected: { status: 200 } }] });
      runSuite(suite.id);
      expect(getResults().total).toBe(1);
    });

    test("getTestStats returns stats", () => {
      createSuite({ name: "Test" });
      const stats = getTestStats();
      expect(stats.totalSuites).toBe(1);
      expect(stats).toHaveProperty("totalTests");
    });

    test("clearTestData clears all data", () => {
      createSuite({ name: "Test" });
      clearTestData();
      expect(getSuites().length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/test/suites requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/test/suites", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "Test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/test/suites creates suite for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/test/suites", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "Test Suite", tests: [{ name: "T1", expected: { status: 200 } }] },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("Test Suite");
    });

    test("GET /api/test/suites requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/test/suites", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/test/suites returns suites for admin", async () => {
      createSuite({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/test/suites", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/test/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/test/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalSuites");
    });

    test("POST /api/test/suites/:id/run runs suite for admin", async () => {
      const suite = createSuite({ name: "Test", tests: [{ name: "T1", expected: { status: 200 } }] });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/test/suites/${suite.id}/run`, {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(201);
      expect(body.passed).toBe(1);
    });

    test("GET /api/test/results returns results for admin", async () => {
      const suite = createSuite({ name: "Test", tests: [{ name: "T1", expected: { status: 200 } }] });
      runSuite(suite.id);
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/test/results", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("DELETE /api/test/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/test/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/test/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/test/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
