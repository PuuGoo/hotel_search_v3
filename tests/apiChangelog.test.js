import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import changelogRoutes from "../routes/apiChangelog.js";
import {
  addEntry,
  getEntries,
  getEntry,
  addDeprecation,
  getDeprecations,
  isDeprecated,
  getChangelogStats,
  clearChangelog,
} from "../utils/apiChangelog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "api_changelog.json");

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
  app.use(changelogRoutes);
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

describe("API Changelog", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearChangelog();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("addEntry creates a changelog entry", () => {
      const entry = addEntry({
        type: "addition",
        endpoint: "/api/new-feature",
        title: "New feature added",
        description: "Added a new feature",
        version: "1.0.0",
      });
      expect(entry).toHaveProperty("id");
      expect(entry.type).toBe("addition");
      expect(entry.title).toBe("New feature added");
      expect(entry.version).toBe("1.0.0");
    });

    test("getEntries returns all entries", () => {
      addEntry({ title: "Entry 1" });
      addEntry({ title: "Entry 2" });
      const result = getEntries();
      expect(result.entries.length).toBe(2);
      expect(result.total).toBe(2);
    });

    test("getEntries filters by type", () => {
      addEntry({ type: "addition", title: "Added" });
      addEntry({ type: "fix", title: "Fixed" });
      const result = getEntries({ type: "addition" });
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].type).toBe("addition");
    });

    test("getEntries filters by version", () => {
      addEntry({ title: "V1", version: "1.0.0" });
      addEntry({ title: "V2", version: "2.0.0" });
      const result = getEntries({ version: "1.0.0" });
      expect(result.entries.length).toBe(1);
    });

    test("getEntry returns specific entry", () => {
      const created = addEntry({ title: "Test" });
      const found = getEntry(created.id);
      expect(found.title).toBe("Test");
    });

    test("getEntry returns null for unknown", () => {
      expect(getEntry("nonexistent")).toBeNull();
    });

    test("addDeprecation creates deprecation", () => {
      const dep = addDeprecation({
        endpoint: "/api/old",
        reason: "Replaced by /api/new",
        removedIn: "2.0.0",
      });
      expect(dep.endpoint).toBe("/api/old");
      expect(dep.removedIn).toBe("2.0.0");
    });

    test("getDeprecations returns deprecations", () => {
      addDeprecation({ endpoint: "/api/old" });
      const result = getDeprecations();
      expect(result.deprecations.length).toBe(1);
    });

    test("isDeprecated checks endpoint", () => {
      addDeprecation({ endpoint: "/api/old" });
      expect(isDeprecated("/api/old")).toBe(true);
      expect(isDeprecated("/api/new")).toBe(false);
    });

    test("getChangelogStats returns stats", () => {
      addEntry({ type: "addition", version: "1.0.0" });
      addEntry({ type: "fix", breaking: true });
      const stats = getChangelogStats();
      expect(stats.totalEntries).toBe(2);
      expect(stats.breakingChanges).toBe(1);
      expect(stats.byType).toHaveProperty("addition");
    });

    test("clearChangelog clears all data", () => {
      addEntry({ title: "Test" });
      clearChangelog();
      const result = getEntries();
      expect(result.entries.length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("GET /api/changelog requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/changelog");
      expect(status).toBe(401);
    });

    test("GET /api/changelog returns entries for auth user", async () => {
      addEntry({ title: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/changelog", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.entries.length).toBe(1);
    });

    test("POST /api/changelog requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/changelog", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
        body: { title: "Test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/changelog adds entry for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/changelog", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { type: "addition", title: "New endpoint", version: "1.0.0" },
      });
      expect(status).toBe(201);
      expect(body.title).toBe("New endpoint");
    });

    test("GET /api/changelog/deprecations/list returns deprecations", async () => {
      addDeprecation({ endpoint: "/api/old" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/changelog/deprecations/list", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.deprecations.length).toBe(1);
    });

    test("POST /api/changelog/deprecate requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/changelog/deprecate", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
        body: { endpoint: "/api/old" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/changelog/deprecate adds deprecation for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/changelog/deprecate", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { endpoint: "/api/old", reason: "Replaced" },
      });
      expect(status).toBe(201);
      expect(body.endpoint).toBe("/api/old");
    });

    test("GET /api/changelog/check/:endpoint checks deprecation", async () => {
      addDeprecation({ endpoint: "/api/old" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/changelog/check/${encodeURIComponent("/api/old")}`, {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.deprecated).toBe(true);
    });

    test("GET /api/changelog/stats/overview requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/changelog/stats/overview", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/changelog/stats/overview returns stats for admin", async () => {
      addEntry({ title: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/changelog/stats/overview", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalEntries");
    });

    test("DELETE /api/changelog/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/changelog/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/changelog/clear clears for admin", async () => {
      addEntry({ title: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/changelog/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
