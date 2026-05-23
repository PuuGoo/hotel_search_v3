import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mockRoutes from "../routes/mockServices.js";
import {
  registerService,
  getServices,
  getService,
  updateService,
  deleteService,
  handleRequest,
  getLogs,
  getMockStats,
  clearMockData,
} from "../utils/mockServices.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "mock_services.json");

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
  app.use(mockRoutes);
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

describe("Mock Services", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearMockData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("registerService registers a service", () => {
      const service = registerService({
        name: "Weather API",
        baseUrl: "https://api.weather.com",
        endpoints: [
          { path: "/forecast", method: "GET", response: { temp: 72 }, status: 200 },
        ],
        userId: "admin",
      });
      expect(service).toHaveProperty("id");
      expect(service.name).toBe("Weather API");
      expect(service.endpoints.length).toBe(1);
    });

    test("getServices returns services", () => {
      registerService({ name: "S1" });
      registerService({ name: "S2" });
      expect(getServices().length).toBe(2);
    });

    test("getService returns specific service", () => {
      const created = registerService({ name: "Test" });
      expect(getService(created.id).name).toBe("Test");
    });

    test("getService returns null for unknown", () => {
      expect(getService("unknown")).toBeNull();
    });

    test("updateService updates a service", () => {
      const created = registerService({ name: "Old" });
      const updated = updateService(created.id, { name: "New" });
      expect(updated.name).toBe("New");
    });

    test("updateService returns null for unknown", () => {
      expect(updateService("unknown", {})).toBeNull();
    });

    test("deleteService deletes a service", () => {
      const created = registerService({ name: "Test" });
      expect(deleteService(created.id)).toBe(true);
      expect(getService(created.id)).toBeNull();
    });

    test("deleteService returns false for unknown", () => {
      expect(deleteService("unknown")).toBe(false);
    });

    test("handleRequest handles matching request", () => {
      const service = registerService({
        name: "Test",
        endpoints: [
          { path: "/api/data", method: "GET", response: { data: 123 }, status: 200 },
        ],
      });
      const result = handleRequest(service.id, "GET", "/api/data");
      expect(result.status).toBe(200);
      expect(result.data.data).toBe(123);
    });

    test("handleRequest returns 404 for unmatched endpoint", () => {
      const service = registerService({
        name: "Test",
        endpoints: [
          { path: "/api/data", method: "GET", response: {} },
        ],
      });
      const result = handleRequest(service.id, "GET", "/api/other");
      expect(result.status).toBe(404);
    });

    test("handleRequest returns error for unknown service", () => {
      expect(handleRequest("unknown", "GET", "/").error).toContain("not found");
    });

    test("handleRequest returns error for disabled service", () => {
      const service = registerService({ name: "Test", enabled: false });
      expect(handleRequest(service.id, "GET", "/").error).toContain("disabled");
    });

    test("handleRequest logs requests", () => {
      const service = registerService({
        name: "Test",
        endpoints: [{ path: "/api", method: "GET", response: {} }],
      });
      handleRequest(service.id, "GET", "/api");
      expect(getLogs().total).toBe(1);
    });

    test("getMockStats returns stats", () => {
      registerService({ name: "Test" });
      const stats = getMockStats();
      expect(stats.totalServices).toBe(1);
      expect(stats).toHaveProperty("totalEndpoints");
    });

    test("clearMockData clears all data", () => {
      registerService({ name: "Test" });
      clearMockData();
      expect(getServices().length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/mock/services requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/mock/services", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "Test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/mock/services registers service for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/mock/services", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "Test Service", endpoints: [{ path: "/api", method: "GET", response: { ok: true } }] },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("Test Service");
    });

    test("GET /api/mock/services requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/mock/services", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/mock/services returns services for admin", async () => {
      registerService({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/mock/services", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/mock/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/mock/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalServices");
    });

    test("POST /api/mock/request/:serviceId handles request for admin", async () => {
      const service = registerService({
        name: "Test",
        endpoints: [{ path: "/api/data", method: "GET", response: { data: 1 } }],
      });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/mock/request/${service.id}`, {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { method: "GET", path: "/api/data" },
      });
      expect(status).toBe(200);
      expect(body.data.data).toBe(1);
    });

    test("GET /api/mock/logs returns logs for admin", async () => {
      const service = registerService({
        name: "Test",
        endpoints: [{ path: "/api", method: "GET", response: {} }],
      });
      handleRequest(service.id, "GET", "/api");
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/mock/logs", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("DELETE /api/mock/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/mock/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/mock/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/mock/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
