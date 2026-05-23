import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import schemaRoutes from "../routes/requestSchemas.js";
import { schemaValidation } from "../middleware/schemaValidation.js";
import {
  validate,
  getAllSchemas,
  getSchema,
  registerSchema,
  removeSchema,
  getValidationStats,
} from "../utils/requestSchemas.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMAS_FILE = path.join(__dirname, "..", "request_schemas.json");

let dataBackup;

function createTestApp(withMiddleware = false) {
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
  if (withMiddleware) {
    app.use(schemaValidation);
  }
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

describe("Request Validation Schemas", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(SCHEMAS_FILE, "utf8"); } catch { dataBackup = null; }
    try { fs.unlinkSync(SCHEMAS_FILE); } catch {}
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(SCHEMAS_FILE, dataBackup);
    else { try { fs.unlinkSync(SCHEMAS_FILE); } catch {} }
  });

  describe("Validation function", () => {
    test("validates required fields", () => {
      const schema = { type: "object", required: ["name"], properties: { name: { type: "string" } } };
      const result = validate({}, schema);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("name");
    });

    test("validates string minLength", () => {
      const schema = { type: "object", properties: { name: { type: "string", minLength: 3 } } };
      expect(validate({ name: "ab" }, schema).valid).toBe(false);
      expect(validate({ name: "abc" }, schema).valid).toBe(true);
    });

    test("validates string maxLength", () => {
      const schema = { type: "object", properties: { name: { type: "string", maxLength: 5 } } };
      expect(validate({ name: "abcdef" }, schema).valid).toBe(false);
      expect(validate({ name: "abcde" }, schema).valid).toBe(true);
    });

    test("validates string enum", () => {
      const schema = { type: "object", properties: { role: { type: "string", enum: ["user", "admin"] } } };
      expect(validate({ role: "user" }, schema).valid).toBe(true);
      expect(validate({ role: "superadmin" }, schema).valid).toBe(false);
    });

    test("validates number minimum", () => {
      const schema = { type: "object", properties: { price: { type: "number", minimum: 0 } } };
      expect(validate({ price: -1 }, schema).valid).toBe(false);
      expect(validate({ price: 0 }, schema).valid).toBe(true);
    });

    test("validates integer type", () => {
      const schema = { type: "object", properties: { count: { type: "integer" } } };
      expect(validate({ count: 5 }, schema).valid).toBe(true);
      expect(validate({ count: 5.5 }, schema).valid).toBe(false);
    });

    test("validates array minItems", () => {
      const schema = { type: "object", properties: { tags: { type: "array", minItems: 1 } } };
      expect(validate({ tags: [] }, schema).valid).toBe(false);
      expect(validate({ tags: ["a"] }, schema).valid).toBe(true);
    });

    test("validates array maxItems", () => {
      const schema = { type: "object", properties: { tags: { type: "array", maxItems: 2 } } };
      expect(validate({ tags: ["a", "b", "c"] }, schema).valid).toBe(false);
    });

    test("validates URL format", () => {
      const schema = { type: "object", properties: { url: { type: "string", format: "uri" } } };
      expect(validate({ url: "https://example.com" }, schema).valid).toBe(true);
      expect(validate({ url: "not-a-url" }, schema).valid).toBe(false);
    });

    test("returns valid for null schema", () => {
      expect(validate({}, null).valid).toBe(true);
    });

    test("validates type mismatch", () => {
      const schema = { type: "object" };
      expect(validate("string", schema).valid).toBe(false);
    });
  });

  describe("Schema management", () => {
    test("getAllSchemas returns built-in schemas", () => {
      const schemas = getAllSchemas();
      expect(Object.keys(schemas).length).toBeGreaterThan(0);
      expect(schemas).toHaveProperty("POST /api/auth/login");
    });

    test("getSchema returns specific schema", () => {
      const schema = getSchema("POST /api/auth/login");
      expect(schema).not.toBeNull();
      expect(schema.required).toContain("username");
    });

    test("getSchema returns null for unknown", () => {
      expect(getSchema("POST /api/unknown")).toBeNull();
    });

    test("registerSchema adds custom schema", () => {
      const schema = { type: "object", properties: { test: { type: "string" } } };
      registerSchema("POST /api/custom", schema);
      expect(getSchema("POST /api/custom")).toEqual(schema);
    });

    test("removeSchema removes custom schema", () => {
      registerSchema("POST /api/custom", { type: "object" });
      expect(removeSchema("POST /api/custom")).toBe(true);
      expect(getSchema("POST /api/custom")).toBeNull();
    });

    test("removeSchema returns false for unknown", () => {
      expect(removeSchema("POST /api/unknown")).toBe(false);
    });

    test("getValidationStats returns stats", () => {
      const stats = getValidationStats();
      expect(stats.totalSchemas).toBeGreaterThan(0);
      expect(stats.builtinSchemas).toBeGreaterThan(0);
    });
  });

  describe("API Routes", () => {
    test("GET /api/schemas requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/schemas", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/schemas returns all schemas for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/schemas", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBeGreaterThan(0);
    });

    test("GET /api/schemas/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/schemas/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalSchemas");
    });

    test("POST /api/schemas registers custom schema for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/schemas", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { endpoint: "POST /api/test", schema: { type: "object" } },
      });
      expect(status).toBe(201);
      expect(body.message).toContain("registered");
    });

    test("POST /api/schemas validates input", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/schemas", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/schemas/validate validates value", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/schemas/validate", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: {
          value: { username: "test", password: "123456" },
          schema: {
            type: "object",
            required: ["username", "password"],
            properties: { username: { type: "string" }, password: { type: "string", minLength: 6 } },
          },
        },
      });
      expect(status).toBe(200);
      expect(body.valid).toBe(true);
    });

    test("DELETE /api/schemas/:endpoint requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/schemas/POST-api-auth-login", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });
  });
});
