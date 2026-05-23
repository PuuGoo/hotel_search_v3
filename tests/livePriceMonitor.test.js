import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import priceMonitorRoutes from "../routes/livePriceMonitor.js";
import {
  createMonitor,
  getMonitors,
  getMonitor,
  updateMonitor,
  deleteMonitor,
  recordPriceCheck,
  getPriceHistory,
  getAlerts,
  getMonitorStats,
  clearMonitorData,
} from "../utils/livePriceMonitor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "live_price_data.json");

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
  app.use(priceMonitorRoutes);
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

describe("Live Price Monitor", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearMonitorData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("createMonitor creates a monitor", () => {
      const monitor = createMonitor({
        userId: "user1",
        hotelName: "Grand Hotel",
        location: "Paris",
        targetPrice: 200,
      });
      expect(monitor).toHaveProperty("id");
      expect(monitor.hotelName).toBe("Grand Hotel");
      expect(monitor.targetPrice).toBe(200);
    });

    test("getMonitors returns user monitors", () => {
      createMonitor({ userId: "user1", hotelName: "Hotel A" });
      createMonitor({ userId: "user1", hotelName: "Hotel B" });
      createMonitor({ userId: "user2", hotelName: "Hotel C" });
      const monitors = getMonitors("user1");
      expect(monitors.length).toBe(2);
    });

    test("getMonitor returns specific monitor", () => {
      const created = createMonitor({ userId: "user1", hotelName: "Test Hotel" });
      const monitor = getMonitor(created.id);
      expect(monitor.hotelName).toBe("Test Hotel");
    });

    test("getMonitor returns null for unknown", () => {
      expect(getMonitor("unknown")).toBeNull();
    });

    test("updateMonitor updates a monitor", () => {
      const created = createMonitor({ userId: "user1", hotelName: "Old Name" });
      const updated = updateMonitor(created.id, { hotelName: "New Name" });
      expect(updated.hotelName).toBe("New Name");
    });

    test("updateMonitor returns null for unknown", () => {
      expect(updateMonitor("unknown", {})).toBeNull();
    });

    test("deleteMonitor deletes a monitor", () => {
      const created = createMonitor({ userId: "user1" });
      expect(deleteMonitor(created.id)).toBe(true);
      expect(getMonitor(created.id)).toBeNull();
    });

    test("deleteMonitor returns false for unknown", () => {
      expect(deleteMonitor("unknown")).toBe(false);
    });

    test("recordPriceCheck records price", () => {
      const monitor = createMonitor({ userId: "user1", hotelName: "Test" });
      const result = recordPriceCheck(monitor.id, 150, "test");
      expect(result.historyEntry.price).toBe(150);
      expect(result.alerts).toEqual([]);
    });

    test("recordPriceCheck triggers price decrease alert", () => {
      const monitor = createMonitor({
        userId: "user1",
        hotelName: "Test",
        thresholdPercent: 5,
        alertOnDecrease: true,
      });
      recordPriceCheck(monitor.id, 200, "test");
      const result = recordPriceCheck(monitor.id, 180, "test");
      expect(result.alerts.length).toBeGreaterThan(0);
      expect(result.alerts[0].type).toBe("price_decrease");
    });

    test("recordPriceCheck triggers price increase alert", () => {
      const monitor = createMonitor({
        userId: "user1",
        hotelName: "Test",
        thresholdPercent: 5,
        alertOnIncrease: true,
      });
      recordPriceCheck(monitor.id, 200, "test");
      const result = recordPriceCheck(monitor.id, 220, "test");
      expect(result.alerts.length).toBeGreaterThan(0);
      expect(result.alerts[0].type).toBe("price_increase");
    });

    test("recordPriceCheck triggers target reached alert", () => {
      const monitor = createMonitor({
        userId: "user1",
        hotelName: "Test",
        targetPrice: 150,
      });
      const result = recordPriceCheck(monitor.id, 140, "test");
      expect(result.alerts.length).toBeGreaterThan(0);
      expect(result.alerts[0].type).toBe("target_reached");
    });

    test("recordPriceCheck returns null for unknown monitor", () => {
      expect(recordPriceCheck("unknown", 100)).toBeNull();
    });

    test("getPriceHistory returns history", () => {
      const monitor = createMonitor({ userId: "user1" });
      recordPriceCheck(monitor.id, 100, "test");
      recordPriceCheck(monitor.id, 110, "test");
      const history = getPriceHistory(monitor.id);
      expect(history.total).toBe(2);
    });

    test("getAlerts returns user alerts", () => {
      const monitor = createMonitor({ userId: "user1", thresholdPercent: 5 });
      recordPriceCheck(monitor.id, 200, "test");
      recordPriceCheck(monitor.id, 180, "test");
      const alerts = getAlerts("user1");
      expect(alerts.total).toBeGreaterThan(0);
    });

    test("getMonitorStats returns stats", () => {
      createMonitor({ userId: "user1" });
      const stats = getMonitorStats("user1");
      expect(stats.totalMonitors).toBe(1);
      expect(stats).toHaveProperty("activeMonitors");
    });

    test("clearMonitorData clears all data", () => {
      createMonitor({ userId: "user1" });
      clearMonitorData();
      expect(getMonitors("user1").length).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/price-monitor/monitors requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/price-monitor/monitors", {
        method: "POST",
        body: { hotelName: "Test" },
      });
      expect(status).toBe(401);
    });

    test("POST /api/price-monitor/monitors creates monitor", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/price-monitor/monitors", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { hotelName: "Grand Hotel", targetPrice: 200 },
      });
      expect(status).toBe(201);
      expect(body.hotelName).toBe("Grand Hotel");
    });

    test("GET /api/price-monitor/monitors returns monitors", async () => {
      createMonitor({ userId: "user1", hotelName: "Test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/price-monitor/monitors", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });

    test("DELETE /api/price-monitor/monitors/:id deletes monitor", async () => {
      const created = createMonitor({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/price-monitor/monitors/${created.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });

    test("POST /api/price-monitor/monitors/:id/check records price", async () => {
      const created = createMonitor({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/price-monitor/monitors/${created.id}/check`, {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { price: 150, source: "test" },
      });
      expect(status).toBe(200);
      expect(body.historyEntry.price).toBe(150);
    });

    test("GET /api/price-monitor/alerts returns alerts", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/price-monitor/alerts", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("alerts");
    });

    test("GET /api/price-monitor/stats returns stats", async () => {
      createMonitor({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/price-monitor/stats", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalMonitors");
    });

    test("DELETE /api/price-monitor/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/price-monitor/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/price-monitor/clear clears for admin", async () => {
      createMonitor({ userId: "user1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/price-monitor/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
