import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import changelogViewerRoutes from "../routes/apiChangelogViewer.js";
import {
  addEntry,
  getEntries,
  getEntry,
  deleteEntry,
  createVersion,
  getVersions,
  getGroupedChangelog,
  getChangelogStats,
  clearChangelogData,
} from "../utils/apiChangelogViewer.js";

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
  app.use(changelogViewerRoutes);
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

describe("API Changelog Viewer", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearChangelogData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("addEntry creates an entry", () => {
      const entry = addEntry({
        version: "1.0.0",
        type: "added",
        title: "New search endpoint",
        description: "Added /api/search for hotel queries",
        endpoint: "/api/search",
        userId: "admin",
      });
      expect(entry).toHaveProperty("id");
      expect(entry.title).toBe("New search endpoint");
      expect(entry.type).toBe("added");
      expect(entry.version).toBe("1.0.0");
    });

    test("addEntry defaults to unreleased version", () => {
      const entry = addEntry({ title: "Test" });
      expect(entry.version).toBe("unreleased");
    });

    test("getEntries returns entries", () => {
      addEntry({ title: "E1", type: "added" });
      addEntry({ title: "E2", type: "fixed" });
      const result = getEntries();
      expect(result.entries.length).toBe(2);
      expect(result.total).toBe(2);
    });

    test("getEntries filters by version", () => {
      addEntry({ title: "V1", version: "1.0.0" });
      addEntry({ title: "V2", version: "2.0.0" });
      const result = getEntries({ version: "1.0.0" });
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].title).toBe("V1");
    });

    test("getEntries filters by type", () => {
      addEntry({ title: "Added", type: "added" });
      addEntry({ title: "Fixed", type: "fixed" });
      const result = getEntries({ type: "added" });
      expect(result.entries.length).toBe(1);
    });

    test("getEntries respects limit", () => {
      for (let i = 0; i < 10; i++) addEntry({ title: `E${i}` });
      const result = getEntries({ limit: 5 });
      expect(result.entries.length).toBe(5);
    });

    test("getEntry returns specific entry", () => {
      const created = addEntry({ title: "Specific" });
      const found = getEntry(created.id);
      expect(found.title).toBe("Specific");
    });

    test("getEntry returns null for unknown", () => {
      expect(getEntry("unknown")).toBeNull();
    });

    test("deleteEntry deletes an entry", () => {
      const created = addEntry({ title: "ToDelete" });
      expect(deleteEntry(created.id)).toBe(true);
      expect(getEntry(created.id)).toBeNull();
    });

    test("deleteEntry returns false for unknown", () => {
      expect(deleteEntry("unknown")).toBe(false);
    });

    test("createVersion creates a version", () => {
      const version = createVersion({
        version: "1.0.0",
        name: "Initial Release",
        description: "First stable version",
        userId: "admin",
      });
      expect(version).toHaveProperty("id");
      expect(version.version).toBe("1.0.0");
      expect(version.name).toBe("Initial Release");
    });

    test("getVersions returns versions", () => {
      createVersion({ version: "1.0.0" });
      createVersion({ version: "2.0.0" });
      expect(getVersions().length).toBe(2);
    });

    test("getGroupedChangelog groups entries by version", () => {
      createVersion({ version: "1.0.0", name: "v1" });
      addEntry({ version: "1.0.0", type: "added", title: "Feature A" });
      addEntry({ version: "1.0.0", type: "fixed", title: "Bug B" });
      const grouped = getGroupedChangelog();
      expect(grouped.length).toBe(1);
      expect(grouped[0].version).toBe("1.0.0");
      expect(grouped[0].changes.added.length).toBe(1);
      expect(grouped[0].changes.fixed.length).toBe(1);
    });

    test("getChangelogStats returns stats", () => {
      addEntry({ title: "A", type: "added" });
      addEntry({ title: "B", type: "added", breaking: true });
      createVersion({ version: "1.0.0" });
      const stats = getChangelogStats();
      expect(stats.totalEntries).toBe(2);
      expect(stats.totalVersions).toBe(1);
      expect(stats.breakingChanges).toBe(1);
      expect(stats.typeCounts.added).toBe(2);
    });

    test("clearChangelogData clears all data", () => {
      addEntry({ title: "Test" });
      createVersion({ version: "1.0.0" });
      clearChangelogData();
      expect(getEntries().total).toBe(0);
      expect(getVersions().length).toBe(0);
    });

    test("addEntry caps at MAX_ENTRIES", () => {
      for (let i = 0; i < 510; i++) addEntry({ title: `E${i}` });
      const result = getEntries({ limit: 1000 });
      expect(result.entries.length).toBe(500);
    });
  });

  describe("API Routes", () => {
    test("POST /api/changelog/entries requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/changelog/entries", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { title: "Test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/changelog/entries creates entry for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/changelog/entries", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { title: "New Feature", type: "added", version: "1.0.0" },
      });
      expect(status).toBe(201);
      expect(body.title).toBe("New Feature");
    });

    test("GET /api/changelog/entries returns entries for admin", async () => {
      addEntry({ title: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/changelog/entries", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("GET /api/changelog/grouped returns grouped for admin", async () => {
      createVersion({ version: "1.0.0" });
      addEntry({ version: "1.0.0", title: "Test", type: "added" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/changelog/grouped", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.versions.length).toBe(1);
    });

    test("GET /api/changelog/versions returns versions for admin", async () => {
      createVersion({ version: "1.0.0" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/changelog/versions", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("POST /api/changelog/versions creates version for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/changelog/versions", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { version: "2.0.0", name: "Major Release" },
      });
      expect(status).toBe(201);
      expect(body.version).toBe("2.0.0");
    });

    test("GET /api/changelog/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/changelog/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
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
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/changelog/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("GET /api/changelog/entries/:id returns entry for admin", async () => {
      const created = addEntry({ title: "Specific" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/changelog/entries/${created.id}`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.title).toBe("Specific");
    });

    test("GET /api/changelog/entries/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/changelog/entries/unknown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("DELETE /api/changelog/entries/:id deletes for admin", async () => {
      const created = addEntry({ title: "ToDelete" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/changelog/entries/${created.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });

    test("DELETE /api/changelog/entries/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/changelog/entries/unknown", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });
  });
});
