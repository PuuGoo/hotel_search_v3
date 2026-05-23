import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import searchABRoutes from "../routes/searchABTesting.js";
import {
  createExperiment,
  getExperiments,
  getExperiment,
  assignVariant,
  getSearchConfig,
  recordSearchResult,
  getExperimentAnalytics,
  toggleExperiment,
  deleteExperiment,
  clearResults,
} from "../utils/searchABTesting.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPERIMENTS_FILE = path.join(__dirname, "..", "search_ab_experiments.json");
const RESULTS_FILE = path.join(__dirname, "..", "search_ab_results.json");

let experimentsBackup;
let resultsBackup;

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
  app.use(searchABRoutes);
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

describe("Search A/B Testing", () => {
  beforeEach(() => {
    try { experimentsBackup = fs.readFileSync(EXPERIMENTS_FILE, "utf8"); } catch { experimentsBackup = null; }
    try { resultsBackup = fs.readFileSync(RESULTS_FILE, "utf8"); } catch { resultsBackup = null; }
    fs.writeFileSync(EXPERIMENTS_FILE, JSON.stringify({ experiments: [] }));
    fs.writeFileSync(RESULTS_FILE, JSON.stringify({ results: [] }));
  });

  afterEach(() => {
    if (experimentsBackup) saveWithRetry(EXPERIMENTS_FILE, experimentsBackup);
    else { try { fs.unlinkSync(EXPERIMENTS_FILE); } catch {} }
    if (resultsBackup) saveWithRetry(RESULTS_FILE, resultsBackup);
    else { try { fs.unlinkSync(RESULTS_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("createExperiment creates an experiment", () => {
      const exp = createExperiment({
        name: "engine-test",
        description: "Test different engines",
        variants: [
          { name: "control", config: { engine: "ddg" } },
          { name: "variant-a", config: { engine: "google" } },
        ],
      });
      expect(exp).toHaveProperty("id");
      expect(exp.name).toBe("engine-test");
      expect(exp.variants.length).toBe(2);
      expect(exp.active).toBe(true);
    });

    test("createExperiment rejects duplicate names", () => {
      createExperiment({
        name: "dupe-test",
        variants: [{ name: "a", config: {} }, { name: "b", config: {} }],
      });
      expect(() => createExperiment({
        name: "dupe-test",
        variants: [{ name: "a", config: {} }, { name: "b", config: {} }],
      })).toThrow("already exists");
    });

    test("createExperiment rejects fewer than 2 variants", () => {
      expect(() => createExperiment({
        name: "bad",
        variants: [{ name: "only", config: {} }],
      })).toThrow("at least 2");
    });

    test("getExperiments returns all experiments", () => {
      createExperiment({ name: "exp1", variants: [{ name: "a", config: {} }, { name: "b", config: {} }] });
      createExperiment({ name: "exp2", variants: [{ name: "a", config: {} }, { name: "b", config: {} }] });
      const exps = getExperiments();
      expect(exps.length).toBe(2);
    });

    test("getExperiment returns specific experiment", () => {
      const exp = createExperiment({ name: "specific", variants: [{ name: "a", config: {} }, { name: "b", config: {} }] });
      const found = getExperiment(exp.id);
      expect(found.name).toBe("specific");
    });

    test("assignVariant assigns consistently", () => {
      const exp = createExperiment({ name: "assign-test", variants: [{ name: "a", config: {} }, { name: "b", config: {} }] });
      const a1 = assignVariant("user1", exp.id);
      const a2 = assignVariant("user1", exp.id);
      expect(a1.variantIndex).toBe(a2.variantIndex);
    });

    test("assignVariant returns null for inactive experiment", () => {
      const exp = createExperiment({ name: "inactive-test", variants: [{ name: "a", config: {} }, { name: "b", config: {} }] });
      toggleExperiment(exp.id);
      const result = assignVariant("user1", exp.id);
      expect(result).toBeNull();
    });

    test("getSearchConfig merges active experiment configs", () => {
      createExperiment({
        name: "config-test-1",
        variants: [{ name: "a", config: { engine: "ddg" } }, { name: "b", config: { engine: "google" } }],
      });
      createExperiment({
        name: "config-test-2",
        variants: [{ name: "a", config: { resultCount: 10 } }, { name: "b", config: { resultCount: 20 } }],
      });
      const { config, assignments } = getSearchConfig("user1");
      expect(config).toHaveProperty("engine");
      expect(config).toHaveProperty("resultCount");
      expect(assignments.length).toBe(2);
    });

    test("recordSearchResult records entry", () => {
      const result = recordSearchResult({
        userId: "user1",
        query: "hotel",
        engine: "ddg",
        resultCount: 10,
        duration: 200,
      });
      expect(result).toHaveProperty("id");
      expect(result.query).toBe("hotel");
    });

    test("getExperimentAnalytics returns analytics", () => {
      const exp = createExperiment({
        name: "analytics-test",
        variants: [{ name: "a", config: { engine: "ddg" } }, { name: "b", config: { engine: "google" } }],
      });
      recordSearchResult({ experimentId: exp.id, variantIndex: 0, query: "hotel", resultCount: 10, duration: 200 });
      recordSearchResult({ experimentId: exp.id, variantIndex: 1, query: "hotel", resultCount: 15, duration: 300, clicked: true });
      const analytics = getExperimentAnalytics(exp.id);
      expect(analytics.variants.length).toBe(2);
      expect(analytics.variants[0].searches).toBe(1);
      expect(analytics.variants[1].clicks).toBe(1);
    });

    test("toggleExperiment toggles state", () => {
      const exp = createExperiment({ name: "toggle-test", variants: [{ name: "a", config: {} }, { name: "b", config: {} }] });
      expect(exp.active).toBe(true);
      const toggled = toggleExperiment(exp.id);
      expect(toggled.active).toBe(false);
    });

    test("deleteExperiment removes experiment and results", () => {
      const exp = createExperiment({ name: "delete-test", variants: [{ name: "a", config: {} }, { name: "b", config: {} }] });
      recordSearchResult({ experimentId: exp.id, variantIndex: 0 });
      const deleted = deleteExperiment(exp.id);
      expect(deleted).toBe(true);
      expect(getExperiments().length).toBe(0);
    });

    test("clearResults clears all results", () => {
      recordSearchResult({ query: "hotel" });
      clearResults();
      const data = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
      expect(data.results.length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/search-ab/experiments requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/search-ab/experiments", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "test", variants: [{ name: "a", config: {} }, { name: "b", config: {} }] },
      });
      expect(status).toBe(403);
    });

    test("POST /api/search-ab/experiments creates experiment", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/search-ab/experiments", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "api-test", variants: [{ name: "a", config: {} }, { name: "b", config: {} }] },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("api-test");
    });

    test("GET /api/search-ab/experiments requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/search-ab/experiments", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/search-ab/experiments returns list", async () => {
      createExperiment({ name: "list-test", variants: [{ name: "a", config: {} }, { name: "b", config: {} }] });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/search-ab/experiments", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.experiments.length).toBeGreaterThan(0);
    });

    test("GET /api/search-ab/config returns config", async () => {
      createExperiment({
        name: "config-api-test",
        variants: [{ name: "a", config: { engine: "ddg" } }, { name: "b", config: { engine: "google" } }],
      });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/search-ab/config", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("config");
      expect(body).toHaveProperty("assignments");
    });

    test("POST /api/search-ab/result records result", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/search-ab/result", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { query: "hotel", engine: "ddg", resultCount: 10, duration: 200 },
      });
      expect(status).toBe(201);
      expect(body.query).toBe("hotel");
    });

    test("GET /api/search-ab/analytics/:id requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/search-ab/analytics/fakeid", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("PUT /api/search-ab/experiments/:id/toggle toggles experiment", async () => {
      const exp = createExperiment({ name: "toggle-api", variants: [{ name: "a", config: {} }, { name: "b", config: {} }] });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/search-ab/experiments/${exp.id}/toggle`, {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.active).toBe(false);
    });

    test("DELETE /api/search-ab/experiments/:id requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/search-ab/experiments/fakeid", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/search-ab/experiments/:id deletes experiment", async () => {
      const exp = createExperiment({ name: "delete-api", variants: [{ name: "a", config: {} }, { name: "b", config: {} }] });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/search-ab/experiments/${exp.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });
  });
});
