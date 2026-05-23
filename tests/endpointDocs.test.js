import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import docsRoutes from "../routes/endpointDocs.js";
import {
  getAllDocs,
  getEndpointDoc,
  setEndpointDoc,
  removeEndpointDoc,
  getDocsByTag,
  getDocsStats,
  generateOpenAPISpec,
} from "../utils/endpointDocs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOCS_FILE = path.join(__dirname, "..", "endpoint_docs.json");

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
  app.use(docsRoutes);
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

describe("Endpoint Documentation", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DOCS_FILE, "utf8"); } catch { dataBackup = null; }
    try { fs.unlinkSync(DOCS_FILE); } catch {}
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DOCS_FILE, dataBackup);
    else { try { fs.unlinkSync(DOCS_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("getAllDocs returns built-in docs", () => {
      const docs = getAllDocs();
      expect(Object.keys(docs).length).toBeGreaterThan(0);
      expect(docs).toHaveProperty("GET /health");
    });

    test("getEndpointDoc returns specific doc", () => {
      const doc = getEndpointDoc("GET /health");
      expect(doc).not.toBeNull();
      expect(doc).toHaveProperty("summary");
    });

    test("getEndpointDoc returns null for unknown", () => {
      expect(getEndpointDoc("GET /unknown")).toBeNull();
    });

    test("setEndpointDoc adds custom doc", () => {
      const doc = setEndpointDoc("GET /api/custom", {
        summary: "Custom endpoint",
        description: "A custom endpoint",
      });
      expect(doc.summary).toBe("Custom endpoint");
      expect(getEndpointDoc("GET /api/custom")).not.toBeNull();
    });

    test("removeEndpointDoc removes custom doc", () => {
      setEndpointDoc("GET /api/custom", { summary: "Test" });
      expect(removeEndpointDoc("GET /api/custom")).toBe(true);
      expect(getEndpointDoc("GET /api/custom")).toBeNull();
    });

    test("removeEndpointDoc returns false for unknown", () => {
      expect(removeEndpointDoc("GET /api/unknown")).toBe(false);
    });

    test("getDocsByTag groups by tags", () => {
      const grouped = getDocsByTag();
      expect(grouped).toHaveProperty("auth");
      expect(grouped).toHaveProperty("system");
    });

    test("getDocsStats returns stats", () => {
      const stats = getDocsStats();
      expect(stats.totalEndpoints).toBeGreaterThan(0);
      expect(stats.documented).toBeGreaterThan(0);
      expect(stats.tags.length).toBeGreaterThan(0);
    });

    test("generateOpenAPISpec returns spec", () => {
      const spec = generateOpenAPISpec();
      expect(spec.openapi).toBe("3.0.0");
      expect(spec).toHaveProperty("info");
      expect(spec).toHaveProperty("paths");
      expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    });

    test("generateOpenAPISpec includes custom options", () => {
      const spec = generateOpenAPISpec({ title: "Test API", version: "2.0.0" });
      expect(spec.info.title).toBe("Test API");
      expect(spec.info.version).toBe("2.0.0");
    });
  });

  describe("API Routes", () => {
    test("GET /api/docs requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/docs");
      expect(status).toBe(401);
    });

    test("GET /api/docs returns docs for auth user", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/docs", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.count).toBeGreaterThan(0);
    });

    test("GET /api/docs?format=openapi returns OpenAPI spec", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/docs?format=openapi", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.openapi).toBe("3.0.0");
    });

    test("GET /api/docs/by-tag returns grouped docs", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/docs/by-tag", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("auth");
    });

    test("GET /api/docs/stats returns stats", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/docs/stats", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalEndpoints");
    });

    test("POST /api/docs requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/docs", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
        body: { endpoint: "GET /test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/docs adds doc for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/docs", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { endpoint: "GET /api/test", summary: "Test endpoint" },
      });
      expect(status).toBe(201);
      expect(body.message).toContain("updated");
    });

    test("POST /api/docs validates input", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/docs", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("GET /api/docs/spec/openapi returns spec", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/docs/spec/openapi", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.openapi).toBe("3.0.0");
    });

    test("DELETE /api/docs/:endpoint requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/docs/GET-health", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });
  });
});
