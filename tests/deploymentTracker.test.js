import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import deploymentRoutes from "../routes/deploymentTracker.js";
import {
  recordDeployment,
  getDeployments,
  getDeployment,
  updateDeployment,
  rollbackDeployment,
  deleteDeployment,
  getDeploymentStats,
  clearDeploymentData,
} from "../utils/deploymentTracker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "deployment_tracker.json");

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
  app.use(deploymentRoutes);
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

describe("Deployment Tracker", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearDeploymentData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("recordDeployment records a deployment", () => {
      const deployment = recordDeployment({
        version: "1.2.3",
        environment: "production",
        service: "hotel-search",
        commitHash: "abc123",
        branch: "main",
        userId: "admin",
      });
      expect(deployment).toHaveProperty("id");
      expect(deployment.version).toBe("1.2.3");
      expect(deployment.status).toBe("deployed");
    });

    test("getDeployments returns deployments", () => {
      recordDeployment({ version: "1.0.0" });
      recordDeployment({ version: "2.0.0" });
      const result = getDeployments();
      expect(result.total).toBe(2);
    });

    test("getDeployments filters by environment", () => {
      recordDeployment({ version: "1.0.0", environment: "production" });
      recordDeployment({ version: "2.0.0", environment: "staging" });
      const result = getDeployments({ environment: "production" });
      expect(result.total).toBe(1);
    });

    test("getDeployments filters by service", () => {
      recordDeployment({ version: "1.0.0", service: "api" });
      recordDeployment({ version: "2.0.0", service: "web" });
      const result = getDeployments({ service: "api" });
      expect(result.total).toBe(1);
    });

    test("getDeployments filters by status", () => {
      recordDeployment({ version: "1.0.0", status: "deployed" });
      recordDeployment({ version: "2.0.0", status: "failed" });
      const result = getDeployments({ status: "deployed" });
      expect(result.total).toBe(1);
    });

    test("getDeployment returns specific deployment", () => {
      const created = recordDeployment({ version: "1.0.0" });
      const found = getDeployment(created.id);
      expect(found.version).toBe("1.0.0");
    });

    test("getDeployment returns null for unknown", () => {
      expect(getDeployment("unknown")).toBeNull();
    });

    test("updateDeployment updates a deployment", () => {
      const created = recordDeployment({ version: "1.0.0" });
      const updated = updateDeployment(created.id, { status: "failed", notes: "Build error" });
      expect(updated.status).toBe("failed");
      expect(updated.notes).toBe("Build error");
    });

    test("updateDeployment returns null for unknown", () => {
      expect(updateDeployment("unknown", {})).toBeNull();
    });

    test("rollbackDeployment creates rollback deployment", () => {
      const original = recordDeployment({ version: "1.0.0", service: "api" });
      const rollback = rollbackDeployment(original.id, "admin");
      expect(rollback.rollbackFrom).toBe(original.id);
      expect(rollback.status).toBe("deployed");

      // Original should be marked as rolled back
      const updatedOriginal = getDeployment(original.id);
      expect(updatedOriginal.status).toBe("rolled_back");
    });

    test("rollbackDeployment returns null for unknown", () => {
      expect(rollbackDeployment("unknown")).toBeNull();
    });

    test("deleteDeployment deletes a deployment", () => {
      const created = recordDeployment({ version: "1.0.0" });
      expect(deleteDeployment(created.id)).toBe(true);
      expect(getDeployment(created.id)).toBeNull();
    });

    test("deleteDeployment returns false for unknown", () => {
      expect(deleteDeployment("unknown")).toBe(false);
    });

    test("getDeploymentStats returns stats", () => {
      recordDeployment({ version: "1.0.0", status: "deployed", environment: "production", service: "api" });
      recordDeployment({ version: "2.0.0", status: "failed", environment: "staging", service: "web" });
      const stats = getDeploymentStats();
      expect(stats.total).toBe(2);
      expect(stats.statusCounts.deployed).toBe(1);
      expect(stats.statusCounts.failed).toBe(1);
    });

    test("clearDeploymentData clears all data", () => {
      recordDeployment({ version: "1.0.0" });
      clearDeploymentData();
      expect(getDeployments().total).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/deployments requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/deployments", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { version: "1.0.0" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/deployments records for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/deployments", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { version: "1.2.3", environment: "production" },
      });
      expect(status).toBe(201);
      expect(body.version).toBe("1.2.3");
    });

    test("GET /api/deployments returns deployments for admin", async () => {
      recordDeployment({ version: "1.0.0" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/deployments", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("GET /api/deployments/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/deployments/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("POST /api/deployments/:id/rollback rolls back for admin", async () => {
      const deployment = recordDeployment({ version: "1.0.0" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/deployments/${deployment.id}/rollback`, {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.rollbackFrom).toBe(deployment.id);
    });

    test("POST /api/deployments/:id/rollback returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/deployments/unknown/rollback", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("DELETE /api/deployments/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/deployments/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/deployments/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/deployments/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("GET /api/deployments/:id returns deployment for admin", async () => {
      const created = recordDeployment({ version: "1.0.0" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/deployments/${created.id}`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.version).toBe("1.0.0");
    });

    test("GET /api/deployments/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/deployments/unknown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("PUT /api/deployments/:id updates for admin", async () => {
      const created = recordDeployment({ version: "1.0.0" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/deployments/${created.id}`, {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { status: "failed" },
      });
      expect(status).toBe(200);
      expect(body.status).toBe("failed");
    });

    test("DELETE /api/deployments/:id deletes for admin", async () => {
      const created = recordDeployment({ version: "1.0.0" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/deployments/${created.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });

    test("DELETE /api/deployments/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/deployments/unknown", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });
  });
});
