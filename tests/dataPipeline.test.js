import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pipelineRoutes from "../routes/dataPipeline.js";
import {
  createPipeline,
  getPipelines,
  getPipeline,
  updatePipeline,
  deletePipeline,
  executePipeline,
  getExecutions,
  getExecution,
  getPipelineStats,
  clearPipelineData,
} from "../utils/dataPipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "data_pipeline.json");

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
  app.use(pipelineRoutes);
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

describe("Data Pipeline", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearPipelineData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("createPipeline creates a pipeline", () => {
      const pipeline = createPipeline({
        name: "Test Pipeline",
        steps: [{ name: "Step 1", type: "transform" }],
        userId: "admin",
      });
      expect(pipeline).toHaveProperty("id");
      expect(pipeline.name).toBe("Test Pipeline");
      expect(pipeline.steps.length).toBe(1);
    });

    test("getPipelines returns pipelines", () => {
      createPipeline({ name: "Pipeline 1" });
      createPipeline({ name: "Pipeline 2" });
      const pipelines = getPipelines();
      expect(pipelines.length).toBe(2);
    });

    test("getPipelines filters by enabled", () => {
      createPipeline({ name: "Enabled", enabled: true });
      createPipeline({ name: "Disabled", enabled: false });
      const pipelines = getPipelines({ enabled: true });
      expect(pipelines.length).toBe(1);
    });

    test("getPipeline returns specific pipeline", () => {
      const created = createPipeline({ name: "Test" });
      const pipeline = getPipeline(created.id);
      expect(pipeline.name).toBe("Test");
    });

    test("getPipeline returns null for unknown", () => {
      expect(getPipeline("unknown")).toBeNull();
    });

    test("updatePipeline updates a pipeline", () => {
      const created = createPipeline({ name: "Old Name" });
      const updated = updatePipeline(created.id, { name: "New Name" });
      expect(updated.name).toBe("New Name");
    });

    test("updatePipeline returns null for unknown", () => {
      expect(updatePipeline("unknown", {})).toBeNull();
    });

    test("deletePipeline deletes a pipeline", () => {
      const created = createPipeline({ name: "Test" });
      expect(deletePipeline(created.id)).toBe(true);
      expect(getPipeline(created.id)).toBeNull();
    });

    test("deletePipeline returns false for unknown", () => {
      expect(deletePipeline("unknown")).toBe(false);
    });

    test("executePipeline executes a pipeline", () => {
      const pipeline = createPipeline({
        name: "Test",
        steps: [
          { name: "Extract", type: "extract" },
          { name: "Transform", type: "transform" },
        ],
      });
      const execution = executePipeline(pipeline.id);
      expect(execution.status).toBe("completed");
      expect(execution.steps.length).toBe(2);
    });

    test("executePipeline returns error for disabled pipeline", () => {
      const pipeline = createPipeline({ name: "Test", enabled: false });
      const result = executePipeline(pipeline.id);
      expect(result.error).toContain("disabled");
    });

    test("executePipeline returns error for unknown pipeline", () => {
      const result = executePipeline("unknown");
      expect(result.error).toContain("not found");
    });

    test("getExecutions returns executions", () => {
      const pipeline = createPipeline({ name: "Test" });
      executePipeline(pipeline.id);
      const executions = getExecutions();
      expect(executions.total).toBe(1);
    });

    test("getExecution returns specific execution", () => {
      const pipeline = createPipeline({ name: "Test" });
      const execution = executePipeline(pipeline.id);
      expect(getExecution(execution.id)).not.toBeNull();
    });

    test("getExecution returns null for unknown", () => {
      expect(getExecution("unknown")).toBeNull();
    });

    test("getPipelineStats returns stats", () => {
      createPipeline({ name: "Test" });
      const stats = getPipelineStats();
      expect(stats.totalPipelines).toBe(1);
      expect(stats).toHaveProperty("enabledPipelines");
    });

    test("clearPipelineData clears all data", () => {
      createPipeline({ name: "Test" });
      clearPipelineData();
      expect(getPipelines().length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/pipelines requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/pipelines", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
        body: { name: "Test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/pipelines creates pipeline for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/pipelines", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "Test Pipeline", steps: [{ name: "Step 1", type: "transform" }] },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("Test Pipeline");
    });

    test("GET /api/pipelines requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/pipelines", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/pipelines returns pipelines for admin", async () => {
      createPipeline({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/pipelines", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/pipelines/stats returns stats for admin", async () => {
      createPipeline({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/pipelines/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalPipelines");
    });

    test("POST /api/pipelines/:id/execute executes pipeline for admin", async () => {
      const pipeline = createPipeline({ name: "Test", steps: [{ name: "Step 1", type: "test" }] });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/pipelines/${pipeline.id}/execute`, {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(201);
      expect(body.status).toBe("completed");
    });

    test("GET /api/pipelines/executions/list returns executions for admin", async () => {
      const pipeline = createPipeline({ name: "Test" });
      executePipeline(pipeline.id);
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/pipelines/executions/list", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("DELETE /api/pipelines/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/pipelines/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/pipelines/clear clears for admin", async () => {
      createPipeline({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/pipelines/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
