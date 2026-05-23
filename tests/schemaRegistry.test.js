import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import schemaRoutes from "../routes/schemaRegistry.js";
import {
  registerSchema,
  getSchemas,
  getSchema,
  getSchemasByName,
  updateSchema,
  deleteSchema,
  validateAgainstSchema,
  getSchemaStats,
  clearSchemaData,
} from "../utils/schemaRegistry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "schema_registry.json");

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
  app.use(schemaRoutes);
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

describe("Schema Registry", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearSchemaData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("registerSchema registers a schema", () => {
      const schema = registerSchema({
        name: "Search Request",
        type: "request",
        endpoint: "/api/search",
        method: "POST",
        schema: {
          properties: {
            query: { type: "string", required: true },
            engine: { type: "string", enum: ["ddg", "tavily", "google"] },
          },
        },
        userId: "admin",
      });
      expect(schema).toHaveProperty("id");
      expect(schema.name).toBe("Search Request");
      expect(schema.type).toBe("request");
    });

    test("getSchemas returns schemas", () => {
      registerSchema({ name: "S1" });
      registerSchema({ name: "S2" });
      const result = getSchemas();
      expect(result.total).toBe(2);
    });

    test("getSchemas filters by type", () => {
      registerSchema({ name: "Req", type: "request" });
      registerSchema({ name: "Res", type: "response" });
      registerSchema({ name: "Both", type: "both" });
      const result = getSchemas({ type: "request" });
      expect(result.total).toBe(2); // request + both
    });

    test("getSchemas filters by endpoint", () => {
      registerSchema({ name: "A", endpoint: "/api/search" });
      registerSchema({ name: "B", endpoint: "/api/users" });
      const result = getSchemas({ endpoint: "/api/search" });
      expect(result.total).toBe(1);
    });

    test("getSchema returns specific schema", () => {
      const created = registerSchema({ name: "Test" });
      const found = getSchema(created.id);
      expect(found.name).toBe("Test");
    });

    test("getSchema returns null for unknown", () => {
      expect(getSchema("unknown")).toBeNull();
    });

    test("getSchemasByName returns schemas by name", () => {
      registerSchema({ name: "Search", version: "1.0.0" });
      registerSchema({ name: "Search", version: "2.0.0" });
      registerSchema({ name: "Users" });
      const schemas = getSchemasByName("Search");
      expect(schemas.length).toBe(2);
    });

    test("updateSchema updates a schema", () => {
      const created = registerSchema({ name: "Old" });
      const updated = updateSchema(created.id, { name: "New" });
      expect(updated.name).toBe("New");
    });

    test("updateSchema returns null for unknown", () => {
      expect(updateSchema("unknown", {})).toBeNull();
    });

    test("deleteSchema deletes a schema", () => {
      const created = registerSchema({ name: "Test" });
      expect(deleteSchema(created.id)).toBe(true);
      expect(getSchema(created.id)).toBeNull();
    });

    test("deleteSchema returns false for unknown", () => {
      expect(deleteSchema("unknown")).toBe(false);
    });

    test("validateAgainstSchema validates valid data", () => {
      const schema = registerSchema({
        name: "User",
        schema: {
          properties: {
            name: { type: "string", required: true },
            age: { type: "number", minimum: 0 },
          },
        },
      });
      const result = validateAgainstSchema(schema.id, { name: "Alice", age: 30 });
      expect(result.valid).toBe(true);
      expect(result.violations.length).toBe(0);
    });

    test("validateAgainstSchema detects missing required fields", () => {
      const schema = registerSchema({
        name: "User",
        schema: {
          properties: {
            name: { type: "string", required: true },
            email: { type: "string", required: true },
          },
        },
      });
      const result = validateAgainstSchema(schema.id, { name: "Alice" });
      expect(result.valid).toBe(false);
      expect(result.violations[0].field).toBe("email");
    });

    test("validateAgainstSchema detects type mismatches", () => {
      const schema = registerSchema({
        name: "User",
        schema: {
          properties: {
            count: { type: "number" },
            active: { type: "boolean" },
          },
        },
      });
      const result = validateAgainstSchema(schema.id, { count: "not a number", active: "yes" });
      expect(result.valid).toBe(false);
    });

    test("validateAgainstSchema detects enum violations", () => {
      const schema = registerSchema({
        name: "Search",
        schema: {
          properties: {
            engine: { type: "string", enum: ["ddg", "tavily"] },
          },
        },
      });
      const result = validateAgainstSchema(schema.id, { engine: "google" });
      expect(result.valid).toBe(false);
    });

    test("validateAgainstSchema detects unexpected fields", () => {
      const schema = registerSchema({
        name: "User",
        schema: {
          properties: { name: { type: "string" } },
          additionalProperties: false,
        },
      });
      const result = validateAgainstSchema(schema.id, { name: "Alice", extra: "field" });
      expect(result.valid).toBe(false);
    });

    test("validateAgainstSchema returns error for unknown schema", () => {
      const result = validateAgainstSchema("unknown", {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("getSchemaStats returns stats", () => {
      registerSchema({ name: "A", type: "request", endpoint: "/api/a" });
      registerSchema({ name: "B", type: "response", endpoint: "/api/b" });
      const stats = getSchemaStats();
      expect(stats.totalSchemas).toBe(2);
      expect(stats.uniqueNames).toBe(2);
      expect(stats.endpointsCovered).toBe(2);
    });

    test("clearSchemaData clears all data", () => {
      registerSchema({ name: "Test" });
      clearSchemaData();
      expect(getSchemas().total).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/schemas requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/schemas", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "Test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/schemas registers schema for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/schemas", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "Search Request", type: "request", endpoint: "/api/search" },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("Search Request");
    });

    test("GET /api/schemas returns schemas for admin", async () => {
      registerSchema({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/schemas", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("GET /api/schemas/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/schemas/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("GET /api/schemas/by-name/:name returns schemas by name for admin", async () => {
      registerSchema({ name: "Search" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/schemas/by-name/Search", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("POST /api/schemas/:id/validate validates for admin", async () => {
      const schema = registerSchema({
        name: "Test",
        schema: { properties: { name: { type: "string", required: true } } },
      });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/schemas/${schema.id}/validate`, {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "Alice" },
      });
      expect(status).toBe(200);
      expect(body.valid).toBe(true);
    });

    test("DELETE /api/schemas/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/schemas/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/schemas/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/schemas/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("GET /api/schemas/:id returns schema for admin", async () => {
      const created = registerSchema({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/schemas/${created.id}`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("Test");
    });

    test("GET /api/schemas/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/schemas/unknown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("PUT /api/schemas/:id updates for admin", async () => {
      const created = registerSchema({ name: "Old" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/schemas/${created.id}`, {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "New" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("New");
    });

    test("DELETE /api/schemas/:id deletes for admin", async () => {
      const created = registerSchema({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/schemas/${created.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });

    test("DELETE /api/schemas/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/schemas/unknown", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });
  });
});
