import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import rankingFeedbackRoutes from "../routes/rankingFeedback.js";
import {
  recordClick,
  getRankingBoosts,
  rerankResults,
  getClickStats,
  getUrlClickHistory,
  clearRankingFeedback,
} from "../utils/rankingFeedback.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FEEDBACK_FILE = path.join(__dirname, "..", "ranking_feedback.json");

let feedbackBackup;

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
  app.use(rankingFeedbackRoutes);
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

describe("Ranking Feedback", () => {
  beforeEach(() => {
    try { feedbackBackup = fs.readFileSync(FEEDBACK_FILE, "utf8"); } catch { feedbackBackup = null; }
    clearRankingFeedback();
  });

  afterEach(() => {
    if (feedbackBackup) {
      let retries = 5;
      while (retries-- > 0) {
        try { fs.writeFileSync(FEEDBACK_FILE, feedbackBackup); break; }
        catch (e) { if (e.code === "EBUSY") { /* retry */ } else throw e; }
      }
    } else {
      try { fs.unlinkSync(FEEDBACK_FILE); } catch {}
    }
  });

  describe("Utility functions", () => {
    test("recordClick records a click", () => {
      const click = recordClick({
        userId: "user1",
        query: "hotel paris",
        url: "https://example.com/hotel",
        title: "Hotel Paris",
        engine: "ddg",
        position: 2,
      });
      expect(click).toHaveProperty("id");
      expect(click.url).toBe("https://example.com/hotel");
      expect(click.position).toBe(2);
    });

    test("getRankingBoosts returns neutral for unknown URLs", () => {
      const boosts = getRankingBoosts(["https://unknown.com"]);
      expect(boosts["https://unknown.com"]).toBe(1.0);
    });

    test("getRankingBoosts boosts clicked URLs", () => {
      recordClick({ url: "https://popular.com", query: "hotel", position: 0 });
      recordClick({ url: "https://popular.com", query: "hotel", position: 0 });
      recordClick({ url: "https://popular.com", query: "hotel", position: 0 });
      const boosts = getRankingBoosts(["https://popular.com", "https://unknown.com"]);
      expect(boosts["https://popular.com"]).toBeGreaterThan(1.0);
      expect(boosts["https://unknown.com"]).toBe(1.0);
    });

    test("getRankingBoosts applies query bonus", () => {
      recordClick({ url: "https://example.com", query: "hotel paris", position: 0 });
      const boostsWithQuery = getRankingBoosts(["https://example.com"], { query: "hotel paris" });
      const boostsWithout = getRankingBoosts(["https://example.com"], { query: "other query" });
      expect(boostsWithQuery["https://example.com"]).toBeGreaterThan(boostsWithout["https://example.com"]);
    });

    test("getRankingBoosts caps at 2.0", () => {
      for (let i = 0; i < 100; i++) {
        recordClick({ url: "https://hot.com", position: 0 });
      }
      const boosts = getRankingBoosts(["https://hot.com"]);
      expect(boosts["https://hot.com"]).toBeLessThanOrEqual(2.0);
    });

    test("rerankResults reorders by boosted score", () => {
      recordClick({ url: "https://boosted.com", query: "hotel", position: 0 });
      recordClick({ url: "https://boosted.com", query: "hotel", position: 0 });
      const results = [
        { url: "https://normal.com", score: 1.0 },
        { url: "https://boosted.com", score: 0.8 },
      ];
      const reranked = rerankResults(results, { query: "hotel", boostWeight: 1.0 });
      expect(reranked[0].url).toBe("https://boosted.com");
      expect(reranked[0]).toHaveProperty("originalScore");
      expect(reranked[0]).toHaveProperty("boostedScore");
      expect(reranked[0]).toHaveProperty("clickBoost");
    });

    test("getClickStats returns stats", () => {
      recordClick({ url: "https://a.com", query: "hotel", position: 0 });
      recordClick({ url: "https://b.com", query: "resort", position: 1 });
      const stats = getClickStats();
      expect(stats.totalClicks).toBe(2);
      expect(stats.uniqueUrls).toBe(2);
      expect(stats.topUrls.length).toBe(2);
      expect(stats.topQueries.length).toBe(2);
    });

    test("getClickStats filters by userId", () => {
      recordClick({ userId: "u1", url: "https://a.com" });
      recordClick({ userId: "u2", url: "https://b.com" });
      const stats = getClickStats({ userId: "u1" });
      expect(stats.totalClicks).toBe(1);
    });

    test("getUrlClickHistory returns clicks for URL", () => {
      recordClick({ url: "https://target.com", query: "hotel" });
      recordClick({ url: "https://other.com", query: "resort" });
      const history = getUrlClickHistory("https://target.com");
      expect(history.length).toBe(1);
      expect(history[0].url).toBe("https://target.com");
    });

    test("clearRankingFeedback clears all data", () => {
      recordClick({ url: "https://a.com" });
      clearRankingFeedback();
      const stats = getClickStats();
      expect(stats.totalClicks).toBe(0);
    });

    test("position decay affects boost", () => {
      recordClick({ url: "https://top.com", position: 0 });
      recordClick({ url: "https://bottom.com", position: 9 });
      const boosts = getRankingBoosts(["https://top.com", "https://bottom.com"]);
      expect(boosts["https://top.com"]).toBeGreaterThan(boosts["https://bottom.com"]);
    });
  });

  describe("API Routes", () => {
    test("POST /api/ranking/click requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/ranking/click", {
        method: "POST",
        body: { url: "https://example.com" },
      });
      expect(status).toBe(401);
    });

    test("POST /api/ranking/click requires url", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/ranking/click", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/ranking/click records click", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/ranking/click", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { url: "https://example.com", query: "hotel", position: 2 },
      });
      expect(status).toBe(201);
      expect(body.url).toBe("https://example.com");
    });

    test("POST /api/ranking/boosts requires urls array", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/ranking/boosts", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/ranking/boosts returns boosts", async () => {
      recordClick({ url: "https://boosted.com", position: 0 });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/ranking/boosts", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { urls: ["https://boosted.com", "https://normal.com"] },
      });
      expect(status).toBe(200);
      expect(body.boosts["https://boosted.com"]).toBeDefined();
    });

    test("POST /api/ranking/rerank requires results array", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/ranking/rerank", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/ranking/rerank returns reranked results", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/ranking/rerank", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { results: [{ url: "https://a.com", score: 1.0 }] },
      });
      expect(status).toBe(200);
      expect(body.results.length).toBe(1);
    });

    test("GET /api/ranking/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/ranking/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/ranking/stats returns stats for admin", async () => {
      recordClick({ url: "https://a.com" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/ranking/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalClicks");
    });

    test("GET /api/ranking/url/:encodedUrl returns click history", async () => {
      recordClick({ url: "https://target.com" });
      const app = createTestApp();
      const encoded = encodeURIComponent("https://target.com");
      const { status, body } = await makeRequest(app, `/api/ranking/url/${encoded}`, {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.clicks.length).toBe(1);
    });

    test("DELETE /api/ranking/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/ranking/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/ranking/clear clears data for admin", async () => {
      recordClick({ url: "https://a.com" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/ranking/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
