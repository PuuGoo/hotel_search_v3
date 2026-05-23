import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import engagementRoutes from "../routes/userEngagement.js";
import {
  recordEvent,
  getFeatureStats,
  getEngagementOverview,
  getUserEngagement,
  getAdoptionMetrics,
  clearEngagementData,
} from "../utils/userEngagement.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "engagement_data.json");

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
  app.use(engagementRoutes);
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

describe("User Engagement", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearEngagementData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("recordEvent records an event", () => {
      const record = recordEvent({
        userId: "user1",
        feature: "search",
        action: "query",
      });
      expect(record).toHaveProperty("userId", "user1");
      expect(record).toHaveProperty("feature", "search");
      expect(record).toHaveProperty("action", "query");
      expect(record).toHaveProperty("timestamp");
    });

    test("getFeatureStats returns feature usage", () => {
      recordEvent({ userId: "user1", feature: "search", action: "query" });
      recordEvent({ userId: "user1", feature: "search", action: "query" });
      recordEvent({ userId: "user2", feature: "bookmarks", action: "add" });

      const stats = getFeatureStats({ hours: 1 });
      expect(stats.totalEvents).toBe(3);
      expect(stats.features.length).toBe(2);
      expect(stats.features[0].feature).toBe("search");
      expect(stats.features[0].totalEvents).toBe(2);
    });

    test("getFeatureStats handles empty data", () => {
      const stats = getFeatureStats({ hours: 1 });
      expect(stats.totalEvents).toBe(0);
      expect(stats.features).toEqual([]);
    });

    test("getEngagementOverview returns overview", () => {
      recordEvent({ userId: "user1", feature: "search", action: "query" });
      recordEvent({ userId: "user2", feature: "search", action: "query" });
      recordEvent({ userId: "user1", feature: "bookmarks", action: "add" });

      const overview = getEngagementOverview({ hours: 1 });
      expect(overview.totalEvents).toBe(3);
      expect(overview.uniqueUsers).toBe(2);
      expect(overview.topFeatures.length).toBeGreaterThan(0);
    });

    test("getEngagementOverview handles empty data", () => {
      const overview = getEngagementOverview({ hours: 1 });
      expect(overview.totalEvents).toBe(0);
      expect(overview.uniqueUsers).toBe(0);
    });

    test("getUserEngagement returns user-specific data", () => {
      recordEvent({ userId: "user1", feature: "search", action: "query" });
      recordEvent({ userId: "user1", feature: "bookmarks", action: "add" });
      recordEvent({ userId: "user2", feature: "search", action: "query" });

      const engagement = getUserEngagement("user1", { hours: 1 });
      expect(engagement.userId).toBe("user1");
      expect(engagement.totalEvents).toBe(2);
      expect(engagement.features.length).toBe(2);
    });

    test("getUserEngagement returns empty for unknown user", () => {
      const engagement = getUserEngagement("nobody", { hours: 1 });
      expect(engagement.totalEvents).toBe(0);
    });

    test("getAdoptionMetrics calculates adoption rates", () => {
      recordEvent({ userId: "user1", feature: "search", action: "query" });
      recordEvent({ userId: "user2", feature: "search", action: "query" });
      recordEvent({ userId: "user1", feature: "bookmarks", action: "add" });
      // user2 never used bookmarks

      const adoption = getAdoptionMetrics({ hours: 1 });
      expect(adoption.totalUsers).toBe(2);
      const searchAdopt = adoption.features.find((f) => f.feature === "search");
      expect(searchAdopt.adoptionRate).toBe(100);
      const bookmarkAdopt = adoption.features.find((f) => f.feature === "bookmarks");
      expect(bookmarkAdopt.adoptionRate).toBe(50);
    });

    test("getAdoptionMetrics handles empty data", () => {
      const adoption = getAdoptionMetrics({ hours: 1 });
      expect(adoption.totalUsers).toBe(0);
      expect(adoption.features).toEqual([]);
    });

    test("clearEngagementData clears all data", () => {
      recordEvent({ userId: "user1", feature: "search", action: "query" });
      clearEngagementData();
      const stats = getFeatureStats({ hours: 1 });
      expect(stats.totalEvents).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/engagement/record requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/engagement/record", {
        method: "POST",
        body: { feature: "search", action: "query" },
      });
      expect(status).toBe(401);
    });

    test("POST /api/engagement/record records event", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/engagement/record", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { feature: "search", action: "query" },
      });
      expect(status).toBe(201);
      expect(body.feature).toBe("search");
      expect(body.userId).toBe("user1");
    });

    test("GET /api/engagement/features requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/engagement/features", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/engagement/features returns stats for admin", async () => {
      recordEvent({ userId: "user1", feature: "search", action: "query" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/engagement/features", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalEvents");
    });

    test("GET /api/engagement/overview requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/engagement/overview", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/engagement/overview returns overview for admin", async () => {
      recordEvent({ userId: "user1", feature: "search", action: "query" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/engagement/overview", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("uniqueUsers");
    });

    test("GET /api/engagement/user/:userId requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/engagement/user/user1", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/engagement/user/:userId returns data for admin", async () => {
      recordEvent({ userId: "user1", feature: "search", action: "query" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/engagement/user/user1", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.userId).toBe("user1");
    });

    test("GET /api/engagement/adoption requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/engagement/adoption", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/engagement/adoption returns metrics for admin", async () => {
      recordEvent({ userId: "user1", feature: "search", action: "query" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/engagement/adoption", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalUsers");
      expect(body).toHaveProperty("features");
    });

    test("DELETE /api/engagement/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/engagement/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/engagement/clear clears for admin", async () => {
      recordEvent({ userId: "user1", feature: "search", action: "query" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/engagement/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
