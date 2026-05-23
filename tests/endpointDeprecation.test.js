import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import deprecationRoutes from "../routes/endpointDeprecation.js";
import {
  addDeprecation,
  getDeprecations,
  getDeprecation,
  updateDeprecation,
  deleteDeprecation,
  checkEndpoint,
  getDeprecationStats,
  processSunsets,
  clearDeprecationData,
} from "../utils/endpointDeprecation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "endpoint_deprecation.json");

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
  app.use(deprecationRoutes);
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

describe("Endpoint Deprecation Manager", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearDeprecationData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("addDeprecation registers a deprecated endpoint", () => {
      const dep = addDeprecation({
        method: "GET",
        path: "/api/old-search",
        sunsetDate: Date.now() + 86400000,
        replacement: "/api/search",
        reason: "Replaced by new search API",
        userId: "admin",
      });
      expect(dep).toHaveProperty("id");
      expect(dep.method).toBe("GET");
      expect(dep.path).toBe("/api/old-search");
      expect(dep.status).toBe("active");
    });

    test("getDeprecations returns deprecations", () => {
      addDeprecation({ path: "/api/a" });
      addDeprecation({ path: "/api/b" });
      const result = getDeprecations();
      expect(result.total).toBe(2);
    });

    test("getDeprecations filters by status", () => {
      addDeprecation({ path: "/api/a" });
      const result = getDeprecations({ status: "sunset" });
      expect(result.total).toBe(0);
    });

    test("getDeprecation returns specific deprecation", () => {
      const created = addDeprecation({ path: "/api/test" });
      const found = getDeprecation(created.id);
      expect(found.path).toBe("/api/test");
    });

    test("getDeprecation returns null for unknown", () => {
      expect(getDeprecation("unknown")).toBeNull();
    });

    test("updateDeprecation updates a deprecation", () => {
      const created = addDeprecation({ path: "/api/old" });
      const updated = updateDeprecation(created.id, { status: "sunset" });
      expect(updated.status).toBe("sunset");
    });

    test("updateDeprecation returns null for unknown", () => {
      expect(updateDeprecation("unknown", {})).toBeNull();
    });

    test("deleteDeprecation deletes a deprecation", () => {
      const created = addDeprecation({ path: "/api/test" });
      expect(deleteDeprecation(created.id)).toBe(true);
      expect(getDeprecation(created.id)).toBeNull();
    });

    test("deleteDeprecation returns false for unknown", () => {
      expect(deleteDeprecation("unknown")).toBe(false);
    });

    test("checkEndpoint returns deprecation info for deprecated endpoint", () => {
      addDeprecation({
        method: "GET",
        path: "/api/old",
        replacement: "/api/new",
        reason: "Upgraded",
      });
      const result = checkEndpoint("GET", "/api/old");
      expect(result.deprecated).toBe(true);
      expect(result.replacement).toBe("/api/new");
    });

    test("checkEndpoint returns null for non-deprecated endpoint", () => {
      expect(checkEndpoint("GET", "/api/current")).toBeNull();
    });

    test("checkEndpoint detects sunset endpoints", () => {
      addDeprecation({
        method: "POST",
        path: "/api/sunset",
        sunsetDate: Date.now() - 1000,
      });
      const result = checkEndpoint("POST", "/api/sunset");
      expect(result.isSunset).toBe(true);
    });

    test("getDeprecationStats returns stats", () => {
      addDeprecation({ path: "/api/a" });
      addDeprecation({ path: "/api/b", sunsetDate: Date.now() - 1000 });
      const stats = getDeprecationStats();
      expect(stats.total).toBe(2);
      expect(stats.active).toBe(2);
      expect(stats.pastSunset).toBe(1);
    });

    test("processSunsets moves past-sunset to sunset status", () => {
      addDeprecation({ path: "/api/a", sunsetDate: Date.now() - 1000 });
      addDeprecation({ path: "/api/b", sunsetDate: Date.now() + 86400000 });
      const result = processSunsets();
      expect(result.processed).toBe(1);
      const stats = getDeprecationStats();
      expect(stats.sunset).toBe(1);
      expect(stats.active).toBe(1);
    });

    test("clearDeprecationData clears all data", () => {
      addDeprecation({ path: "/api/test" });
      clearDeprecationData();
      expect(getDeprecations().total).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/deprecations requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/deprecations", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { path: "/api/old" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/deprecations creates deprecation for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/deprecations", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { method: "GET", path: "/api/old-search", reason: "Replaced" },
      });
      expect(status).toBe(201);
      expect(body.path).toBe("/api/old-search");
    });

    test("GET /api/deprecations returns deprecations for admin", async () => {
      addDeprecation({ path: "/api/test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/deprecations", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("GET /api/deprecations/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/deprecations/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("POST /api/deprecations/process-sunsets processes for admin", async () => {
      addDeprecation({ path: "/api/old", sunsetDate: Date.now() - 1000 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/deprecations/process-sunsets", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.processed).toBe(1);
    });

    test("POST /api/deprecations/check checks endpoint", async () => {
      addDeprecation({ method: "GET", path: "/api/old" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/deprecations/check", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { method: "GET", path: "/api/old" },
      });
      expect(status).toBe(200);
      expect(body.deprecated).toBe(true);
    });

    test("POST /api/deprecations/check returns non-deprecated for clean endpoint", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/deprecations/check", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { method: "GET", path: "/api/current" },
      });
      expect(status).toBe(200);
      expect(body.deprecated).toBe(false);
    });

    test("POST /api/deprecations/check requires method and path", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/deprecations/check", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("DELETE /api/deprecations/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/deprecations/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/deprecations/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/deprecations/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("GET /api/deprecations/:id returns deprecation for admin", async () => {
      const created = addDeprecation({ path: "/api/test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/deprecations/${created.id}`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.path).toBe("/api/test");
    });

    test("GET /api/deprecations/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/deprecations/unknown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("PUT /api/deprecations/:id updates for admin", async () => {
      const created = addDeprecation({ path: "/api/test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/deprecations/${created.id}`, {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { status: "sunset" },
      });
      expect(status).toBe(200);
      expect(body.status).toBe("sunset");
    });

    test("DELETE /api/deprecations/:id deletes for admin", async () => {
      const created = addDeprecation({ path: "/api/test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/deprecations/${created.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });

    test("DELETE /api/deprecations/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/deprecations/unknown", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });
  });
});
