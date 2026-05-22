import { describe, test, expect, jest } from "@jest/globals";
import { validateSearchQuery, validatePassword, validateUserInput } from "../middleware/validation.js";

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("validateSearchQuery", () => {
  test("should pass with valid query", () => {
    const req = { query: { q: "hotel hanoi" } };
    const res = mockRes();
    const next = jest.fn();

    validateSearchQuery(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("should reject missing query", () => {
    const req = { query: {} };
    const res = mockRes();
    const next = jest.fn();

    validateSearchQuery(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  test("should reject non-string query", () => {
    const req = { query: { q: 123 } };
    const res = mockRes();
    const next = jest.fn();

    validateSearchQuery(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should reject empty query after sanitization", () => {
    const req = { query: { q: "<>" } };
    const res = mockRes();
    const next = jest.fn();

    validateSearchQuery(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should reject query longer than 500 chars", () => {
    const req = { query: { q: "a".repeat(501) } };
    const res = mockRes();
    const next = jest.fn();

    validateSearchQuery(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should sanitize HTML tags from query", () => {
    const req = { query: { q: "<script>alert(1)</script>" } };
    const res = mockRes();
    const next = jest.fn();

    validateSearchQuery(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.query.q).toBe("scriptalert(1)/script");
  });

  test("should accept query at max length", () => {
    const req = { query: { q: "a".repeat(500) } };
    const res = mockRes();
    const next = jest.fn();

    validateSearchQuery(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe("validatePassword", () => {
  test("should pass with valid passwords", () => {
    const req = { body: { oldPassword: "old12345", newPassword: "new12345" } };
    const res = mockRes();
    const next = jest.fn();

    validatePassword(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test("should reject missing old password", () => {
    const req = { body: { newPassword: "new1234" } };
    const res = mockRes();
    const next = jest.fn();

    validatePassword(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should reject missing new password", () => {
    const req = { body: { oldPassword: "old123" } };
    const res = mockRes();
    const next = jest.fn();

    validatePassword(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should reject non-string passwords", () => {
    const req = { body: { oldPassword: 123, newPassword: 456 } };
    const res = mockRes();
    const next = jest.fn();

    validatePassword(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should reject new password shorter than 8 chars", () => {
    const req = { body: { oldPassword: "old12345", newPassword: "abc" } };
    const res = mockRes();
    const next = jest.fn();

    validatePassword(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should reject new password longer than 128 chars", () => {
    const req = { body: { oldPassword: "old12345", newPassword: "a".repeat(129) } };
    const res = mockRes();
    const next = jest.fn();

    validatePassword(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should accept password at min length", () => {
    const req = { body: { oldPassword: "old12345", newPassword: "12345678" } };
    const res = mockRes();
    const next = jest.fn();

    validatePassword(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test("should accept password at max length", () => {
    const req = { body: { oldPassword: "old123", newPassword: "a".repeat(128) } };
    const res = mockRes();
    const next = jest.fn();

    validatePassword(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe("validateUserInput", () => {
  test("should pass with valid input", () => {
    const req = { body: { username: "testuser", password: "pass12345" } };
    const res = mockRes();
    const next = jest.fn();

    validateUserInput(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test("should reject missing username", () => {
    const req = { body: { password: "pass12345" } };
    const res = mockRes();
    const next = jest.fn();

    validateUserInput(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should reject missing password", () => {
    const req = { body: { username: "testuser" } };
    const res = mockRes();
    const next = jest.fn();

    validateUserInput(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should reject non-string inputs", () => {
    const req = { body: { username: 123, password: 456 } };
    const res = mockRes();
    const next = jest.fn();

    validateUserInput(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should reject username shorter than 3 chars", () => {
    const req = { body: { username: "ab", password: "pass12345" } };
    const res = mockRes();
    const next = jest.fn();

    validateUserInput(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should reject username longer than 50 chars", () => {
    const req = { body: { username: "a".repeat(51), password: "pass12345" } };
    const res = mockRes();
    const next = jest.fn();

    validateUserInput(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should reject password shorter than 8 chars", () => {
    const req = { body: { username: "testuser", password: "abc" } };
    const res = mockRes();
    const next = jest.fn();

    validateUserInput(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should reject password longer than 128 chars", () => {
    const req = { body: { username: "testuser", password: "a".repeat(129) } };
    const res = mockRes();
    const next = jest.fn();

    validateUserInput(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should sanitize HTML from username", () => {
    const req = { body: { username: "<b>testuser</b>", password: "pass123455" } };
    const res = mockRes();
    const next = jest.fn();

    validateUserInput(req, res, next);

    expect(next).toHaveBeenCalled();
    // The sanitizer removes < and > characters, leaving the rest
    expect(req.body.username).toBe("btestuser/b");
    expect(req.body.username).not.toContain("<");
    expect(req.body.username).not.toContain(">");
  });

  test("should accept username at min length", () => {
    const req = { body: { username: "abc", password: "pass12345" } };
    const res = mockRes();
    const next = jest.fn();

    validateUserInput(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test("should accept username at max length", () => {
    const req = { body: { username: "a".repeat(50), password: "pass12345" } };
    const res = mockRes();
    const next = jest.fn();

    validateUserInput(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
