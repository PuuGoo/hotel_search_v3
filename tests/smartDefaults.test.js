import { describe, test, expect, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import smartDefaultsRoutes from "../routes/smartDefaults.js";
import { classifyQuery, getRecommendedEngine, getSmartDefaults } from "../utils/smartDefaults.js";

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
  app.use(smartDefaultsRoutes);
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

describe("Smart Defaults", () => {
  describe("classifyQuery", () => {
    test("classifies hotel queries", () => {
      expect(classifyQuery("hotel in paris")).toBe("hotel");
      expect(classifyQuery("resort near beach")).toBe("hotel");
      expect(classifyQuery("airbnb apartment")).toBe("hotel");
    });

    test("classifies brand queries", () => {
      expect(classifyQuery("hilton")).toBe("brand");
      expect(classifyQuery("marriott booking")).toBe("brand");
    });

    test("classifies location queries", () => {
      expect(classifyQuery("hotels in downtown")).toBe("hotel");
      expect(classifyQuery("stay near airport")).toBe("location");
    });

    test("classifies price queries", () => {
      expect(classifyQuery("cheap hotel")).toBe("hotel");
      expect(classifyQuery("luxury resort")).toBe("hotel");
    });

    test("classifies comparison queries", () => {
      expect(classifyQuery("hilton vs marriott")).toBe("brand");
    });

    test("classifies general queries", () => {
      expect(classifyQuery("weather today")).toBe("general");
      expect(classifyQuery("")).toBe("general");
      expect(classifyQuery(null)).toBe("general");
    });
  });

  describe("getRecommendedEngine", () => {
    test("returns recommendation object", () => {
      const rec = getRecommendedEngine("hotel in paris", "user1");
      expect(rec).toHaveProperty("recommended");
      expect(rec).toHaveProperty("score");
      expect(rec).toHaveProperty("queryType");
      expect(rec).toHaveProperty("reason");
      expect(rec).toHaveProperty("allScores");
    });

    test("recommends engine for hotel query", () => {
      const rec = getRecommendedEngine("hotel in paris", "user1");
      expect(["tavily", "google"]).toContain(rec.recommended);
    });

    test("includes alternatives", () => {
      const rec = getRecommendedEngine("hotel", "user1");
      expect(rec.alternatives.length).toBeGreaterThan(0);
    });

    test("all scores are numbers", () => {
      const rec = getRecommendedEngine("test", "user1");
      for (const score of Object.values(rec.allScores)) {
        expect(typeof score).toBe("number");
      }
    });
  });

  describe("getSmartDefaults", () => {
    test("returns defaults object", () => {
      const defaults = getSmartDefaults("hotel", "user1");
      expect(defaults).toHaveProperty("engine");
      expect(defaults).toHaveProperty("queryType");
      expect(defaults).toHaveProperty("reason");
      expect(defaults).toHaveProperty("recommendation");
    });

    test("engine is a valid engine name", () => {
      const defaults = getSmartDefaults("hotel", "user1");
      expect(["tavily", "ddg", "google", "searxng"]).toContain(defaults.engine);
    });
  });

  describe("API routes", () => {
    test("GET /api/smart-defaults requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/smart-defaults?q=hotel");
      expect(status).toBe(401);
    });

    test("GET /api/smart-defaults requires q", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/smart-defaults", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(400);
    });

    test("GET /api/smart-defaults returns defaults", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/smart-defaults?q=hotel+paris", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("engine");
      expect(body).toHaveProperty("queryType");
    });

    test("POST /api/smart-defaults/recommend requires query", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/smart-defaults/recommend", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/smart-defaults/recommend returns recommendation", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/smart-defaults/recommend", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { query: "hotel in paris" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("recommended");
    });

    test("POST /api/smart-defaults/classify returns query type", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/smart-defaults/classify", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { query: "hilton" },
      });
      expect(status).toBe(200);
      expect(body.queryType).toBe("brand");
    });

    test("POST /api/smart-defaults/classify requires query", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/smart-defaults/classify", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });
  });
});
