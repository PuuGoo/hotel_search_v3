import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import behaviorRoutes from "../routes/behaviorAnalytics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "behavior_analytics.json");

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
  app.use(behaviorRoutes);
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

describe("Behavior Analytics", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    fs.writeFileSync(DATA_FILE, JSON.stringify({ events: [], aggregates: {} }));
  });

  afterEach(() => {
    if (dataBackup) fs.writeFileSync(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch { /* */ } }
  });

  test("POST /api/behavior/track requires auth", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/behavior/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { eventType: "click" },
    });
    expect(status).toBe(401);
  });

  test("POST /api/behavior/track requires eventType", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/behavior/track", {
      method: "POST",
      headers: { "x-test-user": "user1", "content-type": "application/json" },
      body: {},
    });
    expect(status).toBe(400);
    expect(body.error).toContain("eventType");
  });

  test("POST /api/behavior/track validates eventType", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/behavior/track", {
      method: "POST",
      headers: { "x-test-user": "user1", "content-type": "application/json" },
      body: { eventType: "invalid" },
    });
    expect(status).toBe(400);
    expect(body.error).toContain("eventType must be");
  });

  test("POST /api/behavior/track succeeds with valid event", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/behavior/track", {
      method: "POST",
      headers: { "x-test-user": "user1", "content-type": "application/json" },
      body: { eventType: "click", query: "hotel paris", engine: "tavily", resultPosition: 1 },
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.eventId).toBeDefined();
  });

  test("POST /api/behavior/track stores event data", async () => {
    const app = createTestApp();
    await makeRequest(app, "/api/behavior/track", {
      method: "POST",
      headers: { "x-test-user": "user1", "content-type": "application/json" },
      body: { eventType: "click", query: "hotel", engine: "tavily", resultUrl: "https://example.com", resultPosition: 2 },
    });
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    expect(data.events.length).toBe(1);
    expect(data.events[0].eventType).toBe("click");
    expect(data.events[0].query).toBe("hotel");
    expect(data.events[0].resultPosition).toBe(2);
  });

  test("GET /api/behavior/stats requires auth", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/behavior/stats");
    expect(status).toBe(401);
  });

  test("GET /api/behavior/stats returns user stats", async () => {
    // Seed data
    const events = [
      { userId: "user1", eventType: "search", query: "hotel", timestamp: new Date().toISOString() },
      { userId: "user1", eventType: "impression", query: "hotel", engine: "tavily", timestamp: new Date().toISOString() },
      { userId: "user1", eventType: "click", query: "hotel", engine: "tavily", resultPosition: 1, timestamp: new Date().toISOString() },
      { userId: "user2", eventType: "click", query: "other", engine: "ddg", timestamp: new Date().toISOString() },
    ];
    fs.writeFileSync(DATA_FILE, JSON.stringify({ events }));

    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/behavior/stats?days=7", {
      headers: { "x-test-user": "user1" },
    });
    expect(status).toBe(200);
    expect(body.totalSearches).toBe(1);
    expect(body.totalClicks).toBe(1);
    expect(body.totalImpressions).toBe(1);
    expect(body.clicksByEngine.tavily).toBe(1);
  });

  test("GET /api/behavior/stats calculates CTR", async () => {
    const events = [
      { userId: "user1", eventType: "impression", timestamp: new Date().toISOString() },
      { userId: "user1", eventType: "impression", timestamp: new Date().toISOString() },
      { userId: "user1", eventType: "click", timestamp: new Date().toISOString() },
    ];
    fs.writeFileSync(DATA_FILE, JSON.stringify({ events }));

    const app = createTestApp();
    const { body } = await makeRequest(app, "/api/behavior/stats", {
      headers: { "x-test-user": "user1" },
    });
    expect(body.ctr).toBe(50);
  });

  test("GET /api/behavior/stats returns top queries", async () => {
    const events = [
      { userId: "user1", eventType: "search", query: "hotel paris", timestamp: new Date().toISOString() },
      { userId: "user1", eventType: "search", query: "hotel paris", timestamp: new Date().toISOString() },
      { userId: "user1", eventType: "search", query: "resort bali", timestamp: new Date().toISOString() },
    ];
    fs.writeFileSync(DATA_FILE, JSON.stringify({ events }));

    const app = createTestApp();
    const { body } = await makeRequest(app, "/api/behavior/stats", {
      headers: { "x-test-user": "user1" },
    });
    expect(body.topQueries[0].query).toBe("hotel paris");
    expect(body.topQueries[0].count).toBe(2);
  });

  test("GET /api/behavior/global requires admin", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/behavior/global", {
      headers: { "x-test-user": "user1", "x-test-role": "user" },
    });
    expect(status).toBe(403);
  });

  test("GET /api/behavior/global returns system stats for admin", async () => {
    const events = [
      { userId: "user1", eventType: "search", timestamp: new Date().toISOString() },
      { userId: "user2", eventType: "click", resultPosition: 3, timestamp: new Date().toISOString() },
    ];
    fs.writeFileSync(DATA_FILE, JSON.stringify({ events }));

    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/behavior/global", {
      headers: { "x-test-user": "admin1", "x-test-role": "admin" },
    });
    expect(status).toBe(200);
    expect(body.uniqueUsers).toBe(2);
    expect(body.totalEvents).toBe(2);
    expect(body.avgClickPosition).toBe(3);
  });

  test("DELETE /api/behavior/clear removes user data", async () => {
    const events = [
      { userId: "user1", eventType: "click", timestamp: new Date().toISOString() },
      { userId: "user2", eventType: "click", timestamp: new Date().toISOString() },
    ];
    fs.writeFileSync(DATA_FILE, JSON.stringify({ events }));

    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/behavior/clear", {
      method: "DELETE",
      headers: { "x-test-user": "user1" },
    });
    expect(status).toBe(200);
    expect(body.deleted).toBe(1);

    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    expect(data.events.length).toBe(1);
    expect(data.events[0].userId).toBe("user2");
  });

  test("track caps events at 10000", async () => {
    const events = Array(10000).fill(null).map(() => ({
      userId: "user1", eventType: "click", timestamp: new Date().toISOString(),
    }));
    fs.writeFileSync(DATA_FILE, JSON.stringify({ events }));

    const app = createTestApp();
    await makeRequest(app, "/api/behavior/track", {
      method: "POST",
      headers: { "x-test-user": "user1", "content-type": "application/json" },
      body: { eventType: "click" },
    });

    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    expect(data.events.length).toBeLessThanOrEqual(10000);
  });
});
