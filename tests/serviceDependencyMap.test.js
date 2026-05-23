import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dependencyRoutes from "../routes/serviceDependencyMap.js";
import {
  registerService,
  getServices,
  getService,
  getServiceByName,
  updateService,
  deleteService,
  recordHealth,
  getHealthRecords,
  getDependencyGraph,
  analyzeDependencies,
  getDependencyStats,
  clearDependencyData,
} from "../utils/serviceDependencyMap.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "service_dependencies.json");

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
  app.use(dependencyRoutes);
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

describe("Service Dependency Map", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearDependencyData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("registerService registers a service", () => {
      const service = registerService({
        name: "api-gateway",
        type: "gateway",
        url: "http://gateway:8080",
        dependencies: ["user-service", "search-service"],
        userId: "admin",
      });
      expect(service).toHaveProperty("id");
      expect(service.name).toBe("api-gateway");
      expect(service.type).toBe("gateway");
      expect(service.dependencies.length).toBe(2);
    });

    test("getServices returns services", () => {
      registerService({ name: "s1" });
      registerService({ name: "s2" });
      const result = getServices();
      expect(result.count).toBe(2);
    });

    test("getServices filters by type", () => {
      registerService({ name: "s1", type: "microservice" });
      registerService({ name: "s2", type: "database" });
      const result = getServices({ type: "microservice" });
      expect(result.count).toBe(1);
    });

    test("getServices filters by tag", () => {
      registerService({ name: "s1", tags: ["core", "critical"] });
      registerService({ name: "s2", tags: ["auxiliary"] });
      const result = getServices({ tag: "core" });
      expect(result.count).toBe(1);
    });

    test("getService returns specific service", () => {
      const created = registerService({ name: "test" });
      const found = getService(created.id);
      expect(found.name).toBe("test");
    });

    test("getService returns null for unknown", () => {
      expect(getService("unknown")).toBeNull();
    });

    test("getServiceByName returns service by name", () => {
      registerService({ name: "api-gateway" });
      const found = getServiceByName("api-gateway");
      expect(found.name).toBe("api-gateway");
    });

    test("getServiceByName returns null for unknown", () => {
      expect(getServiceByName("unknown")).toBeNull();
    });

    test("updateService updates a service", () => {
      const created = registerService({ name: "old" });
      const updated = updateService(created.id, { name: "new" });
      expect(updated.name).toBe("new");
    });

    test("updateService returns null for unknown", () => {
      expect(updateService("unknown", {})).toBeNull();
    });

    test("deleteService deletes a service", () => {
      const created = registerService({ name: "test" });
      expect(deleteService(created.id)).toBe(true);
      expect(getService(created.id)).toBeNull();
    });

    test("deleteService returns false for unknown", () => {
      expect(deleteService("unknown")).toBe(false);
    });

    test("recordHealth records health status", () => {
      const record = recordHealth({
        serviceId: "s1",
        serviceName: "api",
        status: "healthy",
        responseTime: 45,
      });
      expect(record).toHaveProperty("id");
      expect(record.status).toBe("healthy");
    });

    test("getHealthRecords returns records for service", () => {
      recordHealth({ serviceId: "s1", status: "healthy" });
      recordHealth({ serviceId: "s1", status: "degraded" });
      recordHealth({ serviceId: "s2", status: "healthy" });
      const result = getHealthRecords("s1");
      expect(result.total).toBe(2);
    });

    test("getDependencyGraph returns graph", () => {
      registerService({ name: "gateway", dependencies: ["api"] });
      registerService({ name: "api", dependencies: ["db"] });
      registerService({ name: "db" });
      const graph = getDependencyGraph();
      expect(graph.nodes.length).toBe(3);
      expect(graph.edges.length).toBe(2);
    });

    test("analyzeDependencies returns analysis", () => {
      registerService({ name: "gateway", dependencies: ["api", "auth"] });
      registerService({ name: "api", dependencies: ["db"] });
      registerService({ name: "db" });
      const analysis = analyzeDependencies();
      expect(analysis.mostDeps[0].name).toBe("gateway");
      expect(analysis.totalServices).toBe(3);
    });

    test("getDependencyStats returns stats", () => {
      registerService({ name: "s1", type: "microservice", dependencies: ["s2"] });
      registerService({ name: "s2", type: "database" });
      const stats = getDependencyStats();
      expect(stats.totalServices).toBe(2);
      expect(stats.servicesWithDeps).toBe(1);
    });

    test("clearDependencyData clears all data", () => {
      registerService({ name: "test" });
      recordHealth({ serviceId: "test" });
      clearDependencyData();
      expect(getServices().count).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/dependencies/services requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/dependencies/services", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/dependencies/services registers for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/dependencies/services", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "api-gateway", type: "gateway" },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("api-gateway");
    });

    test("GET /api/dependencies/services returns services for admin", async () => {
      registerService({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/dependencies/services", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/dependencies/graph returns graph for admin", async () => {
      registerService({ name: "api", dependencies: ["db"] });
      registerService({ name: "db" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/dependencies/graph", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.nodes.length).toBe(2);
      expect(body.edges.length).toBe(1);
    });

    test("GET /api/dependencies/analysis returns analysis for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/dependencies/analysis", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("GET /api/dependencies/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/dependencies/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("POST /api/dependencies/health records health for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/dependencies/health", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { serviceId: "s1", status: "healthy" },
      });
      expect(status).toBe(201);
      expect(body.status).toBe("healthy");
    });

    test("DELETE /api/dependencies/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/dependencies/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/dependencies/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/dependencies/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("GET /api/dependencies/services/by-name/:name returns service for admin", async () => {
      registerService({ name: "api-gateway" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/dependencies/services/by-name/api-gateway", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("api-gateway");
    });

    test("GET /api/dependencies/services/by-name/:name returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/dependencies/services/by-name/unknown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("GET /api/dependencies/services/:id returns service for admin", async () => {
      const created = registerService({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/dependencies/services/${created.id}`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("test");
    });

    test("GET /api/dependencies/services/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/dependencies/services/unknown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("PUT /api/dependencies/services/:id updates for admin", async () => {
      const created = registerService({ name: "old" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/dependencies/services/${created.id}`, {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "new" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("new");
    });

    test("DELETE /api/dependencies/services/:id deletes for admin", async () => {
      const created = registerService({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/dependencies/services/${created.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });

    test("DELETE /api/dependencies/services/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/dependencies/services/unknown", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("GET /api/dependencies/services/:id/health returns health for admin", async () => {
      const service = registerService({ name: "test" });
      recordHealth({ serviceId: service.id, status: "healthy" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/dependencies/services/${service.id}/health`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });
  });
});
