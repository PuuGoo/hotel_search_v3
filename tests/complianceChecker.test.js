import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import complianceRoutes from "../routes/complianceChecker.js";
import {
  definePolicy,
  getPolicies,
  getPolicy,
  updatePolicy,
  deletePolicy,
  runComplianceCheck,
  getCheckHistory,
  getComplianceStats,
  clearComplianceData,
} from "../utils/complianceChecker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "compliance_checker.json");

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
  app.use(complianceRoutes);
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

describe("Compliance Checker", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearComplianceData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("definePolicy defines a policy", () => {
      const policy = definePolicy({
        name: "HTTPS Required",
        category: "security",
        description: "All endpoints must use HTTPS",
        rules: [
          { name: "HTTPS Enabled", check: "https_enabled", expected: true, severity: "error" },
        ],
        userId: "admin",
      });
      expect(policy).toHaveProperty("id");
      expect(policy.name).toBe("HTTPS Required");
      expect(policy.rules.length).toBe(1);
    });

    test("getPolicies returns policies", () => {
      definePolicy({ name: "p1" });
      definePolicy({ name: "p2" });
      const result = getPolicies();
      expect(result.count).toBe(2);
    });

    test("getPolicies filters by category", () => {
      definePolicy({ name: "p1", category: "security" });
      definePolicy({ name: "p2", category: "data" });
      const result = getPolicies({ category: "security" });
      expect(result.count).toBe(1);
    });

    test("getPolicies filters by enabled", () => {
      definePolicy({ name: "p1", enabled: true });
      definePolicy({ name: "p2", enabled: false });
      const result = getPolicies({ enabled: true });
      expect(result.count).toBe(1);
    });

    test("getPolicy returns specific policy", () => {
      const created = definePolicy({ name: "test" });
      const found = getPolicy(created.id);
      expect(found.name).toBe("test");
    });

    test("getPolicy returns null for unknown", () => {
      expect(getPolicy("unknown")).toBeNull();
    });

    test("updatePolicy updates a policy", () => {
      const created = definePolicy({ name: "old" });
      const updated = updatePolicy(created.id, { name: "new" });
      expect(updated.name).toBe("new");
    });

    test("updatePolicy returns null for unknown", () => {
      expect(updatePolicy("unknown", {})).toBeNull();
    });

    test("deletePolicy deletes a policy", () => {
      const created = definePolicy({ name: "test" });
      expect(deletePolicy(created.id)).toBe(true);
      expect(getPolicy(created.id)).toBeNull();
    });

    test("deletePolicy returns false for unknown", () => {
      expect(deletePolicy("unknown")).toBe(false);
    });

    test("runComplianceCheck runs check with compliant system", () => {
      definePolicy({
        name: "Security",
        rules: [
          { name: "HTTPS", check: "https_enabled", expected: true, severity: "error" },
          { name: "Auth", check: "auth_required", expected: true, severity: "error" },
        ],
      });
      const result = runComplianceCheck({
        systemState: { https_enabled: true, auth_required: true },
      });
      expect(result.compliant).toBe(true);
      expect(result.passed).toBe(2);
      expect(result.failed).toBe(0);
    });

    test("runComplianceCheck detects non-compliant system", () => {
      definePolicy({
        name: "Security",
        rules: [
          { name: "HTTPS", check: "https_enabled", expected: true, severity: "error" },
        ],
      });
      const result = runComplianceCheck({
        systemState: { https_enabled: false },
      });
      expect(result.compliant).toBe(false);
      expect(result.failed).toBe(1);
    });

    test("runComplianceCheck handles warnings", () => {
      definePolicy({
        name: "Security",
        rules: [
          { name: "HTTPS", check: "https_enabled", expected: true, severity: "error" },
          { name: "Backup", check: "backup_configured", expected: true, severity: "warning" },
        ],
      });
      const result = runComplianceCheck({
        systemState: { https_enabled: true, backup_configured: false },
      });
      expect(result.compliant).toBe(true);
      expect(result.warnings).toBe(1);
    });

    test("runComplianceCheck checks password min length", () => {
      definePolicy({
        name: "Auth",
        rules: [
          { name: "Password Length", check: "password_min_length", expected: 8, severity: "error" },
        ],
      });
      const result = runComplianceCheck({
        systemState: { password_min_length: 12 },
      });
      expect(result.compliant).toBe(true);
    });

    test("runComplianceCheck skips disabled policies", () => {
      definePolicy({ name: "p1", enabled: false, rules: [{ name: "r1", check: "x", severity: "error" }] });
      const result = runComplianceCheck({ systemState: {} });
      expect(result.totalPolicies).toBe(0);
    });

    test("getCheckHistory returns history", () => {
      definePolicy({ name: "p1", rules: [{ name: "r1", check: "x", severity: "error" }] });
      runComplianceCheck({ systemState: {} });
      const history = getCheckHistory();
      expect(history.total).toBe(1);
    });

    test("getComplianceStats returns stats", () => {
      definePolicy({ name: "p1", category: "security" });
      const stats = getComplianceStats();
      expect(stats.totalPolicies).toBe(1);
      expect(stats.categoryCounts.security).toBe(1);
    });

    test("clearComplianceData clears all data", () => {
      definePolicy({ name: "test" });
      clearComplianceData();
      expect(getPolicies().count).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/compliance/policies requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/compliance/policies", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/compliance/policies defines policy for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/compliance/policies", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "HTTPS Required", category: "security" },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("HTTPS Required");
    });

    test("GET /api/compliance/policies returns policies for admin", async () => {
      definePolicy({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/compliance/policies", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/compliance/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/compliance/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("POST /api/compliance/check runs check for admin", async () => {
      definePolicy({ name: "p1", rules: [{ name: "r1", check: "x", severity: "error" }] });
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/compliance/check", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { systemState: { x: true } },
      });
      expect(status).toBe(200);
    });

    test("GET /api/compliance/history returns history for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/compliance/history", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("DELETE /api/compliance/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/compliance/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/compliance/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/compliance/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("GET /api/compliance/policies/:id returns policy for admin", async () => {
      const created = definePolicy({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/compliance/policies/${created.id}`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("test");
    });

    test("GET /api/compliance/policies/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/compliance/policies/unknown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("PUT /api/compliance/policies/:id updates for admin", async () => {
      const created = definePolicy({ name: "old" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/compliance/policies/${created.id}`, {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "new" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("new");
    });

    test("DELETE /api/compliance/policies/:id deletes for admin", async () => {
      const created = definePolicy({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/compliance/policies/${created.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });

    test("DELETE /api/compliance/policies/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/compliance/policies/unknown", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });
  });
});
