import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import accessControlRoutes from "../routes/accessControlAudit.js";
import {
  defineRule,
  getRules,
  getRule,
  updateRule,
  deleteRule,
  runAudit,
  getAuditHistory,
  getAccessControlStats,
  clearAccessControlData,
} from "../utils/accessControlAudit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "access_control_audit.json");

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
  app.use(accessControlRoutes);
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

describe("Access Control Audit", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearAccessControlData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("defineRule defines a rule", () => {
      const rule = defineRule({
        name: "Admin Access",
        resource: "/api/users",
        action: "admin",
        roles: ["admin"],
        userId: "admin",
      });
      expect(rule).toHaveProperty("id");
      expect(rule.name).toBe("Admin Access");
      expect(rule.resource).toBe("/api/users");
    });

    test("getRules returns rules", () => {
      defineRule({ name: "r1" });
      defineRule({ name: "r2" });
      const result = getRules();
      expect(result.count).toBe(2);
    });

    test("getRules filters by resource", () => {
      defineRule({ name: "r1", resource: "/api/users" });
      defineRule({ name: "r2", resource: "/api/search" });
      const result = getRules({ resource: "/api/users" });
      expect(result.count).toBe(1);
    });

    test("getRules filters by enabled", () => {
      defineRule({ name: "r1", enabled: true });
      defineRule({ name: "r2", enabled: false });
      const result = getRules({ enabled: true });
      expect(result.count).toBe(1);
    });

    test("getRule returns specific rule", () => {
      const created = defineRule({ name: "test" });
      const found = getRule(created.id);
      expect(found.name).toBe("test");
    });

    test("getRule returns null for unknown", () => {
      expect(getRule("unknown")).toBeNull();
    });

    test("updateRule updates a rule", () => {
      const created = defineRule({ name: "old" });
      const updated = updateRule(created.id, { name: "new" });
      expect(updated.name).toBe("new");
    });

    test("updateRule returns null for unknown", () => {
      expect(updateRule("unknown", {})).toBeNull();
    });

    test("deleteRule deletes a rule", () => {
      const created = defineRule({ name: "test" });
      expect(deleteRule(created.id)).toBe(true);
      expect(getRule(created.id)).toBeNull();
    });

    test("deleteRule returns false for unknown", () => {
      expect(deleteRule("unknown")).toBe(false);
    });

    test("runAudit passes for compliant access", () => {
      defineRule({
        name: "Users Admin",
        resource: "/api/users",
        action: "admin",
        roles: ["admin"],
      });
      const audit = runAudit({
        currentAccess: { "/api/users": { admin: ["admin"] } },
      });
      expect(audit.compliant).toBe(true);
      expect(audit.findingsCount).toBe(0);
    });

    test("runAudit detects non-compliant access", () => {
      defineRule({
        name: "Users Admin",
        resource: "/api/users",
        action: "admin",
        roles: ["admin"],
      });
      const audit = runAudit({
        currentAccess: { "/api/users": { admin: ["user"] } },
      });
      expect(audit.compliant).toBe(false);
      expect(audit.findingsCount).toBe(1);
    });

    test("runAudit detects missing roles", () => {
      defineRule({
        name: "Search Access",
        resource: "/api/search",
        action: "read",
        roles: ["admin", "user"],
      });
      const audit = runAudit({
        currentAccess: { "/api/search": { read: ["admin"] } },
      });
      expect(audit.findings[0].missingRoles).toContain("user");
    });

    test("runAudit detects extra roles", () => {
      defineRule({
        name: "Search Access",
        resource: "/api/search",
        action: "read",
        roles: ["admin"],
      });
      const audit = runAudit({
        currentAccess: { "/api/search": { read: ["admin", "user"] } },
      });
      expect(audit.findings[0].extraRoles).toContain("user");
    });

    test("runAudit skips disabled rules", () => {
      defineRule({ name: "r1", enabled: false });
      const audit = runAudit({ currentAccess: {} });
      expect(audit.totalRules).toBe(0);
    });

    test("getAuditHistory returns history", () => {
      runAudit({ currentAccess: {} });
      const history = getAuditHistory();
      expect(history.total).toBe(1);
    });

    test("getAccessControlStats returns stats", () => {
      defineRule({ name: "r1", resource: "/api/users", action: "read" });
      const stats = getAccessControlStats();
      expect(stats.totalRules).toBe(1);
      expect(stats.resourceCounts["/api/users"]).toBe(1);
    });

    test("clearAccessControlData clears all data", () => {
      defineRule({ name: "test" });
      clearAccessControlData();
      expect(getRules().count).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/access-control/rules requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/access-control/rules", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/access-control/rules defines rule for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/access-control/rules", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "Admin Access", resource: "/api/users", action: "admin", roles: ["admin"] },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("Admin Access");
    });

    test("GET /api/access-control/rules returns rules for admin", async () => {
      defineRule({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/access-control/rules", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/access-control/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/access-control/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("POST /api/access-control/audit runs audit for admin", async () => {
      defineRule({ name: "r1", resource: "/api/test", action: "read", roles: ["admin"] });
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/access-control/audit", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { currentAccess: { "/api/test": { read: ["admin"] } } },
      });
      expect(status).toBe(200);
    });

    test("GET /api/access-control/history returns history for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/access-control/history", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("DELETE /api/access-control/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/access-control/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/access-control/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/access-control/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("GET /api/access-control/rules/:id returns rule for admin", async () => {
      const created = defineRule({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/access-control/rules/${created.id}`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("test");
    });

    test("GET /api/access-control/rules/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/access-control/rules/unknown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("PUT /api/access-control/rules/:id updates for admin", async () => {
      const created = defineRule({ name: "old" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/access-control/rules/${created.id}`, {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "new" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("new");
    });

    test("DELETE /api/access-control/rules/:id deletes for admin", async () => {
      const created = defineRule({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/access-control/rules/${created.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });

    test("DELETE /api/access-control/rules/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/access-control/rules/unknown", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });
  });
});
