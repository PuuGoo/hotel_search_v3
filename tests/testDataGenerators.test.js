import { describe, test, expect } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import testDataRoutes from "../routes/testDataGenerators.js";
import {
  generateUser,
  generateUsers,
  generateSearchQuery,
  generateSearchQueries,
  generateHotelResult,
  generateHotelResults,
  generateBookmark,
  generateBookmarks,
  generatePriceAlert,
  generatePriceAlerts,
  generateWebhook,
  generateWebhooks,
  generateAuditEntry,
  generateAuditEntries,
  generateNotification,
  generateNotifications,
  getGenerators,
} from "../utils/testDataGenerators.js";

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
  app.use(testDataRoutes);
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

describe("Test Data Generators", () => {
  describe("Utility functions", () => {
    test("generateUser creates a user", () => {
      const user = generateUser();
      expect(user).toHaveProperty("id");
      expect(user).toHaveProperty("username");
      expect(user).toHaveProperty("email");
      expect(user).toHaveProperty("firstName");
      expect(user).toHaveProperty("lastName");
    });

    test("generateUser accepts overrides", () => {
      const user = generateUser({ role: "admin", username: "testadmin" });
      expect(user.role).toBe("admin");
      expect(user.username).toBe("testadmin");
    });

    test("generateUsers creates multiple users", () => {
      const users = generateUsers(5);
      expect(users.length).toBe(5);
    });

    test("generateSearchQuery creates a query", () => {
      const query = generateSearchQuery();
      expect(query).toHaveProperty("query");
      expect(query).toHaveProperty("engine");
      expect(query).toHaveProperty("city");
    });

    test("generateSearchQueries creates multiple queries", () => {
      const queries = generateSearchQueries(3);
      expect(queries.length).toBe(3);
    });

    test("generateHotelResult creates a hotel", () => {
      const hotel = generateHotelResult();
      expect(hotel).toHaveProperty("name");
      expect(hotel).toHaveProperty("city");
      expect(hotel).toHaveProperty("price");
      expect(hotel).toHaveProperty("rating");
    });

    test("generateHotelResults creates multiple hotels", () => {
      const hotels = generateHotelResults(5);
      expect(hotels.length).toBe(5);
    });

    test("generateBookmark creates a bookmark", () => {
      const bookmark = generateBookmark();
      expect(bookmark).toHaveProperty("hotelName");
      expect(bookmark).toHaveProperty("city");
    });

    test("generateBookmarks creates multiple bookmarks", () => {
      const bookmarks = generateBookmarks(3);
      expect(bookmarks.length).toBe(3);
    });

    test("generatePriceAlert creates an alert", () => {
      const alert = generatePriceAlert();
      expect(alert).toHaveProperty("hotelName");
      expect(alert).toHaveProperty("targetPrice");
      expect(alert).toHaveProperty("direction");
    });

    test("generatePriceAlerts creates multiple alerts", () => {
      const alerts = generatePriceAlerts(4);
      expect(alerts.length).toBe(4);
    });

    test("generateWebhook creates a webhook", () => {
      const webhook = generateWebhook();
      expect(webhook).toHaveProperty("url");
      expect(webhook).toHaveProperty("event");
    });

    test("generateWebhooks creates multiple webhooks", () => {
      const webhooks = generateWebhooks(3);
      expect(webhooks.length).toBe(3);
    });

    test("generateAuditEntry creates an audit entry", () => {
      const entry = generateAuditEntry();
      expect(entry).toHaveProperty("action");
      expect(entry).toHaveProperty("userId");
    });

    test("generateAuditEntries creates multiple entries", () => {
      const entries = generateAuditEntries(5);
      expect(entries.length).toBe(5);
    });

    test("generateNotification creates a notification", () => {
      const notif = generateNotification();
      expect(notif).toHaveProperty("type");
      expect(notif).toHaveProperty("title");
      expect(notif).toHaveProperty("message");
    });

    test("generateNotifications creates multiple notifications", () => {
      const notifs = generateNotifications(4);
      expect(notifs.length).toBe(4);
    });

    test("getGenerators returns all generators", () => {
      const generators = getGenerators();
      expect(Object.keys(generators).length).toBeGreaterThan(0);
      expect(generators).toHaveProperty("user");
      expect(generators).toHaveProperty("hotelResult");
    });
  });

  describe("API Routes", () => {
    test("GET /api/test-data/generators requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/test-data/generators", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/test-data/generators lists generators for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/test-data/generators", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBeGreaterThan(0);
    });

    test("POST /api/test-data/generate/user generates a user", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/test-data/generate/user", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
      expect(body.data).toHaveProperty("username");
    });

    test("POST /api/test-data/generate/users generates multiple users", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/test-data/generate/users", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { count: 5 },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(5);
    });

    test("POST /api/test-data/generate/hotelResults generates hotels", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/test-data/generate/hotelResults", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { count: 3 },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(3);
    });

    test("POST /api/test-data/generate/unknown returns error", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/test-data/generate/unknown", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/test-data/generate/user requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/test-data/generate/user", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(403);
    });
  });
});
