import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import containerRoutes from "../routes/containerHealth.js";
import {
  registerContainer,
  getContainers,
  getContainer,
  updateContainer,
  deleteContainer,
  recordMetrics,
  getContainerMetrics,
  getLatestMetrics,
  getHealthOverview,
  clearContainerData,
} from "../utils/containerHealth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "container_health.json");

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
  app.use(containerRoutes);
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

describe("Container Health Monitoring", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearContainerData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("registerContainer registers a container", () => {
      const container = registerContainer({
        name: "web-app",
        image: "node:18",
        status: "running",
        ports: ["3000:3000"],
        environment: "production",
      });
      expect(container).toHaveProperty("id");
      expect(container.name).toBe("web-app");
      expect(container.status).toBe("running");
    });

    test("getContainers returns containers", () => {
      registerContainer({ name: "c1" });
      registerContainer({ name: "c2" });
      const result = getContainers();
      expect(result.count).toBe(2);
    });

    test("getContainers filters by status", () => {
      registerContainer({ name: "c1", status: "running" });
      registerContainer({ name: "c2", status: "stopped" });
      const result = getContainers({ status: "running" });
      expect(result.count).toBe(1);
    });

    test("getContainers filters by environment", () => {
      registerContainer({ name: "c1", environment: "production" });
      registerContainer({ name: "c2", environment: "staging" });
      const result = getContainers({ environment: "production" });
      expect(result.count).toBe(1);
    });

    test("getContainer returns specific container", () => {
      const created = registerContainer({ name: "test" });
      const found = getContainer(created.id);
      expect(found.name).toBe("test");
    });

    test("getContainer returns null for unknown", () => {
      expect(getContainer("unknown")).toBeNull();
    });

    test("updateContainer updates a container", () => {
      const created = registerContainer({ name: "old" });
      const updated = updateContainer(created.id, { name: "new", status: "stopped" });
      expect(updated.name).toBe("new");
      expect(updated.status).toBe("stopped");
    });

    test("updateContainer returns null for unknown", () => {
      expect(updateContainer("unknown", {})).toBeNull();
    });

    test("deleteContainer deletes a container", () => {
      const created = registerContainer({ name: "test" });
      expect(deleteContainer(created.id)).toBe(true);
      expect(getContainer(created.id)).toBeNull();
    });

    test("deleteContainer returns false for unknown", () => {
      expect(deleteContainer("unknown")).toBe(false);
    });

    test("recordMetrics records metrics", () => {
      const metric = recordMetrics({
        containerId: "c1",
        cpu: 45.5,
        memory: 512,
        memoryLimit: 1024,
      });
      expect(metric).toHaveProperty("id");
      expect(metric.cpu).toBe(45.5);
      expect(metric.memory).toBe(512);
    });

    test("getContainerMetrics returns metrics for container", () => {
      recordMetrics({ containerId: "c1", cpu: 10 });
      recordMetrics({ containerId: "c1", cpu: 20 });
      recordMetrics({ containerId: "c2", cpu: 30 });
      const result = getContainerMetrics("c1");
      expect(result.total).toBe(2);
    });

    test("getContainerMetrics respects limit", () => {
      for (let i = 0; i < 10; i++) recordMetrics({ containerId: "c1", cpu: i });
      const result = getContainerMetrics("c1", 5);
      expect(result.metrics.length).toBe(5);
    });

    test("getLatestMetrics returns latest per container", () => {
      const container = registerContainer({ name: "web" });
      recordMetrics({ containerId: container.id, cpu: 10 });
      recordMetrics({ containerId: container.id, cpu: 50 });
      const latest = getLatestMetrics();
      expect(latest.length).toBe(1);
      expect(latest[0].metrics.cpu).toBe(50);
    });

    test("getHealthOverview returns overview", () => {
      registerContainer({ name: "c1", status: "running" });
      registerContainer({ name: "c2", status: "stopped" });
      registerContainer({ name: "c3", status: "unhealthy" });
      const overview = getHealthOverview();
      expect(overview.total).toBe(3);
      expect(overview.running).toBe(1);
      expect(overview.stopped).toBe(1);
      expect(overview.unhealthy).toBe(1);
    });

    test("clearContainerData clears all data", () => {
      registerContainer({ name: "test" });
      recordMetrics({ containerId: "test" });
      clearContainerData();
      expect(getContainers().count).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/containers requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/containers", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/containers registers for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/containers", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "web-app", image: "node:18" },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("web-app");
    });

    test("GET /api/containers returns containers for admin", async () => {
      registerContainer({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/containers", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/containers/overview returns overview for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/containers/overview", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("GET /api/containers/latest returns latest for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/containers/latest", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("POST /api/containers/metrics records metrics for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/containers/metrics", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { containerId: "c1", cpu: 45.5, memory: 512 },
      });
      expect(status).toBe(201);
      expect(body.cpu).toBe(45.5);
    });

    test("DELETE /api/containers/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/containers/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/containers/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/containers/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("GET /api/containers/:id returns container for admin", async () => {
      const created = registerContainer({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/containers/${created.id}`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("test");
    });

    test("GET /api/containers/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/containers/unknown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("PUT /api/containers/:id updates for admin", async () => {
      const created = registerContainer({ name: "old" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/containers/${created.id}`, {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { status: "stopped" },
      });
      expect(status).toBe(200);
      expect(body.status).toBe("stopped");
    });

    test("DELETE /api/containers/:id deletes for admin", async () => {
      const created = registerContainer({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/containers/${created.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });

    test("DELETE /api/containers/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/containers/unknown", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("GET /api/containers/:id/metrics returns metrics for admin", async () => {
      const container = registerContainer({ name: "test" });
      recordMetrics({ containerId: container.id, cpu: 50 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/containers/${container.id}/metrics`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });
  });
});
