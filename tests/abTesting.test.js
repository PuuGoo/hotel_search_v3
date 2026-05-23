import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import abRoutes from "../routes/abTesting.js";
import {
  createExperiment,
  getExperiments,
  getExperiment,
  assignVariant,
  recordEvent,
  getExperimentResults,
  updateExperimentStatus,
  deleteExperiment,
} from "../utils/abTesting.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "ab_experiments.json");

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
  app.use(abRoutes);
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

describe("A/B Testing", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    fs.writeFileSync(DATA_FILE, JSON.stringify({ experiments: [] }));
  });

  afterEach(() => {
    if (dataBackup) fs.writeFileSync(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch { /* */ } }
  });

  describe("Utility functions", () => {
    test("createExperiment stores experiment", () => {
      const exp = createExperiment({
        name: "test-exp",
        description: "Test",
        variants: [{ name: "control", weight: 50 }, { name: "variant-a", weight: 50 }],
      });
      expect(exp.name).toBe("test-exp");
      expect(exp.status).toBe("active");
    });

    test("createExperiment validates variants", () => {
      expect(() => createExperiment({ name: "bad", variants: [{ name: "only" }] }))
        .toThrow("at least 2");
    });

    test("createExperiment validates weights sum to 100", () => {
      expect(() => createExperiment({
        name: "bad",
        variants: [{ name: "a", weight: 30 }, { name: "b", weight: 30 }],
      })).toThrow("sum to 100");
    });

    test("createExperiment prevents duplicate names", () => {
      createExperiment({
        name: "dupe",
        variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }],
      });
      expect(() => createExperiment({
        name: "dupe",
        variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }],
      })).toThrow("already exists");
    });

    test("assignVariant returns consistent result", () => {
      createExperiment({
        name: "consistent",
        variants: [{ name: "control", weight: 50 }, { name: "variant", weight: 50 }],
      });
      const v1 = assignVariant("consistent", "user1");
      const v2 = assignVariant("consistent", "user1");
      expect(v1).toBe(v2);
    });

    test("assignVariant returns valid variant name", () => {
      createExperiment({
        name: "valid",
        variants: [{ name: "control", weight: 50 }, { name: "variant", weight: 50 }],
      });
      const variant = assignVariant("valid", "user1");
      expect(["control", "variant"]).toContain(variant);
    });

    test("assignVariant throws for missing experiment", () => {
      expect(() => assignVariant("nonexistent", "user1")).toThrow("not found");
    });

    test("recordEvent stores events", () => {
      createExperiment({
        name: "events",
        variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }],
      });
      assignVariant("events", "user1");
      recordEvent("events", "user1", "click", 1);
      const results = getExperimentResults("events");
      expect(results).toBeDefined();
    });

    test("getExperimentResults returns variant stats", () => {
      createExperiment({
        name: "stats",
        variants: [{ name: "control", weight: 50 }, { name: "variant", weight: 50 }],
      });
      assignVariant("stats", "user1");
      recordEvent("stats", "user1", "click");
      const results = getExperimentResults("stats");
      expect(results.experiment).toBe("stats");
      expect(results.variants).toBeDefined();
    });

    test("updateExperimentStatus changes status", () => {
      createExperiment({
        name: "status",
        variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }],
      });
      updateExperimentStatus("status", "paused");
      const exp = getExperiment("status");
      expect(exp.status).toBe("paused");
    });

    test("deleteExperiment removes experiment", () => {
      createExperiment({
        name: "todelete",
        variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }],
      });
      deleteExperiment("todelete");
      expect(getExperiment("todelete")).toBeUndefined();
    });
  });

  describe("API routes", () => {
    test("POST /api/experiments requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/experiments", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "test", variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }] },
      });
      expect(status).toBe(403);
    });

    test("POST /api/experiments creates experiment", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/experiments", {
        method: "POST",
        headers: { "x-test-user": "admin1", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "api-test", variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }] },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("api-test");
    });

    test("GET /api/experiments lists experiments", async () => {
      createExperiment({ name: "list-test", variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }] });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/experiments", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.experiments.length).toBeGreaterThan(0);
    });

    test("GET /api/experiments/:name returns experiment", async () => {
      createExperiment({ name: "get-test", variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }] });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/experiments/get-test", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.name).toBe("get-test");
    });

    test("GET /api/experiments/:name/assign returns variant", async () => {
      createExperiment({ name: "assign-test", variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }] });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/experiments/assign-test/assign", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(["a", "b"]).toContain(body.variant);
    });

    test("POST /api/experiments/:name/event records event", async () => {
      createExperiment({ name: "event-test", variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }] });
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/experiments/event-test/event", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { eventName: "click" },
      });
      expect(status).toBe(200);
    });

    test("GET /api/experiments/:name/results requires admin", async () => {
      createExperiment({ name: "results-test", variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }] });
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/experiments/results-test/results", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("PATCH /api/experiments/:name/status updates status", async () => {
      createExperiment({ name: "patch-test", variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }] });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/experiments/patch-test/status", {
        method: "PATCH",
        headers: { "x-test-user": "admin1", "x-test-role": "admin", "content-type": "application/json" },
        body: { status: "paused" },
      });
      expect(status).toBe(200);
      expect(body.status).toBe("paused");
    });

    test("DELETE /api/experiments/:name requires admin", async () => {
      createExperiment({ name: "del-test", variants: [{ name: "a", weight: 50 }, { name: "b", weight: 50 }] });
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/experiments/del-test", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });
  });
});
