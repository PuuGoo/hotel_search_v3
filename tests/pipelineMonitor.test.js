import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import monitorRoutes from "../routes/pipelineMonitor.js";
import {
  recordMetric,
  getMetrics,
  getPipelineStatuses,
  getPipelineStatus,
  getAlerts,
  acknowledgeAlert,
  getMonitorStats,
  clearMonitorData,
} from "../utils/pipelineMonitor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "pipeline_monitor.json");

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
  app.use(monitorRoutes);
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

describe("Pipeline Monitor", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearMonitorData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("recordMetric records a metric", () => {
      const metric = recordMetric({
        pipelineId: "p1",
        pipelineName: "Test Pipeline",
        status: "completed",
        duration: 1000,
      });
      expect(metric).toHaveProperty("id");
      expect(metric.status).toBe("completed");
    });

    test("getMetrics returns metrics", () => {
      recordMetric({ pipelineId: "p1", status: "completed" });
      recordMetric({ pipelineId: "p1", status: "completed" });
      const result = getMetrics("p1");
      expect(result.total).toBe(2);
    });

    test("getMetrics filters by pipelineId", () => {
      recordMetric({ pipelineId: "p1", status: "completed" });
      recordMetric({ pipelineId: "p2", status: "completed" });
      const result = getMetrics("p1");
      expect(result.total).toBe(1);
    });

    test("getPipelineStatuses returns all statuses", () => {
      recordMetric({ pipelineId: "p1", pipelineName: "P1", status: "completed" });
      recordMetric({ pipelineId: "p2", pipelineName: "P2", status: "completed" });
      const statuses = getPipelineStatuses();
      expect(statuses.length).toBe(2);
    });

    test("getPipelineStatus returns specific status", () => {
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "completed" });
      const status = getPipelineStatus("p1");
      expect(status.pipelineName).toBe("Test");
      expect(status.totalExecutions).toBe(1);
    });

    test("getPipelineStatus returns null for unknown", () => {
      expect(getPipelineStatus("unknown")).toBeNull();
    });

    test("alerts generated on consecutive failures", () => {
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      const alerts = getAlerts();
      expect(alerts.total).toBe(1);
      expect(alerts.alerts[0].type).toBe("consecutive_failures");
    });

    test("consecutive failures reset on success", () => {
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "completed" });
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      // Only 2 consecutive failures after the success, no alert yet
      const alerts = getAlerts();
      expect(alerts.total).toBe(0);
    });

    test("acknowledgeAlert acknowledges an alert", () => {
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      const alerts = getAlerts();
      const result = acknowledgeAlert(alerts.alerts[0].id);
      expect(result.acknowledged).toBe(true);
    });

    test("acknowledgeAlert returns null for unknown", () => {
      expect(acknowledgeAlert("unknown")).toBeNull();
    });

    test("getAlerts filters by acknowledged", () => {
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      const alerts = getAlerts();
      acknowledgeAlert(alerts.alerts[0].id);
      const unack = getAlerts({ acknowledged: false });
      expect(unack.total).toBe(0);
    });

    test("getMonitorStats returns stats", () => {
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "completed" });
      const stats = getMonitorStats();
      expect(stats.totalMetrics).toBe(1);
      expect(stats.pipelinesMonitored).toBe(1);
    });

    test("clearMonitorData clears all data", () => {
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "completed" });
      clearMonitorData();
      expect(getMetrics().total).toBe(0);
      expect(getPipelineStatuses().length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/pipeline-monitor/metrics requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/pipeline-monitor/metrics", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { pipelineId: "p1", status: "completed" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/pipeline-monitor/metrics records metric for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/pipeline-monitor/metrics", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { pipelineId: "p1", pipelineName: "Test", status: "completed" },
      });
      expect(status).toBe(201);
      expect(body.status).toBe("completed");
    });

    test("GET /api/pipeline-monitor/metrics requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/pipeline-monitor/metrics", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/pipeline-monitor/metrics returns metrics for admin", async () => {
      recordMetric({ pipelineId: "p1", status: "completed" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/pipeline-monitor/metrics", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("GET /api/pipeline-monitor/status returns statuses for admin", async () => {
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "completed" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/pipeline-monitor/status", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/pipeline-monitor/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/pipeline-monitor/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalMetrics");
    });

    test("GET /api/pipeline-monitor/alerts returns alerts for admin", async () => {
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/pipeline-monitor/alerts", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("PUT /api/pipeline-monitor/alerts/:id/acknowledge works for admin", async () => {
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      recordMetric({ pipelineId: "p1", pipelineName: "Test", status: "failed" });
      const alerts = getAlerts();
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/pipeline-monitor/alerts/${alerts.alerts[0].id}/acknowledge`, {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.acknowledged).toBe(true);
    });

    test("DELETE /api/pipeline-monitor/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/pipeline-monitor/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/pipeline-monitor/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/pipeline-monitor/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
