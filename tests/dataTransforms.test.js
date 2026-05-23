import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import transformRoutes from "../routes/dataTransforms.js";
import {
  jsonToCSV,
  csvToJSON,
  mapFields,
  filterData,
  aggregateData,
  sortData,
  saveTemplate,
  getTemplates,
  deleteTemplate,
  getTransformStats,
  clearTransformData,
} from "../utils/dataTransforms.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "data_transforms.json");

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
  app.use(transformRoutes);
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

const sampleData = [
  { name: "Alice", age: 30, city: "NYC" },
  { name: "Bob", age: 25, city: "LA" },
  { name: "Charlie", age: 35, city: "NYC" },
];

describe("Data Transforms", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearTransformData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("jsonToCSV converts JSON array to CSV", () => {
      const result = jsonToCSV(sampleData);
      expect(result.result).toContain("name,age,city");
      expect(result.result).toContain("Alice,30,NYC");
      expect(result.rowCount).toBe(3);
    });

    test("jsonToCSV handles empty array", () => {
      const result = jsonToCSV([]);
      expect(result.error).toBeDefined();
    });

    test("jsonToCSV handles non-array", () => {
      const result = jsonToCSV("not an array");
      expect(result.error).toBeDefined();
    });

    test("csvToJSON converts CSV to JSON array", () => {
      const csv = "name,age,city\nAlice,30,NYC\nBob,25,LA";
      const result = csvToJSON(csv);
      expect(result.result.length).toBe(2);
      expect(result.result[0].name).toBe("Alice");
    });

    test("csvToJSON handles empty string", () => {
      const result = csvToJSON("");
      expect(result.error).toBeDefined();
    });

    test("csvToJSON handles CSV with quoted fields", () => {
      const csv = 'name,desc\nAlice,"Lives in NYC"\nBob,"Lives in LA"';
      const result = csvToJSON(csv);
      expect(result.result[0].desc).toBe("Lives in NYC");
    });

    test("mapFields maps fields correctly", () => {
      const result = mapFields(sampleData, { fullName: "name", years: "age" });
      expect(result.result[0].fullName).toBe("Alice");
      expect(result.result[0].years).toBe(30);
    });

    test("mapFields handles non-array", () => {
      const result = mapFields("not array", {});
      expect(result.error).toBeDefined();
    });

    test("filterData filters by equality", () => {
      const result = filterData(sampleData, { city: "NYC" });
      expect(result.rowCount).toBe(2);
    });

    test("filterData filters by gt", () => {
      const result = filterData(sampleData, { age: { gt: 28 } });
      expect(result.rowCount).toBe(2);
    });

    test("filterData filters by contains", () => {
      const result = filterData(sampleData, { name: { contains: "li" } });
      expect(result.rowCount).toBe(2); // Alice, Charlie
    });

    test("filterData filters by in", () => {
      const result = filterData(sampleData, { city: { in: ["NYC", "SF"] } });
      expect(result.rowCount).toBe(2);
    });

    test("aggregateData groups and aggregates", () => {
      const result = aggregateData(sampleData, {
        groupBy: "city",
        aggregations: { age: "avg" },
      });
      expect(result.groupCount).toBe(2);
      const nyc = result.result.find((r) => r.city === "NYC");
      expect(nyc.age_avg).toBe(32.5);
    });

    test("aggregateData handles missing fields", () => {
      const result = aggregateData("not array", { groupBy: "x", aggregations: {} });
      expect(result.error).toBeDefined();
    });

    test("sortData sorts ascending", () => {
      const result = sortData(sampleData, { field: "age", order: "asc" });
      expect(result.result[0].name).toBe("Bob");
    });

    test("sortData sorts descending", () => {
      const result = sortData(sampleData, { field: "age", order: "desc" });
      expect(result.result[0].name).toBe("Charlie");
    });

    test("saveTemplate saves a template", () => {
      const template = saveTemplate({ name: "Test Template", operations: ["filter", "sort"] });
      expect(template).toHaveProperty("id");
      expect(template.name).toBe("Test Template");
    });

    test("getTemplates returns templates", () => {
      saveTemplate({ name: "T1" });
      saveTemplate({ name: "T2" });
      expect(getTemplates().length).toBe(2);
    });

    test("deleteTemplate deletes a template", () => {
      const template = saveTemplate({ name: "Test" });
      expect(deleteTemplate(template.id)).toBe(true);
      expect(getTemplates().length).toBe(0);
    });

    test("deleteTemplate returns false for unknown", () => {
      expect(deleteTemplate("unknown")).toBe(false);
    });

    test("getTransformStats returns stats", () => {
      saveTemplate({ name: "Test" });
      const stats = getTransformStats();
      expect(stats.totalTemplates).toBe(1);
      expect(stats).toHaveProperty("totalTransforms");
    });

    test("clearTransformData clears all data", () => {
      saveTemplate({ name: "Test" });
      clearTransformData();
      expect(getTemplates().length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/transforms/json-to-csv requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/transforms/json-to-csv", {
        method: "POST",
        body: { data: sampleData },
      });
      expect(status).toBe(401);
    });

    test("POST /api/transforms/json-to-csv converts data", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/transforms/json-to-csv", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { data: sampleData },
      });
      expect(status).toBe(200);
      expect(body.rowCount).toBe(3);
    });

    test("POST /api/transforms/csv-to-json converts CSV", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/transforms/csv-to-json", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { csv: "name,age\nAlice,30\nBob,25" },
      });
      expect(status).toBe(200);
      expect(body.rowCount).toBe(2);
    });

    test("POST /api/transforms/filter filters data", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/transforms/filter", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { data: sampleData, conditions: { city: "NYC" } },
      });
      expect(status).toBe(200);
      expect(body.rowCount).toBe(2);
    });

    test("POST /api/transforms/sort sorts data", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/transforms/sort", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { data: sampleData, sortBy: { field: "age", order: "asc" } },
      });
      expect(status).toBe(200);
      expect(body.result[0].name).toBe("Bob");
    });

    test("POST /api/transforms/templates requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/transforms/templates", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { name: "Test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/transforms/templates creates template for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/transforms/templates", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "Test Template" },
      });
      expect(status).toBe(201);
      expect(body.name).toBe("Test Template");
    });

    test("GET /api/transforms/templates returns templates", async () => {
      saveTemplate({ name: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/transforms/templates", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/transforms/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/transforms/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalTemplates");
    });

    test("DELETE /api/transforms/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/transforms/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/transforms/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/transforms/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
