import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import automationRoutes from "../routes/automationRules.js";
import {
  createRule,
  getRules,
  getRule,
  updateRule,
  deleteRule,
  processEvent,
  getExecutions,
  getAutomationStats,
  clearAutomationData,
} from "../utils/automationRules.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "automation_rules.json");

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
  app.use(automationRoutes);
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

describe("Automation Rules", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearAutomationData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("createRule creates a rule", () => {
      const rule = createRule({
        name: "Price Alert",
        trigger: { event: "price.changed", conditions: { increase: { gt: 10 } } },
        actions: [{ type: "notify", config: { message: "Price increased!" } }],
        userId: "admin",
      });
      expect(rule).toHaveProperty("id");
      expect(rule.name).toBe("Price Alert");
      expect(rule.actions.length).toBe(1);
    });

    test("getRules returns rules", () => {
      createRule({ name: "R1" });
      createRule({ name: "R2" });
      expect(getRules().length).toBe(2);
    });

    test("getRules filters by enabled", () => {
      createRule({ name: "Enabled", enabled: true });
      createRule({ name: "Disabled", enabled: false });
      expect(getRules({ enabled: true }).length).toBe(1);
    });

    test("getRule returns specific rule", () => {
      const created = createRule({ name: "Test" });
      expect(getRule(created.id).name).toBe("Test");
    });

    test("getRule returns null for unknown", () => {
      expect(getRule("unknown")).toBeNull();
    });

    test("updateRule updates a rule", () => {
      const created = createRule({ name: "Old" });
      const updated = updateRule(created.id, { name: "New" });
      expect(updated.name).toBe("New");
    });

    test("updateRule returns null for unknown", () => {
      expect(updateRule("unknown", {})).toBeNull();
    });

    test("deleteRule deletes a rule", () => {
      const created = createRule({ name: "Test" });
      expect(deleteRule(created.id)).toBe(true);
      expect(getRule(created.id)).toBeNull();
    });

    test("deleteRule returns false for unknown", () => {
      expect(deleteRule("unknown")).toBe(false);
    });

    test("processEvent triggers matching rules", () => {
      createRule({
        name: "Price Alert",
        trigger: { event: "price.changed" },
        actions: [{ type: "notify" }],
      });
      const result = processEvent("price.changed", { price: 100 });
      expect(result.triggered).toBe(1);
    });

    test("processEvent skips non-matching events", () => {
      createRule({
        name: "Price Alert",
        trigger: { event: "price.changed" },
        actions: [{ type: "notify" }],
      });
      const result = processEvent("user.login");
      expect(result.triggered).toBe(0);
    });

    test("processEvent evaluates conditions", () => {
      createRule({
        name: "High Price Alert",
        trigger: { event: "price.changed", conditions: { price: { gt: 200 } } },
        actions: [{ type: "notify" }],
      });

      const result1 = processEvent("price.changed", { price: 100 });
      expect(result1.triggered).toBe(0);

      const result2 = processEvent("price.changed", { price: 300 });
      expect(result2.triggered).toBe(1);
    });

    test("processEvent skips disabled rules", () => {
      createRule({
        name: "Disabled",
        trigger: { event: "test" },
        enabled: false,
        actions: [{ type: "notify" }],
      });
      const result = processEvent("test");
      expect(result.triggered).toBe(0);
    });

    test("getExecutions returns executions", () => {
      createRule({
        name: "Test",
        trigger: { event: "test" },
        actions: [{ type: "log" }],
      });
      processEvent("test");
      expect(getExecutions().total).toBe(1);
    });

    test("getAutomationStats returns stats", () => {
      createRule({ name: "Test" });
      const stats = getAutomationStats();
      expect(stats.totalRules).toBe(1);
      expect(stats).toHaveProperty("enabledRules");
    });

    test("clearAutomationData clears all data", () => {
      createRule({ name: "Test" });
      clearAutomationData();
      expect(getRules().length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/automation/rules requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/automation/rules", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "Test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/automation/rules creates rule for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/automation/rules", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "Test Rule", trigger: { event: "test" }, actions: [{ type: "notify" }] },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("Test Rule");
    });

    test("GET /api/automation/rules requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/automation/rules", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/automation/rules returns rules for admin", async () => {
      createRule({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/automation/rules", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/automation/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/automation/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalRules");
    });

    test("POST /api/automation/process processes event for admin", async () => {
      createRule({ trigger: { event: "test" }, actions: [{ type: "log" }] });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/automation/process", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { eventType: "test", context: { data: 1 } },
      });
      expect(status).toBe(200);
      expect(body.triggered).toBe(1);
    });

    test("GET /api/automation/executions returns executions for admin", async () => {
      createRule({ trigger: { event: "test" }, actions: [{ type: "log" }] });
      processEvent("test");
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/automation/executions", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("DELETE /api/automation/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/automation/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/automation/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/automation/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
