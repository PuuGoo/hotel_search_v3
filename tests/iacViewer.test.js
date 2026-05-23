import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import iacRoutes from "../routes/iacViewer.js";
import {
  registerTemplate,
  getTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  validateTemplate,
  getValidationHistory,
  getIacStats,
  clearIacData,
} from "../utils/iacViewer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "iac_templates.json");

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
  app.use(iacRoutes);
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

describe("IaC Viewer", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearIacData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("registerTemplate registers a template", () => {
      const template = registerTemplate({
        name: "main-vpc",
        type: "terraform",
        provider: "aws",
        content: 'resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }',
        userId: "admin",
      });
      expect(template).toHaveProperty("id");
      expect(template.name).toBe("main-vpc");
      expect(template.type).toBe("terraform");
    });

    test("getTemplates returns templates", () => {
      registerTemplate({ name: "t1" });
      registerTemplate({ name: "t2" });
      const result = getTemplates();
      expect(result.count).toBe(2);
    });

    test("getTemplates filters by type", () => {
      registerTemplate({ name: "t1", type: "terraform" });
      registerTemplate({ name: "t2", type: "kubernetes" });
      const result = getTemplates({ type: "terraform" });
      expect(result.count).toBe(1);
    });

    test("getTemplates filters by provider", () => {
      registerTemplate({ name: "t1", provider: "aws" });
      registerTemplate({ name: "t2", provider: "gcp" });
      const result = getTemplates({ provider: "aws" });
      expect(result.count).toBe(1);
    });

    test("getTemplate returns specific template", () => {
      const created = registerTemplate({ name: "test" });
      const found = getTemplate(created.id);
      expect(found.name).toBe("test");
    });

    test("getTemplate returns null for unknown", () => {
      expect(getTemplate("unknown")).toBeNull();
    });

    test("updateTemplate updates a template", () => {
      const created = registerTemplate({ name: "old" });
      const updated = updateTemplate(created.id, { name: "new" });
      expect(updated.name).toBe("new");
    });

    test("updateTemplate returns null for unknown", () => {
      expect(updateTemplate("unknown", {})).toBeNull();
    });

    test("deleteTemplate deletes a template", () => {
      const created = registerTemplate({ name: "test" });
      expect(deleteTemplate(created.id)).toBe(true);
      expect(getTemplate(created.id)).toBeNull();
    });

    test("deleteTemplate returns false for unknown", () => {
      expect(deleteTemplate("unknown")).toBe(false);
    });

    test("validateTemplate validates a valid template", () => {
      const template = registerTemplate({
        name: "vpc",
        type: "terraform",
        provider: "aws",
        content: 'resource "aws_vpc" "main" {}',
      });
      const result = validateTemplate(template.id);
      expect(result.valid).toBe(true);
      expect(result.issues.length).toBe(0);
    });

    test("validateTemplate detects empty content", () => {
      const template = registerTemplate({ name: "empty", content: "" });
      const result = validateTemplate(template.id);
      expect(result.valid).toBe(false);
      expect(result.issues[0].severity).toBe("error");
    });

    test("validateTemplate detects missing provider for terraform", () => {
      const template = registerTemplate({
        name: "no-provider",
        type: "terraform",
        content: "resource {}",
      });
      const result = validateTemplate(template.id);
      expect(result.issues.some((i) => i.message.includes("provider"))).toBe(true);
    });

    test("validateTemplate detects TODO comments", () => {
      const template = registerTemplate({
        name: "wip",
        content: "resource {} // TODO: add more",
      });
      const result = validateTemplate(template.id);
      expect(result.issues.some((i) => i.message.includes("TODO"))).toBe(true);
    });

    test("validateTemplate returns error for unknown", () => {
      const result = validateTemplate("unknown");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("getValidationHistory returns history", () => {
      const template = registerTemplate({ name: "test", content: "resource {}" });
      validateTemplate(template.id);
      const history = getValidationHistory();
      expect(history.total).toBe(1);
    });

    test("getValidationHistory filters by templateId", () => {
      const t1 = registerTemplate({ name: "t1", content: "a" });
      const t2 = registerTemplate({ name: "t2", content: "b" });
      validateTemplate(t1.id);
      validateTemplate(t2.id);
      const history = getValidationHistory(t1.id);
      expect(history.total).toBe(1);
    });

    test("getIacStats returns stats", () => {
      registerTemplate({ name: "t1", type: "terraform", provider: "aws" });
      const stats = getIacStats();
      expect(stats.totalTemplates).toBe(1);
      expect(stats.typeCounts.terraform).toBe(1);
    });

    test("clearIacData clears all data", () => {
      registerTemplate({ name: "test" });
      clearIacData();
      expect(getTemplates().count).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/iac/templates requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/iac/templates", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/iac/templates registers for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/iac/templates", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "vpc", type: "terraform", content: 'resource "aws_vpc" "main" {}' },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("vpc");
    });

    test("GET /api/iac/templates returns templates for admin", async () => {
      registerTemplate({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/iac/templates", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/iac/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/iac/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("GET /api/iac/validations returns history for admin", async () => {
      const template = registerTemplate({ name: "test", content: "resource {}" });
      validateTemplate(template.id);
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/iac/validations", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("POST /api/iac/templates/:id/validate validates for admin", async () => {
      const template = registerTemplate({ name: "test", content: "resource {}" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/iac/templates/${template.id}/validate`, {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.valid).toBe(true);
    });

    test("DELETE /api/iac/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/iac/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/iac/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/iac/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("GET /api/iac/templates/:id returns template for admin", async () => {
      const created = registerTemplate({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/iac/templates/${created.id}`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("test");
    });

    test("GET /api/iac/templates/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/iac/templates/unknown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("PUT /api/iac/templates/:id updates for admin", async () => {
      const created = registerTemplate({ name: "old" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/iac/templates/${created.id}`, {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "new" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("new");
    });

    test("DELETE /api/iac/templates/:id deletes for admin", async () => {
      const created = registerTemplate({ name: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/iac/templates/${created.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });

    test("DELETE /api/iac/templates/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/iac/templates/unknown", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });
  });
});
