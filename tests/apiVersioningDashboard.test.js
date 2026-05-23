import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import versioningRoutes from "../routes/apiVersioningDashboard.js";
import {
  registerVersion,
  getVersions,
  getVersion,
  updateVersion,
  deleteVersion,
  recordVersionUsage,
  getVersionUsage,
  getUsageBreakdown,
  getVersioningStats,
  processSunsets,
  clearVersioningData,
} from "../utils/apiVersioningDashboard.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "api_versioning.json");

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
  app.use(versioningRoutes);
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

describe("API Versioning Dashboard", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearVersioningData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("registerVersion registers a version", () => {
      const version = registerVersion({
        version: "1",
        name: "v1.0",
        description: "Initial API version",
        baseUrl: "/api/v1",
        userId: "admin",
      });
      expect(version).toHaveProperty("id");
      expect(version.version).toBe("1");
      expect(version.name).toBe("v1.0");
      expect(version.status).toBe("active");
    });

    test("getVersions returns versions", () => {
      registerVersion({ version: "1" });
      registerVersion({ version: "2" });
      const result = getVersions();
      expect(result.count).toBe(2);
    });

    test("getVersions filters by status", () => {
      registerVersion({ version: "1", status: "active" });
      registerVersion({ version: "2", status: "deprecated" });
      const result = getVersions({ status: "active" });
      expect(result.count).toBe(1);
    });

    test("getVersion returns specific version", () => {
      const created = registerVersion({ version: "1" });
      const found = getVersion(created.id);
      expect(found.version).toBe("1");
    });

    test("getVersion returns null for unknown", () => {
      expect(getVersion("unknown")).toBeNull();
    });

    test("updateVersion updates a version", () => {
      const created = registerVersion({ version: "1" });
      const updated = updateVersion(created.id, { status: "deprecated" });
      expect(updated.status).toBe("deprecated");
    });

    test("updateVersion returns null for unknown", () => {
      expect(updateVersion("unknown", {})).toBeNull();
    });

    test("deleteVersion deletes a version", () => {
      const created = registerVersion({ version: "1" });
      expect(deleteVersion(created.id)).toBe(true);
      expect(getVersion(created.id)).toBeNull();
    });

    test("deleteVersion returns false for unknown", () => {
      expect(deleteVersion("unknown")).toBe(false);
    });

    test("recordVersionUsage records usage", () => {
      const record = recordVersionUsage({
        version: "1",
        path: "/api/v1/search",
        clientId: "client1",
      });
      expect(record).toHaveProperty("id");
      expect(record.version).toBe("1");
    });

    test("getVersionUsage returns usage records", () => {
      recordVersionUsage({ version: "1", path: "/api/v1/a" });
      recordVersionUsage({ version: "2", path: "/api/v2/b" });
      const result = getVersionUsage();
      expect(result.total).toBe(2);
    });

    test("getVersionUsage filters by version", () => {
      recordVersionUsage({ version: "1", path: "/api/v1/a" });
      recordVersionUsage({ version: "2", path: "/api/v2/b" });
      const result = getVersionUsage({ version: "1" });
      expect(result.total).toBe(1);
    });

    test("getUsageBreakdown returns breakdown", () => {
      recordVersionUsage({ version: "1", path: "/api/v1/a" });
      recordVersionUsage({ version: "1", path: "/api/v1/b" });
      recordVersionUsage({ version: "2", path: "/api/v2/c" });
      const breakdown = getUsageBreakdown();
      expect(breakdown.length).toBe(2);
      expect(breakdown[0].version).toBe("1");
      expect(breakdown[0].count).toBe(2);
    });

    test("getVersioningStats returns stats", () => {
      registerVersion({ version: "1", status: "active" });
      registerVersion({ version: "2", status: "deprecated" });
      recordVersionUsage({ version: "1", clientId: "c1" });
      const stats = getVersioningStats();
      expect(stats.totalVersions).toBe(2);
      expect(stats.active).toBe(1);
      expect(stats.deprecated).toBe(1);
      expect(stats.totalUsageRecords).toBe(1);
    });

    test("processSunsets moves past-sunset to sunset", () => {
      registerVersion({ version: "1", sunsetDate: Date.now() - 1000 });
      registerVersion({ version: "2", sunsetDate: Date.now() + 86400000 });
      const result = processSunsets();
      expect(result.processed).toBe(1);
      const stats = getVersioningStats();
      expect(stats.sunset).toBe(1);
    });

    test("clearVersioningData clears all data", () => {
      registerVersion({ version: "1" });
      recordVersionUsage({ version: "1" });
      clearVersioningData();
      expect(getVersions().count).toBe(0);
      expect(getVersionUsage().total).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/versions requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/versions", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { version: "1" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/versions registers version for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/versions", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { version: "1", name: "v1.0" },
      });
      expect(status).toBe(201);
      expect(body.version).toBe("1");
    });

    test("GET /api/versions returns versions for admin", async () => {
      registerVersion({ version: "1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/versions", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/versions/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/versions/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("GET /api/versions/breakdown returns breakdown for admin", async () => {
      recordVersionUsage({ version: "1" });
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/versions/breakdown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("POST /api/versions/usage records usage for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/versions/usage", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { version: "1", path: "/api/v1/search" },
      });
      expect(status).toBe(201);
      expect(body.version).toBe("1");
    });

    test("GET /api/versions/usage returns usage for admin", async () => {
      recordVersionUsage({ version: "1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/versions/usage", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("POST /api/versions/process-sunsets processes for admin", async () => {
      registerVersion({ version: "1", sunsetDate: Date.now() - 1000 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/versions/process-sunsets", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.processed).toBe(1);
    });

    test("DELETE /api/versions/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/versions/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/versions/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/versions/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("GET /api/versions/:id returns version for admin", async () => {
      const created = registerVersion({ version: "1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/versions/${created.id}`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.version).toBe("1");
    });

    test("GET /api/versions/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/versions/unknown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("PUT /api/versions/:id updates for admin", async () => {
      const created = registerVersion({ version: "1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/versions/${created.id}`, {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { status: "deprecated" },
      });
      expect(status).toBe(200);
      expect(body.status).toBe("deprecated");
    });

    test("DELETE /api/versions/:id deletes for admin", async () => {
      const created = registerVersion({ version: "1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/versions/${created.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });

    test("DELETE /api/versions/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/versions/unknown", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });
  });
});
