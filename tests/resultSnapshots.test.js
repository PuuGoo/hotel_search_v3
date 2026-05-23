import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import resultSnapshotRoutes from "../routes/resultSnapshots.js";
import {
  saveSnapshot,
  getSnapshots,
  getSnapshot,
  deleteSnapshot,
  compareSnapshots,
  getSnapshotStats,
} from "../utils/resultSnapshots.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SNAPSHOTS_FILE = path.join(__dirname, "..", "result_snapshots.json");

let snapshotsBackup;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    if (req.headers["x-test-user"]) {
      req.session.isAuthenticated = true;
      req.session.user = { id: req.headers["x-test-user"], role: "user" };
    }
    next();
  });
  app.use(resultSnapshotRoutes);
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

const sampleResults = [
  { title: "Hotel Paris", url: "https://example.com/paris", price: 150, rating: 4.5 },
  { title: "Hotel London", url: "https://example.com/london", price: 200, rating: 4.0 },
];

describe("Result Snapshots", () => {
  beforeEach(() => {
    try { snapshotsBackup = fs.readFileSync(SNAPSHOTS_FILE, "utf8"); } catch { snapshotsBackup = null; }
    try { fs.writeFileSync(SNAPSHOTS_FILE, "{}"); } catch {}
  });

  afterEach(() => {
    if (snapshotsBackup) fs.writeFileSync(SNAPSHOTS_FILE, snapshotsBackup);
    else { try { fs.unlinkSync(SNAPSHOTS_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("saveSnapshot saves a snapshot", () => {
      const snapshot = saveSnapshot("user1", { query: "hotel paris", results: sampleResults });
      expect(snapshot).toHaveProperty("id");
      expect(snapshot.query).toBe("hotel paris");
      expect(snapshot.resultCount).toBe(2);
      expect(snapshot.results.length).toBe(2);
    });

    test("saveSnapshot requires query and results", () => {
      expect(() => saveSnapshot("user1", {})).toThrow("required");
    });

    test("getSnapshots returns user snapshots", () => {
      saveSnapshot("user1", { query: "hotel paris", results: sampleResults });
      saveSnapshot("user1", { query: "hotel london", results: sampleResults });
      const snapshots = getSnapshots("user1");
      expect(snapshots.length).toBe(2);
    });

    test("getSnapshots filters by query", () => {
      saveSnapshot("user1", { query: "hotel paris", results: sampleResults });
      saveSnapshot("user1", { query: "hotel london", results: sampleResults });
      const snapshots = getSnapshots("user1", { query: "paris" });
      expect(snapshots.length).toBe(1);
      expect(snapshots[0].query).toBe("hotel paris");
    });

    test("getSnapshots filters by engine", () => {
      saveSnapshot("user1", { query: "hotel", results: sampleResults, engine: "ddg" });
      saveSnapshot("user1", { query: "hotel", results: sampleResults, engine: "google" });
      const snapshots = getSnapshots("user1", { engine: "ddg" });
      expect(snapshots.length).toBe(1);
    });

    test("getSnapshot returns specific snapshot", () => {
      const saved = saveSnapshot("user1", { query: "hotel", results: sampleResults });
      const snapshot = getSnapshot("user1", saved.id);
      expect(snapshot).not.toBeNull();
      expect(snapshot.id).toBe(saved.id);
    });

    test("getSnapshot returns null for nonexistent", () => {
      expect(getSnapshot("user1", "nonexistent")).toBeNull();
    });

    test("deleteSnapshot deletes a snapshot", () => {
      const saved = saveSnapshot("user1", { query: "hotel", results: sampleResults });
      const deleted = deleteSnapshot("user1", saved.id);
      expect(deleted).toBe(true);
      expect(getSnapshot("user1", saved.id)).toBeNull();
    });

    test("deleteSnapshot returns false for nonexistent", () => {
      expect(deleteSnapshot("user1", "nonexistent")).toBe(false);
    });

    test("compareSnapshots compares two snapshots", () => {
      const s1 = saveSnapshot("user1", {
        query: "hotel",
        results: [
          { title: "Hotel A", url: "https://a.com", position: 1 },
          { title: "Hotel B", url: "https://b.com", position: 2 },
        ],
      });
      const s2 = saveSnapshot("user1", {
        query: "hotel",
        results: [
          { title: "Hotel B", url: "https://b.com", position: 1 },
          { title: "Hotel C", url: "https://c.com", position: 2 },
        ],
      });

      const comparison = compareSnapshots("user1", s1.id, s2.id);
      expect(comparison).not.toBeNull();
      expect(comparison.comparison.added.length).toBe(1); // Hotel C
      expect(comparison.comparison.removed.length).toBe(1); // Hotel A
      expect(comparison.comparison.moved.length).toBe(1); // Hotel B moved
    });

    test("compareSnapshots returns null for nonexistent", () => {
      expect(compareSnapshots("user1", "s1", "s2")).toBeNull();
    });

    test("getSnapshotStats returns statistics", () => {
      saveSnapshot("user1", { query: "hotel paris", results: sampleResults, engine: "ddg" });
      saveSnapshot("user1", { query: "hotel london", results: sampleResults, engine: "google" });
      const stats = getSnapshotStats("user1");
      expect(stats.total).toBe(2);
      expect(stats.queries.length).toBe(2);
      expect(stats.engines.ddg).toBe(1);
    });

    test("getSnapshotStats handles empty", () => {
      const stats = getSnapshotStats("newuser");
      expect(stats.total).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("GET /api/snapshots requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/snapshots");
      expect(status).toBe(401);
    });

    test("GET /api/snapshots returns snapshots", async () => {
      saveSnapshot("user1", { query: "hotel", results: sampleResults });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/snapshots", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("snapshots");
      expect(body.snapshots.length).toBe(1);
    });

    test("POST /api/snapshots requires query and results", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/snapshots", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/snapshots saves snapshot", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/snapshots", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { query: "hotel paris", results: sampleResults },
      });
      expect(status).toBe(201);
      expect(body.query).toBe("hotel paris");
    });

    test("GET /api/snapshots/stats returns statistics", async () => {
      saveSnapshot("user1", { query: "hotel", results: sampleResults });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/snapshots/stats", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("total");
    });

    test("GET /api/snapshots/compare requires two snapshot IDs", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/snapshots/compare", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(400);
    });

    test("GET /api/snapshots/compare compares snapshots", async () => {
      const s1 = saveSnapshot("user1", { query: "hotel", results: [{ title: "A", url: "https://a.com" }] });
      const s2 = saveSnapshot("user1", { query: "hotel", results: [{ title: "B", url: "https://b.com" }] });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/snapshots/compare?snapshot1=${s1.id}&snapshot2=${s2.id}`, {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("comparison");
    });

    test("GET /api/snapshots/:id returns snapshot", async () => {
      const saved = saveSnapshot("user1", { query: "hotel", results: sampleResults });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/snapshots/${saved.id}`, {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.id).toBe(saved.id);
    });

    test("GET /api/snapshots/:id returns 404 for nonexistent", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/snapshots/nonexistent", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(404);
    });

    test("DELETE /api/snapshots/:id deletes snapshot", async () => {
      const saved = saveSnapshot("user1", { query: "hotel", results: sampleResults });
      const app = createTestApp();
      const { status } = await makeRequest(app, `/api/snapshots/${saved.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
    });

    test("DELETE /api/snapshots/:id returns 404 for nonexistent", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/snapshots/nonexistent", {
        method: "DELETE",
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(404);
    });
  });
});
