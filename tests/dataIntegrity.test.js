import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import integrityRoutes from "../routes/dataIntegrity.js";
import {
  validateFile,
  validateAllFiles,
  checkOrphanedReferences,
  checkDataConsistency,
  getIntegrityReport,
} from "../utils/dataIntegrity.js";

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
  app.use(integrityRoutes);
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

describe("Data Integrity", () => {
  describe("Utility functions", () => {
    test("validateFile checks existing file", () => {
      const result = validateFile("package.json");
      expect(result.exists).toBe(true);
      expect(result.valid).toBe(true);
      expect(result).toHaveProperty("size");
    });

    test("validateFile reports missing file", () => {
      const result = validateFile("nonexistent_file.json");
      expect(result.exists).toBe(false);
      expect(result.valid).toBe(false);
    });

    test("validateAllFiles validates all data files", () => {
      const result = validateAllFiles();
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("valid");
      expect(result).toHaveProperty("invalid");
      expect(result).toHaveProperty("missing");
      expect(result).toHaveProperty("results");
      expect(result.total).toBeGreaterThan(0);
    });

    test("checkOrphanedReferences returns result", () => {
      const result = checkOrphanedReferences();
      expect(result).toHaveProperty("issues");
      expect(result).toHaveProperty("count");
    });

    test("checkDataConsistency returns result", () => {
      const result = checkDataConsistency();
      expect(result).toHaveProperty("issues");
      expect(result).toHaveProperty("count");
    });

    test("getIntegrityReport returns full report", () => {
      const report = getIntegrityReport();
      expect(report).toHaveProperty("status");
      expect(report).toHaveProperty("totalIssues");
      expect(report).toHaveProperty("files");
      expect(report).toHaveProperty("orphanedReferences");
      expect(report).toHaveProperty("consistencyIssues");
      expect(report).toHaveProperty("details");
      expect(report).toHaveProperty("checkedAt");
      expect(["healthy", "warning", "critical"]).toContain(report.status);
    });
  });

  describe("API Routes", () => {
    test("GET /api/integrity/report requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/integrity/report", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/integrity/report returns report for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/integrity/report", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("files");
    });

    test("GET /api/integrity/files requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/integrity/files", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/integrity/files returns file validation", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/integrity/files", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("results");
    });

    test("GET /api/integrity/file/:filename validates specific file", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/integrity/file/package.json", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.exists).toBe(true);
      expect(body.valid).toBe(true);
    });

    test("GET /api/integrity/orphans requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/integrity/orphans", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/integrity/orphans returns orphans for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/integrity/orphans", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("issues");
    });

    test("GET /api/integrity/consistency requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/integrity/consistency", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/integrity/consistency returns consistency for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/integrity/consistency", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("issues");
    });
  });
});
