import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import comparisonExportRoutes from "../routes/comparisonExport.js";
import {
  exportComparisonCSV,
  exportBulkComparisonCSV,
  exportComparisonSummary,
  exportBookmarkComparisonCSV,
} from "../utils/comparisonExport.js";

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
  app.use(comparisonExportRoutes);
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
            resolve({ status: res.statusCode, body, headers: res.headers });
          });
        }
      );
      req.on("error", (err) => { server.close(); reject(err); });
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    });
  });
}

const sampleComparison = {
  query: "hotel paris",
  engines: ["ddg", "google"],
  results: {
    ddg: [
      { title: "Hotel Paris", url: "https://a.com", snippet: "Nice hotel", price: 150, rating: 4.5 },
      { title: "Paris Inn", url: "https://b.com", snippet: "Budget option", price: 80 },
    ],
    google: [
      { title: "Paris Grand", url: "https://c.com", snippet: "Luxury hotel", price: 300, rating: 4.8 },
    ],
  },
};

describe("Comparison Export", () => {
  describe("Utility functions", () => {
    test("exportComparisonCSV generates CSV", () => {
      const csv = exportComparisonCSV(sampleComparison);
      expect(csv).toContain("Engine");
      expect(csv).toContain("Hotel Paris");
      expect(csv).toContain("Paris Grand");
      expect(csv).toContain("ddg");
      expect(csv).toContain("google");
    });

    test("exportComparisonCSV includes metadata", () => {
      const csv = exportComparisonCSV(sampleComparison, { includeMetadata: true });
      expect(csv).toContain("# Query: hotel paris");
      expect(csv).toContain("# Engines:");
    });

    test("exportComparisonCSV excludes metadata", () => {
      const csv = exportComparisonCSV(sampleComparison, { includeMetadata: false });
      expect(csv).not.toContain("# Query:");
    });

    test("exportComparisonCSV handles empty input", () => {
      expect(exportComparisonCSV(null)).toBe("");
      expect(exportComparisonCSV({})).toBe("");
    });

    test("exportComparisonCSV escapes commas and quotes", () => {
      const comparison = {
        results: {
          ddg: [{ title: 'Hotel "Luxury", Paris', url: "https://a.com" }],
        },
      };
      const csv = exportComparisonCSV(comparison, { includeMetadata: false });
      expect(csv).toContain('"Hotel ""Luxury"", Paris"');
    });

    test("exportBulkComparisonCSV generates CSV for multiple", () => {
      const comparisons = [sampleComparison, sampleComparison];
      const csv = exportBulkComparisonCSV(comparisons);
      expect(csv).toContain("Comparison Date");
      expect(csv).toContain("hotel paris");
    });

    test("exportBulkComparisonCSV handles empty input", () => {
      expect(exportBulkComparisonCSV([])).toBe("");
      expect(exportBulkComparisonCSV(null)).toBe("");
    });

    test("exportComparisonSummary generates summary", () => {
      const csv = exportComparisonSummary(sampleComparison);
      expect(csv).toContain("Engine");
      expect(csv).toContain("Result Count");
      expect(csv).toContain("ddg");
      expect(csv).toContain("2");
    });

    test("exportComparisonSummary handles empty input", () => {
      expect(exportComparisonSummary(null)).toBe("");
    });

    test("exportBookmarkComparisonCSV generates CSV", () => {
      const bookmarks = [
        { title: "Hotel A", url: "https://a.com", tags: ["paris", "luxury"], folder: "Favorites" },
        { title: "Hotel B", url: "https://b.com", notes: "Good value" },
      ];
      const csv = exportBookmarkComparisonCSV(bookmarks);
      expect(csv).toContain("Title");
      expect(csv).toContain("Hotel A");
      expect(csv).toContain("paris; luxury");
    });

    test("exportBookmarkComparisonCSV handles empty input", () => {
      expect(exportBookmarkComparisonCSV([])).toBe("");
    });
  });

  describe("API Routes", () => {
    test("POST /api/export/comparison/csv requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/export/comparison/csv", {
        method: "POST",
        body: { comparison: sampleComparison },
      });
      expect(status).toBe(401);
    });

    test("POST /api/export/comparison/csv requires comparison", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/export/comparison/csv", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/export/comparison/csv returns CSV", async () => {
      const app = createTestApp();
      const { status, body, headers } = await makeRequest(app, "/api/export/comparison/csv", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { comparison: sampleComparison },
      });
      expect(status).toBe(200);
      expect(headers["content-type"]).toContain("text/csv");
      expect(body).toContain("Hotel Paris");
    });

    test("POST /api/export/comparisons/csv returns CSV", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/export/comparisons/csv", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { comparisons: [sampleComparison] },
      });
      expect(status).toBe(200);
      expect(body).toContain("Comparison Date");
    });

    test("POST /api/export/comparison/summary returns CSV", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/export/comparison/summary", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { comparison: sampleComparison },
      });
      expect(status).toBe(200);
      expect(body).toContain("Result Count");
    });

    test("POST /api/export/bookmarks/csv requires bookmarks", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/export/bookmarks/csv", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/export/bookmarks/csv returns CSV", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/export/bookmarks/csv", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { bookmarks: [{ title: "Hotel", url: "https://a.com" }] },
      });
      expect(status).toBe(200);
      expect(body).toContain("Hotel");
    });
  });
});
