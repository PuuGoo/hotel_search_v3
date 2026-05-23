import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import userProfileRoutes from "../routes/userSearchProfile.js";
import {
  buildUserProfile,
  getUserProfile,
  compareProfiles,
  getProfileStats,
} from "../utils/userSearchProfile.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const PROFILES_FILE = path.join(__dirname, "..", "user_profiles.json");

let historyBackup;
let profilesBackup;

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
  app.use(userProfileRoutes);
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

describe("User Search Profile", () => {
  beforeEach(() => {
    try { historyBackup = fs.readFileSync(HISTORY_FILE, "utf8"); } catch { historyBackup = null; }
    try { profilesBackup = fs.readFileSync(PROFILES_FILE, "utf8"); } catch { profilesBackup = null; }
    try { fs.writeFileSync(PROFILES_FILE, "{}"); } catch {}
  });

  afterEach(() => {
    if (historyBackup) fs.writeFileSync(HISTORY_FILE, historyBackup);
    else { try { fs.unlinkSync(HISTORY_FILE); } catch {} }
    if (profilesBackup) fs.writeFileSync(PROFILES_FILE, profilesBackup);
    else { try { fs.unlinkSync(PROFILES_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("buildUserProfile returns unbuilt for empty history", () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));
      const profile = buildUserProfile("newuser");
      expect(profile.built).toBe(false);
      expect(profile.preferences).toEqual({});
    });

    test("buildUserProfile builds profile from history", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now - 200000).toISOString(), engine: "ddg" },
        { userId: "user1", query: "hotel london", timestamp: new Date(now - 100000).toISOString(), engine: "ddg" },
        { userId: "user1", query: "luxury hotel", timestamp: new Date(now).toISOString(), engine: "google" },
      ]));
      const profile = buildUserProfile("user1");
      expect(profile.built).toBe(true);
      expect(profile.totalSearches).toBe(3);
      expect(profile.preferences.engine).toBe("ddg");
    });

    test("buildUserProfile detects price sensitivity", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "cheap hotel", timestamp: new Date(now - 100000).toISOString() },
        { userId: "user1", query: "budget hotel", timestamp: new Date(now).toISOString() },
      ]));
      const profile = buildUserProfile("user1");
      expect(profile.preferences.priceSensitive).toBe(true);
    });

    test("buildUserProfile detects luxury preference", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "luxury hotel", timestamp: new Date(now - 100000).toISOString() },
        { userId: "user1", query: "premium resort", timestamp: new Date(now).toISOString() },
      ]));
      const profile = buildUserProfile("user1");
      expect(profile.preferences.luxuryPreference).toBe(true);
    });

    test("buildUserProfile generates recommendations", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now - 100000).toISOString(), engine: "ddg" },
        { userId: "user1", query: "hotel london", timestamp: new Date(now).toISOString(), engine: "ddg" },
      ]));
      const profile = buildUserProfile("user1");
      expect(profile.recommendations.length).toBeGreaterThan(0);
      expect(profile.recommendations[0]).toHaveProperty("type");
      expect(profile.recommendations[0]).toHaveProperty("message");
    });

    test("getUserProfile returns cached profile", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
      ]));
      buildUserProfile("user1");
      const profile = getUserProfile("user1");
      expect(profile.built).toBe(true);
    });

    test("getUserProfile rebuilds stale profile", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
      ]));
      // Build a profile with old timestamp
      const allProfiles = {};
      allProfiles["user1"] = {
        userId: "user1",
        built: true,
        totalSearches: 1,
        lastUpdated: new Date(now - 86400000 * 2).toISOString(), // 2 days ago
      };
      fs.writeFileSync(PROFILES_FILE, JSON.stringify(allProfiles));

      const profile = getUserProfile("user1");
      expect(profile.built).toBe(true);
    });

    test("compareProfiles compares two users", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now - 100000).toISOString(), engine: "ddg" },
        { userId: "user1", query: "hotel london", timestamp: new Date(now).toISOString(), engine: "ddg" },
        { userId: "user2", query: "hotel paris", timestamp: new Date(now - 100000).toISOString(), engine: "ddg" },
        { userId: "user2", query: "hotel rome", timestamp: new Date(now).toISOString(), engine: "google" },
      ]));
      const comparison = compareProfiles("user1", "user2");
      expect(comparison).not.toBeNull();
      expect(comparison).toHaveProperty("similarity");
      expect(comparison).toHaveProperty("commonTopics");
      expect(comparison).toHaveProperty("details");
    });

    test("compareProfiles returns null for unbuilt profiles", () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));
      expect(compareProfiles("newuser1", "newuser2")).toBeNull();
    });

    test("getProfileStats returns statistics", () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString(), engine: "ddg" },
      ]));
      buildUserProfile("user1");
      const stats = getProfileStats();
      expect(stats.totalProfiles).toBeGreaterThan(0);
      expect(stats).toHaveProperty("avgSearchesPerUser");
      expect(stats).toHaveProperty("topEngines");
    });

    test("getProfileStats handles empty profiles", () => {
      const stats = getProfileStats();
      expect(stats.totalProfiles).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("GET /api/profile requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/profile");
      expect(status).toBe(401);
    });

    test("GET /api/profile returns profile", async () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
      ]));
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/profile", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("built");
    });

    test("POST /api/profile/rebuild rebuilds profile", async () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel", timestamp: new Date(now).toISOString() },
      ]));
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/profile/rebuild", {
        method: "POST",
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.built).toBe(true);
    });

    test("GET /api/profile/compare requires userId1 and userId2", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/profile/compare", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(400);
    });

    test("GET /api/profile/compare compares profiles", async () => {
      const now = Date.now();
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "user1", query: "hotel paris", timestamp: new Date(now).toISOString(), engine: "ddg" },
        { userId: "user2", query: "hotel london", timestamp: new Date(now).toISOString(), engine: "google" },
      ]));
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/profile/compare?userId1=user1&userId2=user2", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("similarity");
    });

    test("GET /api/profile/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/profile/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/profile/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/profile/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalProfiles");
    });
  });
});
