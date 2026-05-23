import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import contractRoutes from "../routes/contractTesting.js";
import {
  defineContract,
  getContracts,
  getContract,
  updateContract,
  deleteContract,
  validateResponse,
  getResults,
  getContractStats,
  clearContractData,
} from "../utils/contractTesting.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "contract_tests.json");

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
  app.use(contractRoutes);
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

describe("Contract Testing", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearContractData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("defineContract defines a contract", () => {
      const contract = defineContract({
        name: "Health Check API",
        endpoint: { method: "GET", path: "/api/health" },
        response: {
          status: 200,
          bodySchema: { status: "string", uptime: "number" },
        },
        userId: "admin",
      });
      expect(contract).toHaveProperty("id");
      expect(contract.name).toBe("Health Check API");
    });

    test("getContracts returns contracts", () => {
      defineContract({ name: "C1" });
      defineContract({ name: "C2" });
      expect(getContracts().length).toBe(2);
    });

    test("getContracts filters by enabled", () => {
      defineContract({ name: "Enabled", enabled: true });
      defineContract({ name: "Disabled", enabled: false });
      expect(getContracts({ enabled: true }).length).toBe(1);
    });

    test("getContract returns specific contract", () => {
      const created = defineContract({ name: "Test" });
      expect(getContract(created.id).name).toBe("Test");
    });

    test("getContract returns null for unknown", () => {
      expect(getContract("unknown")).toBeNull();
    });

    test("updateContract updates a contract", () => {
      const created = defineContract({ name: "Old" });
      const updated = updateContract(created.id, { name: "New" });
      expect(updated.name).toBe("New");
    });

    test("updateContract returns null for unknown", () => {
      expect(updateContract("unknown", {})).toBeNull();
    });

    test("deleteContract deletes a contract", () => {
      const created = defineContract({ name: "Test" });
      expect(deleteContract(created.id)).toBe(true);
      expect(getContract(created.id)).toBeNull();
    });

    test("deleteContract returns false for unknown", () => {
      expect(deleteContract("unknown")).toBe(false);
    });

    test("validateResponse validates matching response", () => {
      const contract = defineContract({
        name: "Test",
        response: {
          status: 200,
          bodySchema: { name: "required", age: "number" },
        },
      });
      const result = validateResponse(contract.id, {
        status: 200,
        body: { name: "Alice", age: 30 },
      });
      expect(result.valid).toBe(true);
      expect(result.violations.length).toBe(0);
    });

    test("validateResponse detects status mismatch", () => {
      const contract = defineContract({
        name: "Test",
        response: { status: 200 },
      });
      const result = validateResponse(contract.id, { status: 500 });
      expect(result.valid).toBe(false);
      expect(result.violations[0].field).toBe("status");
    });

    test("validateResponse detects missing required fields", () => {
      const contract = defineContract({
        name: "Test",
        response: {
          bodySchema: { name: "required", email: "required" },
        },
      });
      const result = validateResponse(contract.id, {
        status: 200,
        body: { name: "Alice" },
      });
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.field === "body.email")).toBe(true);
    });

    test("validateResponse detects type mismatches", () => {
      const contract = defineContract({
        name: "Test",
        response: {
          bodySchema: { count: "number", active: "boolean" },
        },
      });
      const result = validateResponse(contract.id, {
        body: { count: "not a number", active: "yes" },
      });
      expect(result.valid).toBe(false);
    });

    test("validateResponse returns error for unknown contract", () => {
      expect(validateResponse("unknown", {}).error).toContain("not found");
    });

    test("validateResponse returns error for disabled contract", () => {
      const contract = defineContract({ name: "Test", enabled: false });
      expect(validateResponse(contract.id, {}).error).toContain("disabled");
    });

    test("getResults returns results", () => {
      const contract = defineContract({ name: "Test", response: { status: 200 } });
      validateResponse(contract.id, { status: 200 });
      expect(getResults().total).toBe(1);
    });

    test("getContractStats returns stats", () => {
      defineContract({ name: "Test" });
      const stats = getContractStats();
      expect(stats.totalContracts).toBe(1);
      expect(stats).toHaveProperty("passRate");
    });

    test("clearContractData clears all data", () => {
      defineContract({ name: "Test" });
      clearContractData();
      expect(getContracts().length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/contracts requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/contracts", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "Test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/contracts defines contract for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/contracts", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "Test Contract", endpoint: { method: "GET", path: "/api/health" } },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("Test Contract");
    });

    test("GET /api/contracts requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/contracts", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/contracts returns contracts for admin", async () => {
      defineContract({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/contracts", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/contracts/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/contracts/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalContracts");
    });

    test("POST /api/contracts/:id/validate validates for admin", async () => {
      const contract = defineContract({ name: "Test", response: { status: 200 } });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/contracts/${contract.id}/validate`, {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { status: 200 },
      });
      expect(status).toBe(200);
      expect(body.valid).toBe(true);
    });

    test("GET /api/contracts/results returns results for admin", async () => {
      const contract = defineContract({ name: "Test", response: { status: 200 } });
      validateResponse(contract.id, { status: 200 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/contracts/results", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("DELETE /api/contracts/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/contracts/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/contracts/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/contracts/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
