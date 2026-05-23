import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import clusteringRoutes from "../routes/resultClustering.js";
import {
  clusterResults,
  clusterByLocation,
  clusterByPrice,
  getClusteringStats,
} from "../utils/resultClustering.js";

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
  app.use(clusteringRoutes);
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
  { title: "Hotel Paris Center", snippet: "Luxury hotel in central Paris near Eiffel Tower", url: "https://a.com", location: "Paris", price: 200 },
  { title: "Paris Boutique Hotel", snippet: "Charming boutique hotel in Paris city center", url: "https://b.com", location: "Paris", price: 150 },
  { title: "London Grand Hotel", snippet: "Historic hotel in London near Big Ben", url: "https://c.com", location: "London", price: 250 },
  { title: "London Budget Inn", snippet: "Affordable hotel in London downtown", url: "https://d.com", location: "London", price: 45 },
  { title: "Tokyo Sakura Hotel", snippet: "Modern hotel in Tokyo Shibuya district", url: "https://e.com", location: "Tokyo", price: 120 },
];

describe("Result Clustering", () => {
  describe("Utility functions", () => {
    test("clusterResults returns clusters", () => {
      const clusters = clusterResults(sampleResults, { threshold: 0.01 });
      expect(clusters.length).toBeGreaterThan(0);
      expect(clusters[0]).toHaveProperty("id");
      expect(clusters[0]).toHaveProperty("label");
      expect(clusters[0]).toHaveProperty("count");
      expect(clusters[0]).toHaveProperty("results");
    });

    test("clusterResults handles empty input", () => {
      expect(clusterResults([])).toEqual([]);
    });

    test("clusterResults groups similar results", () => {
      const results = [
        { title: "Hotel Paris", snippet: "Paris hotel near Eiffel Tower" },
        { title: "Paris Inn", snippet: "Paris hotel central location" },
        { title: "London Hotel", snippet: "London hotel near Big Ben" },
      ];
      const clusters = clusterResults(results, { threshold: 0.05 });
      // Paris results should cluster together
      expect(clusters.length).toBeLessThan(results.length);
    });

    test("clusterResults respects maxClusters", () => {
      const clusters = clusterResults(sampleResults, { threshold: 0, maxClusters: 3 });
      expect(clusters.length).toBeLessThanOrEqual(3);
    });

    test("clusterByLocation groups by location", () => {
      const clusters = clusterByLocation(sampleResults);
      expect(clusters.length).toBe(3); // Paris, London, Tokyo
      const parisCluster = clusters.find((c) => c.label === "Paris");
      expect(parisCluster.count).toBe(2);
    });

    test("clusterByLocation handles missing location", () => {
      const results = [
        { title: "Hotel A", url: "https://a.com" },
        { title: "Hotel B", url: "https://b.com" },
      ];
      const clusters = clusterByLocation(results);
      expect(clusters.length).toBe(1);
      expect(clusters[0].label).toBe("Unknown");
    });

    test("clusterByPrice groups by price range", () => {
      const clusters = clusterByPrice(sampleResults);
      expect(clusters.length).toBeGreaterThan(0);
      const budget = clusters.find((c) => c.label === "Budget");
      const premium = clusters.find((c) => c.label === "Premium");
      expect(budget).toBeDefined();
      expect(premium).toBeDefined();
    });

    test("clusterByPrice handles custom ranges", () => {
      const clusters = clusterByPrice(sampleResults, [
        { label: "Cheap", min: 0, max: 100 },
        { label: "Expensive", min: 100, max: Infinity },
      ]);
      expect(clusters.length).toBe(2);
    });

    test("getClusteringStats returns stats", () => {
      const stats = getClusteringStats(sampleResults);
      expect(stats.totalResults).toBe(5);
      expect(stats).toHaveProperty("textClusters");
      expect(stats).toHaveProperty("locationClusters");
      expect(stats).toHaveProperty("priceClusters");
    });
  });

  describe("API Routes", () => {
    test("POST /api/clustering/text requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/clustering/text", {
        method: "POST",
        body: { results: [] },
      });
      expect(status).toBe(401);
    });

    test("POST /api/clustering/text requires results array", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/clustering/text", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/clustering/text returns clusters", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/clustering/text", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { results: sampleResults, threshold: 0.01 },
      });
      expect(status).toBe(200);
      expect(body.clusters.length).toBeGreaterThan(0);
    });

    test("POST /api/clustering/location returns location clusters", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/clustering/location", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { results: sampleResults },
      });
      expect(status).toBe(200);
      expect(body.clusters.length).toBe(3);
    });

    test("POST /api/clustering/price returns price clusters", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/clustering/price", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { results: sampleResults },
      });
      expect(status).toBe(200);
      expect(body.clusters.length).toBeGreaterThan(0);
    });

    test("POST /api/clustering/stats returns stats", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/clustering/stats", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { results: sampleResults },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalResults");
      expect(body).toHaveProperty("textClusters");
    });
  });
});
