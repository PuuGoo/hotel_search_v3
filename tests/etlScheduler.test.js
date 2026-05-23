import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import etlRoutes from "../routes/etlScheduler.js";
import {
  createJob,
  getJobs,
  getJob,
  updateJob,
  deleteJob,
  executeJob,
  getRuns,
  getRun,
  getSchedulerStats,
  clearSchedulerData,
} from "../utils/etlScheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "etl_scheduler.json");

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
  app.use(etlRoutes);
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

describe("ETL Scheduler", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearSchedulerData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("createJob creates a job", () => {
      const job = createJob({
        name: "Test Job",
        source: { type: "database", config: {} },
        transform: { type: "map", config: {} },
        destination: { type: "file", config: {} },
        userId: "admin",
      });
      expect(job).toHaveProperty("id");
      expect(job.name).toBe("Test Job");
      expect(job.source.type).toBe("database");
    });

    test("getJobs returns jobs", () => {
      createJob({ name: "Job 1" });
      createJob({ name: "Job 2" });
      const jobs = getJobs();
      expect(jobs.length).toBe(2);
    });

    test("getJobs filters by enabled", () => {
      createJob({ name: "Enabled", enabled: true });
      createJob({ name: "Disabled", enabled: false });
      const jobs = getJobs({ enabled: true });
      expect(jobs.length).toBe(1);
    });

    test("getJob returns specific job", () => {
      const created = createJob({ name: "Test" });
      const job = getJob(created.id);
      expect(job.name).toBe("Test");
    });

    test("getJob returns null for unknown", () => {
      expect(getJob("unknown")).toBeNull();
    });

    test("updateJob updates a job", () => {
      const created = createJob({ name: "Old Name" });
      const updated = updateJob(created.id, { name: "New Name" });
      expect(updated.name).toBe("New Name");
    });

    test("updateJob returns null for unknown", () => {
      expect(updateJob("unknown", {})).toBeNull();
    });

    test("deleteJob deletes a job", () => {
      const created = createJob({ name: "Test" });
      expect(deleteJob(created.id)).toBe(true);
      expect(getJob(created.id)).toBeNull();
    });

    test("deleteJob returns false for unknown", () => {
      expect(deleteJob("unknown")).toBe(false);
    });

    test("executeJob executes a job", () => {
      const job = createJob({
        name: "Test",
        source: { type: "api" },
        transform: { type: "filter" },
        destination: { type: "database" },
      });
      const run = executeJob(job.id);
      expect(run.status).toBe("completed");
      expect(run.stages.length).toBe(3);
      expect(run.recordsExtracted).toBeGreaterThan(0);
      expect(run.recordsTransformed).toBe(run.recordsExtracted);
      expect(run.recordsLoaded).toBe(run.recordsTransformed);
    });

    test("executeJob returns error for disabled job", () => {
      const job = createJob({ name: "Test", enabled: false });
      const result = executeJob(job.id);
      expect(result.error).toContain("disabled");
    });

    test("executeJob returns error for unknown job", () => {
      const result = executeJob("unknown");
      expect(result.error).toContain("not found");
    });

    test("getRuns returns runs", () => {
      const job = createJob({ name: "Test" });
      executeJob(job.id);
      const runs = getRuns();
      expect(runs.total).toBe(1);
    });

    test("getRun returns specific run", () => {
      const job = createJob({ name: "Test" });
      const run = executeJob(job.id);
      expect(getRun(run.id)).not.toBeNull();
    });

    test("getRun returns null for unknown", () => {
      expect(getRun("unknown")).toBeNull();
    });

    test("getSchedulerStats returns stats", () => {
      createJob({ name: "Test" });
      const stats = getSchedulerStats();
      expect(stats.totalJobs).toBe(1);
      expect(stats).toHaveProperty("enabledJobs");
      expect(stats).toHaveProperty("totalRecords");
    });

    test("clearSchedulerData clears all data", () => {
      createJob({ name: "Test" });
      clearSchedulerData();
      expect(getJobs().length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/etl/jobs requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/etl/jobs", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
        body: { name: "Test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/etl/jobs creates job for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/etl/jobs", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "Test Job", source: { type: "api" } },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("Test Job");
    });

    test("GET /api/etl/jobs requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/etl/jobs", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/etl/jobs returns jobs for admin", async () => {
      createJob({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/etl/jobs", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/etl/stats returns stats for admin", async () => {
      createJob({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/etl/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalJobs");
    });

    test("POST /api/etl/jobs/:id/execute executes job for admin", async () => {
      const job = createJob({ name: "Test", source: { type: "api" } });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/etl/jobs/${job.id}/execute`, {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(201);
      expect(body.status).toBe("completed");
    });

    test("GET /api/etl/runs/list returns runs for admin", async () => {
      const job = createJob({ name: "Test" });
      executeJob(job.id);
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/etl/runs/list", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("DELETE /api/etl/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/etl/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/etl/clear clears for admin", async () => {
      createJob({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/etl/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
