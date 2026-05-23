import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import usageRoutes from "../routes/apiUsageAnalytics.js";
import {
  recordUsage,
  getUsageRecords,
  getClients,
  getClient,
  getTopEndpoints,
  getTopClients,
  getUsageTimeline,
  getUsageStats,
  clearUsageData,
} from "../utils/apiUsageAnalytics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "api_usage_analytics.json");

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
  app.use(usageRoutes);
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

describe("API Usage Analytics", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearUsageData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("recordUsage records a usage event", () => {
      const record = recordUsage({
        clientId: "client1",
        method: "GET",
        path: "/api/search",
        statusCode: 200,
        responseTime: 45,
      });
      expect(record).toHaveProperty("id");
      expect(record.clientId).toBe("client1");
      expect(record.path).toBe("/api/search");
    });

    test("getUsageRecords returns records", () => {
      recordUsage({ path: "/api/a" });
      recordUsage({ path: "/api/b" });
      const result = getUsageRecords();
      expect(result.total).toBe(2);
    });

    test("getUsageRecords filters by clientId", () => {
      recordUsage({ clientId: "c1", path: "/api/a" });
      recordUsage({ clientId: "c2", path: "/api/b" });
      const result = getUsageRecords({ clientId: "c1" });
      expect(result.total).toBe(1);
    });

    test("getUsageRecords filters by method", () => {
      recordUsage({ method: "GET", path: "/api/a" });
      recordUsage({ method: "POST", path: "/api/b" });
      const result = getUsageRecords({ method: "GET" });
      expect(result.total).toBe(1);
    });

    test("getUsageRecords respects limit", () => {
      for (let i = 0; i < 10; i++) recordUsage({ path: `/api/${i}` });
      const result = getUsageRecords({ limit: 5 });
      expect(result.records.length).toBe(5);
    });

    test("getClients returns clients", () => {
      recordUsage({ clientId: "c1", path: "/api/a" });
      recordUsage({ clientId: "c2", path: "/api/b" });
      const clients = getClients();
      expect(clients.length).toBe(2);
    });

    test("getClient returns specific client", () => {
      recordUsage({ clientId: "c1", path: "/api/a" });
      const client = getClient("c1");
      expect(client.id).toBe("c1");
      expect(client.totalRequests).toBe(1);
    });

    test("getClient returns null for unknown", () => {
      expect(getClient("unknown")).toBeNull();
    });

    test("getTopEndpoints returns top endpoints", () => {
      recordUsage({ path: "/api/popular" });
      recordUsage({ path: "/api/popular" });
      recordUsage({ path: "/api/other" });
      const endpoints = getTopEndpoints();
      expect(endpoints[0].path).toBe("/api/popular");
      expect(endpoints[0].count).toBe(2);
    });

    test("getTopClients returns top clients", () => {
      recordUsage({ clientId: "active", path: "/api/a" });
      recordUsage({ clientId: "active", path: "/api/b" });
      recordUsage({ clientId: "quiet", path: "/api/c" });
      const clients = getTopClients();
      expect(clients[0].id).toBe("active");
      expect(clients[0].totalRequests).toBe(2);
    });

    test("getUsageTimeline returns 24 hourly buckets", () => {
      const timeline = getUsageTimeline();
      expect(timeline.length).toBe(24);
    });

    test("getUsageStats returns stats", () => {
      recordUsage({ path: "/api/a", statusCode: 200, responseTime: 50 });
      recordUsage({ path: "/api/b", statusCode: 500, responseTime: 100 });
      const stats = getUsageStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.totalErrors).toBe(1);
      expect(stats.errorRate).toBe(50);
      expect(stats.avgResponseTime).toBe(75);
    });

    test("clearUsageData clears all data", () => {
      recordUsage({ path: "/api/test" });
      clearUsageData();
      expect(getUsageRecords().total).toBe(0);
      expect(getClients().length).toBe(0);
    });

    test("recordUsage tracks error count per client", () => {
      recordUsage({ clientId: "c1", path: "/api/a", statusCode: 200 });
      recordUsage({ clientId: "c1", path: "/api/b", statusCode: 500 });
      const client = getClient("c1");
      expect(client.errorCount).toBe(1);
    });
  });

  describe("API Routes", () => {
    test("POST /api/usage/record requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/usage/record", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { path: "/api/test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/usage/record records for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/usage/record", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { clientId: "test-client", method: "GET", path: "/api/search" },
      });
      expect(status).toBe(201);
      expect(body.clientId).toBe("test-client");
    });

    test("GET /api/usage/records returns records for admin", async () => {
      recordUsage({ path: "/api/test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/usage/records", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("GET /api/usage/clients returns clients for admin", async () => {
      recordUsage({ clientId: "c1", path: "/api/test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/usage/clients", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("GET /api/usage/endpoints returns endpoints for admin", async () => {
      recordUsage({ path: "/api/test" });
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/usage/endpoints", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("GET /api/usage/top-clients returns top clients for admin", async () => {
      recordUsage({ clientId: "c1", path: "/api/test" });
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/usage/top-clients", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("GET /api/usage/timeline returns timeline for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/usage/timeline", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("GET /api/usage/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/usage/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("DELETE /api/usage/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/usage/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/usage/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/usage/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("GET /api/usage/clients/:id returns client for admin", async () => {
      recordUsage({ clientId: "c1", path: "/api/test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/usage/clients/c1", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.id).toBe("c1");
    });

    test("GET /api/usage/clients/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/usage/clients/unknown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });
  });
});
