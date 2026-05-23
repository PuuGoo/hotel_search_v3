import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import reportRoutes from "../routes/reports.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");
const ALERTS_FILE = path.join(__dirname, "..", "price_alerts.json");

let historyBackup, bookmarksBackup, alertsBackup;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    if (req.headers["x-test-user"]) {
      req.session.isAuthenticated = true;
      req.session.user = { id: req.headers["x-test-user"], username: "testuser", role: req.headers["x-test-role"] || "user" };
    }
    next();
  });
  app.use(reportRoutes);
  return app;
}

function makeRequest(app, path, options = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const req = http.request(
        { hostname: "localhost", port, path, method: options.method || "GET", headers: { ...options.headers } },
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

describe("Reports", () => {
  beforeEach(() => {
    // Backup data files
    try { historyBackup = fs.readFileSync(HISTORY_FILE, "utf8"); } catch { historyBackup = "[]"; }
    try { bookmarksBackup = fs.readFileSync(BOOKMARKS_FILE, "utf8"); } catch { bookmarksBackup = "[]"; }
    try { alertsBackup = fs.readFileSync(ALERTS_FILE, "utf8"); } catch { alertsBackup = "[]"; }
  });

  afterEach(() => {
    // Restore data files
    fs.writeFileSync(HISTORY_FILE, historyBackup);
    fs.writeFileSync(BOOKMARKS_FILE, bookmarksBackup);
    fs.writeFileSync(ALERTS_FILE, alertsBackup);
  });

  test("GET /api/reports/search-history requires auth", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/reports/search-history");
    expect(status).toBe(401);
  });

  test("GET /api/reports/search-history returns HTML", async () => {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([
      { userId: "user1", query: "hotel paris", engine: "tavily", timestamp: new Date().toISOString(), resultCount: 5 },
    ]));
    const app = createTestApp();
    const { status, body, headers } = await makeRequest(app, "/api/reports/search-history", {
      headers: { "x-test-user": "user1" },
    });
    expect(status).toBe(200);
    expect(headers["content-type"]).toContain("text/html");
    expect(body).toContain("Search History Report");
    expect(body).toContain("hotel paris");
  });

  test("GET /api/reports/search-history shows engine stats", async () => {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([
      { userId: "user1", query: "q1", engine: "tavily", timestamp: new Date().toISOString() },
      { userId: "user1", query: "q2", engine: "ddg", timestamp: new Date().toISOString() },
      { userId: "user1", query: "q3", engine: "tavily", timestamp: new Date().toISOString() },
    ]));
    const app = createTestApp();
    const { body } = await makeRequest(app, "/api/reports/search-history", {
      headers: { "x-test-user": "user1" },
    });
    expect(body).toContain("tavily");
    expect(body).toContain("ddg");
  });

  test("GET /api/reports/bookmarks requires auth", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/reports/bookmarks");
    expect(status).toBe(401);
  });

  test("GET /api/reports/bookmarks returns HTML", async () => {
    fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify([
      { userId: "user1", title: "Grand Hotel", url: "https://example.com", tags: ["luxury"], createdAt: new Date().toISOString() },
    ]));
    const app = createTestApp();
    const { status, body, headers } = await makeRequest(app, "/api/reports/bookmarks", {
      headers: { "x-test-user": "user1" },
    });
    expect(status).toBe(200);
    expect(headers["content-type"]).toContain("text/html");
    expect(body).toContain("Bookmarks Report");
    expect(body).toContain("Grand Hotel");
  });

  test("GET /api/reports/price-alerts requires auth", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/reports/price-alerts");
    expect(status).toBe(401);
  });

  test("GET /api/reports/price-alerts returns HTML", async () => {
    fs.writeFileSync(ALERTS_FILE, JSON.stringify([
      { userId: "user1", hotelName: "Hilton", targetPrice: 150, currentPrice: 180, active: true, createdAt: new Date().toISOString() },
    ]));
    const app = createTestApp();
    const { status, body, headers } = await makeRequest(app, "/api/reports/price-alerts", {
      headers: { "x-test-user": "user1" },
    });
    expect(status).toBe(200);
    expect(headers["content-type"]).toContain("text/html");
    expect(body).toContain("Price Alerts Report");
    expect(body).toContain("Hilton");
  });

  test("reports only show current user's data", async () => {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([
      { userId: "user1", query: "my search", engine: "tavily", timestamp: new Date().toISOString() },
      { userId: "user2", query: "other search", engine: "ddg", timestamp: new Date().toISOString() },
    ]));
    const app = createTestApp();
    const { body } = await makeRequest(app, "/api/reports/search-history", {
      headers: { "x-test-user": "user1" },
    });
    expect(body).toContain("my search");
    expect(body).not.toContain("other search");
  });

  test("reports handle empty data gracefully", async () => {
    fs.writeFileSync(HISTORY_FILE, "[]");
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/reports/search-history", {
      headers: { "x-test-user": "user1" },
    });
    expect(status).toBe(200);
    expect(body).toContain("Search History Report");
    expect(body).toContain("0");
  });

  test("reports include print script", async () => {
    const app = createTestApp();
    const { body } = await makeRequest(app, "/api/reports/search-history", {
      headers: { "x-test-user": "user1" },
    });
    expect(body).toContain("window.print()");
  });
});
