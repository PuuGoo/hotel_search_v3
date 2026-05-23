import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import workflowRoutes from "../routes/workflowEngine.js";
import {
  createWorkflow,
  getWorkflows,
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
  executeWorkflow,
  getExecutions,
  getExecution,
  getWorkflowStats,
  clearWorkflowData,
} from "../utils/workflowEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "workflow_engine.json");

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
  app.use(workflowRoutes);
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

describe("Workflow Engine", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearWorkflowData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("createWorkflow creates a workflow", () => {
      const workflow = createWorkflow({
        name: "Test Workflow",
        steps: [
          { id: "s1", name: "Step 1", type: "action", next: "s2" },
          { id: "s2", name: "Step 2", type: "action" },
        ],
        userId: "admin",
      });
      expect(workflow).toHaveProperty("id");
      expect(workflow.name).toBe("Test Workflow");
      expect(workflow.steps.length).toBe(2);
    });

    test("getWorkflows returns workflows", () => {
      createWorkflow({ name: "W1" });
      createWorkflow({ name: "W2" });
      expect(getWorkflows().length).toBe(2);
    });

    test("getWorkflows filters by enabled", () => {
      createWorkflow({ name: "Enabled", enabled: true });
      createWorkflow({ name: "Disabled", enabled: false });
      expect(getWorkflows({ enabled: true }).length).toBe(1);
    });

    test("getWorkflow returns specific workflow", () => {
      const created = createWorkflow({ name: "Test" });
      expect(getWorkflow(created.id).name).toBe("Test");
    });

    test("getWorkflow returns null for unknown", () => {
      expect(getWorkflow("unknown")).toBeNull();
    });

    test("updateWorkflow updates a workflow", () => {
      const created = createWorkflow({ name: "Old" });
      const updated = updateWorkflow(created.id, { name: "New" });
      expect(updated.name).toBe("New");
    });

    test("updateWorkflow returns null for unknown", () => {
      expect(updateWorkflow("unknown", {})).toBeNull();
    });

    test("deleteWorkflow deletes a workflow", () => {
      const created = createWorkflow({ name: "Test" });
      expect(deleteWorkflow(created.id)).toBe(true);
      expect(getWorkflow(created.id)).toBeNull();
    });

    test("deleteWorkflow returns false for unknown", () => {
      expect(deleteWorkflow("unknown")).toBe(false);
    });

    test("executeWorkflow executes a workflow", () => {
      const workflow = createWorkflow({
        name: "Test",
        steps: [
          { id: "s1", name: "Step 1", type: "action" },
          { id: "s2", name: "Step 2", type: "transform" },
        ],
      });
      const execution = executeWorkflow(workflow.id);
      expect(execution.status).toBe("completed");
      expect(execution.steps.length).toBe(2);
    });

    test("executeWorkflow handles branching", () => {
      const workflow = createWorkflow({
        name: "Branch Test",
        steps: [
          { id: "s1", name: "Check", type: "condition", config: { condition: "true" }, next: { true: "s2", false: "s3" } },
          { id: "s2", name: "True Path", type: "action" },
          { id: "s3", name: "False Path", type: "action" },
        ],
      });
      const execution = executeWorkflow(workflow.id);
      expect(execution.status).toBe("completed");
      expect(execution.steps.some((s) => s.name === "True Path")).toBe(true);
    });

    test("executeWorkflow returns error for disabled workflow", () => {
      const workflow = createWorkflow({ name: "Test", enabled: false });
      expect(executeWorkflow(workflow.id).error).toContain("disabled");
    });

    test("executeWorkflow returns error for unknown workflow", () => {
      expect(executeWorkflow("unknown").error).toContain("not found");
    });

    test("getExecutions returns executions", () => {
      const workflow = createWorkflow({ name: "Test" });
      executeWorkflow(workflow.id);
      expect(getExecutions().total).toBe(1);
    });

    test("getExecution returns specific execution", () => {
      const workflow = createWorkflow({ name: "Test" });
      const execution = executeWorkflow(workflow.id);
      expect(getExecution(execution.id)).not.toBeNull();
    });

    test("getExecution returns null for unknown", () => {
      expect(getExecution("unknown")).toBeNull();
    });

    test("getWorkflowStats returns stats", () => {
      createWorkflow({ name: "Test" });
      const stats = getWorkflowStats();
      expect(stats.totalWorkflows).toBe(1);
      expect(stats).toHaveProperty("totalExecutions");
    });

    test("clearWorkflowData clears all data", () => {
      createWorkflow({ name: "Test" });
      clearWorkflowData();
      expect(getWorkflows().length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/workflows requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/workflows", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "Test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/workflows creates workflow for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/workflows", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "Test Workflow", steps: [{ id: "s1", name: "Step 1", type: "action" }] },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("Test Workflow");
    });

    test("GET /api/workflows requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/workflows", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/workflows returns workflows for admin", async () => {
      createWorkflow({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/workflows", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/workflows/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/workflows/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalWorkflows");
    });

    test("POST /api/workflows/:id/execute executes workflow for admin", async () => {
      const workflow = createWorkflow({ name: "Test", steps: [{ id: "s1", name: "Step 1", type: "action" }] });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/workflows/${workflow.id}/execute`, {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(201);
      expect(body.status).toBe("completed");
    });

    test("GET /api/workflows/executions/list returns executions for admin", async () => {
      const workflow = createWorkflow({ name: "Test" });
      executeWorkflow(workflow.id);
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/workflows/executions/list", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("DELETE /api/workflows/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/workflows/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/workflows/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/workflows/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
