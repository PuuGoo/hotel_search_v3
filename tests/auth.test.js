import { describe, test, expect, jest, beforeEach } from "@jest/globals";
import { checkAuthenticated, checkRole, checkFeature, readUsers, writeUsers, VALID_FEATURES } from "../middleware/auth.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, "..", "users.json");

function mockReqRes(sessionData = {}) {
  const req = {
    session: { ...sessionData },
    path: "/test",
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe("Auth Middleware", () => {
  describe("checkAuthenticated", () => {
    test("should call next() when session is authenticated", () => {
      const { req, res, next } = mockReqRes({ isAuthenticated: true });
      checkAuthenticated(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test("should return 401 JSON for API requests when not authenticated", () => {
      const { req, res, next } = mockReqRes({});
      req.path = "/api/test";
      checkAuthenticated(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
      expect(next).not.toHaveBeenCalled();
    });

    test("should redirect to / for non-API requests when not authenticated", () => {
      const { req, res, next } = mockReqRes({});
      checkAuthenticated(req, res, next);
      expect(res.redirect).toHaveBeenCalledWith("/");
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("checkRole", () => {
    test("should call next() when user has matching role", () => {
      const { req, res, next } = mockReqRes({
        isAuthenticated: true,
        user: { role: "admin" },
      });
      const middleware = checkRole("admin");
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test("should return 401 when not authenticated", () => {
      const { req, res, next } = mockReqRes({});
      const middleware = checkRole("admin");
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    });

    test("should return 403 when user role does not match", () => {
      const { req, res, next } = mockReqRes({
        isAuthenticated: true,
        user: { role: "user" },
      });
      const middleware = checkRole("admin");
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Access denied" });
    });

    test("should accept multiple roles", () => {
      const { req, res, next } = mockReqRes({
        isAuthenticated: true,
        user: { role: "user" },
      });
      const middleware = checkRole("admin", "user");
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe("checkFeature", () => {
    test("should call next() when user has matching feature", () => {
      const { req, res, next } = mockReqRes({
        isAuthenticated: true,
        user: { features: ["tavily", "ddg"] },
      });
      const middleware = checkFeature("tavily");
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test("should return 401 when not authenticated", () => {
      const { req, res, next } = mockReqRes({});
      const middleware = checkFeature("tavily");
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test("should return 403 when user lacks feature", () => {
      const { req, res, next } = mockReqRes({
        isAuthenticated: true,
        user: { features: ["ddg"] },
      });
      const middleware = checkFeature("tavily");
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test("should accept multiple features (OR logic)", () => {
      const { req, res, next } = mockReqRes({
        isAuthenticated: true,
        user: { features: ["ddg"] },
      });
      const middleware = checkFeature("tavily", "ddg");
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test("should default to empty features array when user has no features", () => {
      const { req, res, next } = mockReqRes({
        isAuthenticated: true,
        user: {},
      });
      const middleware = checkFeature("tavily");
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe("VALID_FEATURES", () => {
    test("should contain expected features", () => {
      expect(VALID_FEATURES).toContain("tavily");
      expect(VALID_FEATURES).toContain("ddg");
      expect(VALID_FEATURES).toContain("case12");
      expect(VALID_FEATURES).toHaveLength(3);
    });
  });

  describe("readUsers / writeUsers", () => {
    const testFile = path.join(__dirname, "test_users_temp.json");

    beforeEach(() => {
      // Backup original
      if (fs.existsSync(USERS_FILE)) {
        fs.copyFileSync(USERS_FILE, testFile);
      }
    });

    test("readUsers should return an array", () => {
      const users = readUsers();
      expect(Array.isArray(users)).toBe(true);
    });

    test("writeUsers and readUsers should round-trip data", () => {
      const original = readUsers();
      const testUsers = [{ id: 999, username: "__test__", role: "user" }];
      writeUsers(testUsers);
      const loaded = readUsers();
      expect(loaded).toEqual(testUsers);
      // Restore
      writeUsers(original);
    });

    test("readUsers should return empty array on corrupted file", () => {
      const original = readUsers();
      fs.writeFileSync(USERS_FILE, "not valid json", "utf8");
      const users = readUsers();
      expect(users).toEqual([]);
      // Restore
      writeUsers(original);
    });
  });
});
