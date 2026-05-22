import { describe, test, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { csrfProtection, generateCsrfToken, validateCsrfToken } from "../middleware/csrf.js";

describe("CSRF Protection Middleware", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("csrfProtection", () => {
    test("should skip for GET requests", () => {
      const req = { method: "GET", headers: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test("should skip for HEAD requests", () => {
      const req = { method: "HEAD", headers: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test("should skip for OPTIONS requests", () => {
      const req = { method: "OPTIONS", headers: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test("should allow POST with matching origin", () => {
      const req = {
        method: "POST",
        headers: { origin: "http://localhost:3000", host: "localhost:3000" },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test("should block POST with mismatched origin when no CORS_ORIGINS", () => {
      delete process.env.CORS_ORIGINS;
      const req = {
        method: "POST",
        headers: { origin: "https://evil.com", host: "localhost:3000" },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("CSRF") }));
    });

    test("should allow POST with allowed CORS origin", () => {
      process.env.CORS_ORIGINS = "https://example.com,https://app.example.com";
      const req = {
        method: "POST",
        headers: { origin: "https://example.com" },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test("should block POST with disallowed CORS origin", () => {
      process.env.CORS_ORIGINS = "https://example.com";
      const req = {
        method: "POST",
        headers: { origin: "https://evil.com" },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    test("should allow POST without origin header (server-to-server)", () => {
      const req = {
        method: "POST",
        headers: { host: "localhost:3000" },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test("should check referer when origin is missing", () => {
      delete process.env.CORS_ORIGINS;
      const req = {
        method: "POST",
        headers: { referer: "http://localhost:3000/page", host: "localhost:3000" },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      csrfProtection(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("generateCsrfToken", () => {
    test("should generate token and store in session", () => {
      const req = { session: {} };
      const res = { locals: {} };
      const next = jest.fn();

      generateCsrfToken(req, res, next);

      expect(req.session.csrfToken).toBeDefined();
      expect(req.session.csrfToken).toHaveLength(64);
      expect(res.locals.csrfToken).toBe(req.session.csrfToken);
      expect(next).toHaveBeenCalled();
    });

    test("should not overwrite existing token", () => {
      const req = { session: { csrfToken: "existing-token" } };
      const res = { locals: {} };
      const next = jest.fn();

      generateCsrfToken(req, res, next);

      expect(req.session.csrfToken).toBe("existing-token");
      expect(res.locals.csrfToken).toBe("existing-token");
    });
  });

  describe("validateCsrfToken", () => {
    test("should skip for GET requests", () => {
      const req = { method: "GET", body: {}, headers: {}, session: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      validateCsrfToken(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test("should accept valid token from body", () => {
      const req = {
        method: "POST",
        body: { _csrf: "valid-token" },
        headers: {},
        session: { csrfToken: "valid-token" },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      validateCsrfToken(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test("should accept valid token from header", () => {
      const req = {
        method: "POST",
        body: {},
        headers: { "x-csrf-token": "valid-token" },
        session: { csrfToken: "valid-token" },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      validateCsrfToken(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test("should reject missing token", () => {
      const req = {
        method: "POST",
        body: {},
        headers: {},
        session: { csrfToken: "valid-token" },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      validateCsrfToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("CSRF") }));
    });

    test("should reject invalid token", () => {
      const req = {
        method: "POST",
        body: { _csrf: "wrong-token" },
        headers: {},
        session: { csrfToken: "valid-token" },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      validateCsrfToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
