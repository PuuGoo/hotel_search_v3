import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import envConfigRoutes from "../routes/envConfigManager.js";
import {
  defineEnvironment,
  getEnvironments,
  getEnvironment,
  updateEnvironment,
  deleteEnvironment,
  validateEnvironment,
  compareEnvironments,
  getConfigHistory,
  getConfigStats,
  clearConfigData,
} from "../utils/envConfigManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "env_configs.json");

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
  app.use(envConfigRoutes);
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

describe("Environment Config Manager", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearConfigData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("defineEnvironment defines an environment", () => {
      const env = defineEnvironment({
        name: "production",
        description: "Production environment",
        variables: { DB_HOST: "prod-db.example.com", DB_PORT: "5432" },
        requiredVars: ["DB_HOST", "DB_PORT"],
        userId: "admin",
      });
      expect(env.name).toBe("production");
      expect(env.variables.DB_HOST).toBe("prod-db.example.com");
    });

    test("getEnvironments returns environments", () => {
      defineEnvironment({ name: "prod" });
      defineEnvironment({ name: "staging" });
      const envs = getEnvironments();
      expect(envs.length).toBe(2);
    });

    test("getEnvironment returns specific environment", () => {
      defineEnvironment({ name: "prod" });
      const env = getEnvironment("prod");
      expect(env.name).toBe("prod");
    });

    test("getEnvironment returns null for unknown", () => {
      expect(getEnvironment("unknown")).toBeNull();
    });

    test("updateEnvironment updates an environment", () => {
      defineEnvironment({ name: "prod", variables: { DB_HOST: "old" } });
      const updated = updateEnvironment("prod", { variables: { DB_HOST: "new" } });
      expect(updated.variables.DB_HOST).toBe("new");
    });

    test("updateEnvironment returns null for unknown", () => {
      expect(updateEnvironment("unknown", {})).toBeNull();
    });

    test("deleteEnvironment deletes an environment", () => {
      defineEnvironment({ name: "prod" });
      expect(deleteEnvironment("prod")).toBe(true);
      expect(getEnvironment("prod")).toBeNull();
    });

    test("deleteEnvironment returns false for unknown", () => {
      expect(deleteEnvironment("unknown")).toBe(false);
    });

    test("validateEnvironment validates valid environment", () => {
      defineEnvironment({
        name: "prod",
        variables: { DB_HOST: "localhost", DB_PORT: "5432" },
        requiredVars: ["DB_HOST", "DB_PORT"],
      });
      const result = validateEnvironment("prod");
      expect(result.valid).toBe(true);
      expect(result.violations.length).toBe(0);
    });

    test("validateEnvironment detects missing required vars", () => {
      defineEnvironment({
        name: "prod",
        variables: { DB_HOST: "localhost" },
        requiredVars: ["DB_HOST", "DB_PORT"],
      });
      const result = validateEnvironment("prod");
      expect(result.valid).toBe(false);
      expect(result.violations[0].variable).toBe("DB_PORT");
    });

    test("validateEnvironment returns error for unknown", () => {
      const result = validateEnvironment("unknown");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("compareEnvironments compares two environments", () => {
      defineEnvironment({ name: "prod", variables: { A: "1", B: "2", C: "3" } });
      defineEnvironment({ name: "staging", variables: { A: "1", B: "99", D: "4" } });
      const result = compareEnvironments("prod", "staging");
      expect(result.same).toContain("A");
      expect(result.different).toContain("B");
      expect(result.onlyIn1).toContain("C");
      expect(result.onlyIn2).toContain("D");
    });

    test("compareEnvironments returns error for unknown", () => {
      const result = compareEnvironments("unknown", "prod");
      expect(result.error).toBeDefined();
    });

    test("getConfigHistory returns history", () => {
      defineEnvironment({ name: "prod" });
      const history = getConfigHistory();
      expect(history.length).toBeGreaterThan(0);
    });

    test("getConfigStats returns stats", () => {
      defineEnvironment({ name: "prod", variables: { A: "1" } });
      const stats = getConfigStats();
      expect(stats.totalEnvironments).toBe(1);
      expect(stats.totalVariables).toBe(1);
    });

    test("clearConfigData clears all data", () => {
      defineEnvironment({ name: "prod" });
      clearConfigData();
      expect(getEnvironments().length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/env-configs requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/env-configs", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "prod" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/env-configs defines environment for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/env-configs", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "production", variables: { DB_HOST: "localhost" } },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("production");
    });

    test("GET /api/env-configs returns environments for admin", async () => {
      defineEnvironment({ name: "prod" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/env-configs", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/env-configs/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/env-configs/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("GET /api/env-configs/history returns history for admin", async () => {
      defineEnvironment({ name: "prod" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/env-configs/history", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBeGreaterThan(0);
    });

    test("POST /api/env-configs/compare compares environments for admin", async () => {
      defineEnvironment({ name: "prod", variables: { A: "1" } });
      defineEnvironment({ name: "staging", variables: { A: "2" } });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/env-configs/compare", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { env1: "prod", env2: "staging" },
      });
      expect(status).toBe(200);
      expect(body.different).toContain("A");
    });

    test("POST /api/env-configs/compare requires env1 and env2", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/env-configs/compare", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/env-configs/:name/validate validates for admin", async () => {
      defineEnvironment({ name: "prod", variables: { A: "1" }, requiredVars: ["A"] });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/env-configs/prod/validate", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.valid).toBe(true);
    });

    test("DELETE /api/env-configs/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/env-configs/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/env-configs/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/env-configs/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("GET /api/env-configs/:name returns environment for admin", async () => {
      defineEnvironment({ name: "prod" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/env-configs/prod", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("prod");
    });

    test("GET /api/env-configs/:name returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/env-configs/unknown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("PUT /api/env-configs/:name updates for admin", async () => {
      defineEnvironment({ name: "prod" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/env-configs/prod", {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { description: "Updated" },
      });
      expect(status).toBe(200);
      expect(body.description).toBe("Updated");
    });

    test("DELETE /api/env-configs/:name deletes for admin", async () => {
      defineEnvironment({ name: "prod" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/env-configs/prod", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });

    test("DELETE /api/env-configs/:name returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/env-configs/unknown", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });
  });
});
