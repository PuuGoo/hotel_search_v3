import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import qualityRoutes from "../routes/dataQuality.js";
import {
  createCheck,
  getChecks,
  getCheck,
  updateCheck,
  deleteCheck,
  runCheck,
  runAllChecks,
  getResults,
  getQualityStats,
  clearQualityData,
} from "../utils/dataQuality.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "data_quality.json");

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
  app.use(qualityRoutes);
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

const sampleRecords = [
  { name: "Alice", age: 30, email: "alice@test.com", status: "active" },
  { name: "Bob", age: 25, email: "bob@test.com", status: "inactive" },
  { name: "", age: 150, email: "invalid", status: "unknown" },
];

describe("Data Quality", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearQualityData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("createCheck creates a check", () => {
      const check = createCheck({
        name: "Name Not Null",
        type: "not_null",
        field: "name",
        userId: "admin",
      });
      expect(check).toHaveProperty("id");
      expect(check.name).toBe("Name Not Null");
      expect(check.type).toBe("not_null");
    });

    test("getChecks returns checks", () => {
      createCheck({ name: "C1", type: "not_null", field: "name" });
      createCheck({ name: "C2", type: "unique", field: "email" });
      expect(getChecks().length).toBe(2);
    });

    test("getChecks filters by enabled", () => {
      createCheck({ name: "C1", enabled: true });
      createCheck({ name: "C2", enabled: false });
      expect(getChecks({ enabled: true }).length).toBe(1);
    });

    test("getCheck returns specific check", () => {
      const created = createCheck({ name: "Test" });
      expect(getCheck(created.id).name).toBe("Test");
    });

    test("getCheck returns null for unknown", () => {
      expect(getCheck("unknown")).toBeNull();
    });

    test("updateCheck updates a check", () => {
      const created = createCheck({ name: "Old" });
      const updated = updateCheck(created.id, { name: "New" });
      expect(updated.name).toBe("New");
    });

    test("updateCheck returns null for unknown", () => {
      expect(updateCheck("unknown", {})).toBeNull();
    });

    test("deleteCheck deletes a check", () => {
      const created = createCheck({ name: "Test" });
      expect(deleteCheck(created.id)).toBe(true);
      expect(getCheck(created.id)).toBeNull();
    });

    test("deleteCheck returns false for unknown", () => {
      expect(deleteCheck("unknown")).toBe(false);
    });

    test("runCheck validates not_null", () => {
      const check = createCheck({ type: "not_null", field: "name" });
      const result = runCheck(check.id, sampleRecords);
      expect(result.totalRecords).toBe(3);
      expect(result.passed).toBe(2);
      expect(result.failed).toBe(1);
    });

    test("runCheck validates range", () => {
      const check = createCheck({ type: "range", field: "age", config: { min: 0, max: 120 } });
      const result = runCheck(check.id, sampleRecords);
      expect(result.passed).toBe(2);
      expect(result.failed).toBe(1);
    });

    test("runCheck validates regex", () => {
      const check = createCheck({ type: "regex", field: "email", config: { pattern: "^.+@.+\\..+$" } });
      const result = runCheck(check.id, sampleRecords);
      expect(result.passed).toBe(2);
      expect(result.failed).toBe(1);
    });

    test("runCheck validates enum", () => {
      const check = createCheck({ type: "enum", field: "status", config: { values: ["active", "inactive"] } });
      const result = runCheck(check.id, sampleRecords);
      expect(result.passed).toBe(2);
      expect(result.failed).toBe(1);
    });

    test("runCheck returns error for unknown check", () => {
      expect(runCheck("unknown", []).error).toContain("not found");
    });

    test("runCheck returns error for disabled check", () => {
      const check = createCheck({ enabled: false });
      expect(runCheck(check.id, []).error).toContain("disabled");
    });

    test("runAllChecks runs all enabled checks", () => {
      createCheck({ type: "not_null", field: "name", enabled: true });
      createCheck({ type: "not_null", field: "email", enabled: true });
      const result = runAllChecks(sampleRecords);
      expect(result.totalChecks).toBe(2);
    });

    test("getResults returns results", () => {
      const check = createCheck({ type: "not_null", field: "name" });
      runCheck(check.id, sampleRecords);
      expect(getResults().total).toBe(1);
    });

    test("getQualityStats returns stats", () => {
      createCheck({ name: "Test" });
      const stats = getQualityStats();
      expect(stats.totalChecks).toBe(1);
      expect(stats).toHaveProperty("overallPassRate");
    });

    test("clearQualityData clears all data", () => {
      createCheck({ name: "Test" });
      clearQualityData();
      expect(getChecks().length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/quality/checks requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/quality/checks", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "Test", type: "not_null", field: "name" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/quality/checks creates check for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/quality/checks", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "Name Check", type: "not_null", field: "name" },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("Name Check");
    });

    test("GET /api/quality/checks requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/quality/checks", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/quality/checks returns checks for admin", async () => {
      createCheck({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/quality/checks", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/quality/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/quality/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalChecks");
    });

    test("POST /api/quality/checks/:id/run runs check for admin", async () => {
      const check = createCheck({ type: "not_null", field: "name" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/quality/checks/${check.id}/run`, {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { records: sampleRecords },
      });
      expect(status).toBe(201);
      expect(body.passed).toBe(2);
    });

    test("POST /api/quality/run-all runs all checks for admin", async () => {
      createCheck({ type: "not_null", field: "name" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/quality/run-all", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { records: sampleRecords },
      });
      expect(status).toBe(200);
      expect(body.totalChecks).toBe(1);
    });

    test("GET /api/quality/results returns results for admin", async () => {
      const check = createCheck({ type: "not_null", field: "name" });
      runCheck(check.id, sampleRecords);
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/quality/results", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("DELETE /api/quality/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/quality/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/quality/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/quality/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
