import { describe, test, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { rateLimitLogin, recordLoginFailure, _loginAttempts, _RATE_LIMIT_WINDOW, rateLimitSearch, _searchRequests, _SEARCH_RATE_WINDOW, _cleanupExpired, rateLimitStatus } from "../middleware/rateLimit.js";

describe("Rate Limiter", () => {
  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn();
    return res;
  };

  let dateNowSpy;

  beforeEach(() => {
    dateNowSpy = jest.spyOn(Date, "now");
    dateNowSpy.mockReturnValue(1000000);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  test("should allow first request", () => {
    const req = { ip: "192.168.1.1", connection: { remoteAddress: "192.168.1.1" } };
    const res = mockRes();
    const next = jest.fn();

    rateLimitLogin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("should allow requests within limit", () => {
    const req = { ip: "192.168.1.2", connection: { remoteAddress: "192.168.1.2" } };
    const res = mockRes();
    const next = jest.fn();

    for (let i = 0; i < 5; i++) {
      rateLimitLogin(req, res, next);
    }

    expect(next).toHaveBeenCalledTimes(5);
  });

  test("should block after max failed attempts", () => {
    const req = { ip: "192.168.1.3", connection: { remoteAddress: "192.168.1.3" } };
    const res = mockRes();
    const next = jest.fn();

    // Simulate 5 failed login attempts
    for (let i = 0; i < 5; i++) {
      recordLoginFailure(req);
      rateLimitLogin(req, res, next);
    }

    // 6th attempt should be blocked
    rateLimitLogin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining("Quá nhiều"),
    }));
  });

  test("should use connection.remoteAddress as fallback", () => {
    const req = { connection: { remoteAddress: "192.168.1.4" } };
    const res = mockRes();
    const next = jest.fn();

    rateLimitLogin(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test("should use 'unknown' when no IP available", () => {
    const req = { connection: {} };
    const res = mockRes();
    const next = jest.fn();

    rateLimitLogin(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test("should reset counter after window expires", () => {
    const ip = "192.168.1.50";
    const req = { ip, connection: { remoteAddress: ip } };
    const res = mockRes();
    const next = jest.fn();

    // Simulate 4 failed login attempts (count becomes 4)
    for (let i = 0; i < 4; i++) {
      recordLoginFailure(req);
    }

    // 5th attempt should still be allowed (count=4 < MAX_ATTEMPTS=5)
    rateLimitLogin(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();

    // Simulate one more failure (count becomes 5)
    recordLoginFailure(req);

    // Now should be blocked (count=5 >= MAX_ATTEMPTS=5)
    const res2 = mockRes();
    const next2 = jest.fn();
    rateLimitLogin(req, res2, next2);
    expect(res2.status).toHaveBeenCalledWith(429);

    // Advance time past the window (15 minutes + 1ms)
    dateNowSpy.mockReturnValue(1000000 + 15 * 60 * 1000 + 1);

    const res3 = mockRes();
    const next3 = jest.fn();

    // Should be allowed again after window reset
    rateLimitLogin(req, res3, next3);
    expect(next3).toHaveBeenCalled();
    expect(res3.status).not.toHaveBeenCalled();
  });

  test("should track different IPs independently", () => {
    const req1 = { ip: "10.0.0.1", connection: { remoteAddress: "10.0.0.1" } };
    const req2 = { ip: "10.0.0.2", connection: { remoteAddress: "10.0.0.2" } };
    const res1 = mockRes();
    const res2 = mockRes();
    const next1 = jest.fn();
    const next2 = jest.fn();

    // Exhaust IP1 with failed attempts
    for (let i = 0; i < 5; i++) {
      recordLoginFailure(req1);
      rateLimitLogin(req1, res1, next1);
    }
    rateLimitLogin(req1, res1, next1);
    expect(res1.status).toHaveBeenCalledWith(429);

    // IP2 should still be allowed
    rateLimitLogin(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
    expect(res2.status).not.toHaveBeenCalled();
  });

  test("should return error message in blocked response", () => {
    const ip = "10.0.0.50";
    const req = { ip, connection: { remoteAddress: ip } };
    const res = mockRes();
    const next = jest.fn();

    // Simulate 5 failed attempts to exceed limit
    for (let i = 0; i < 5; i++) {
      recordLoginFailure(req);
    }
    // Now rateLimitLogin will block
    rateLimitLogin(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.any(String),
    }));
  });

  test("should not reset if within window", () => {
    const ip = "192.168.1.60";
    const req = { ip, connection: { remoteAddress: ip } };
    const res = mockRes();
    const next = jest.fn();

    // Simulate 5 failed login attempts
    for (let i = 0; i < 5; i++) {
      recordLoginFailure(req);
      rateLimitLogin(req, res, next);
    }

    // Advance time but not past window
    dateNowSpy.mockReturnValue(1000000 + 1000);

    const res2 = mockRes();
    const next2 = jest.fn();

    // Should still be blocked
    rateLimitLogin(req, res2, next2);
    expect(res2.status).toHaveBeenCalledWith(429);
  });

  test("should cleanup expired entries after window passes", () => {
    // Clear the map
    _loginAttempts.clear();

    // Add an expired entry
    _loginAttempts.set("expired-ip", { count: 3, firstAttempt: 1000000 - _RATE_LIMIT_WINDOW - 1 });

    // Add a valid entry
    _loginAttempts.set("valid-ip", { count: 2, firstAttempt: 1000000 });

    expect(_loginAttempts.size).toBe(2);

    // Run the cleanup function
    _cleanupExpired();

    // The expired entry should be removed
    expect(_loginAttempts.has("expired-ip")).toBe(false);
    expect(_loginAttempts.has("valid-ip")).toBe(true);
  });
});

describe("Search Rate Limiter", () => {
  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn();
    return res;
  };

  let dateNowSpy;

  beforeEach(() => {
    dateNowSpy = jest.spyOn(Date, "now");
    dateNowSpy.mockReturnValue(1000000);
    _searchRequests.clear();
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  test("should allow first search request", () => {
    const req = { ip: "192.168.1.1", connection: { remoteAddress: "192.168.1.1" } };
    const res = mockRes();
    const next = jest.fn();

    rateLimitSearch(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("should allow requests within limit (30 per minute)", () => {
    const req = { ip: "192.168.1.2", connection: { remoteAddress: "192.168.1.2" } };
    const res = mockRes();
    const next = jest.fn();

    for (let i = 0; i < 30; i++) {
      rateLimitSearch(req, res, next);
    }

    expect(next).toHaveBeenCalledTimes(30);
  });

  test("should block after 30 requests per minute", () => {
    const req = { ip: "192.168.1.3", connection: { remoteAddress: "192.168.1.3" } };
    const res = mockRes();
    const next = jest.fn();

    for (let i = 0; i < 30; i++) {
      rateLimitSearch(req, res, next);
    }

    rateLimitSearch(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining("tìm kiếm"),
    }));
  });

  test("should reset counter after 1-minute window expires", () => {
    const ip = "192.168.1.50";
    const req = { ip, connection: { remoteAddress: ip } };
    const res = mockRes();
    const next = jest.fn();

    for (let i = 0; i < 30; i++) {
      rateLimitSearch(req, res, next);
    }

    // Advance time past the 1-minute window
    dateNowSpy.mockReturnValue(1000000 + 60 * 1000 + 1);

    const res2 = mockRes();
    const next2 = jest.fn();

    rateLimitSearch(req, res2, next2);
    expect(next2).toHaveBeenCalled();
    expect(res2.status).not.toHaveBeenCalled();
  });

  test("should cleanup expired search entries", () => {
    _searchRequests.set("expired-ip", { count: 10, firstRequest: 1000000 - _SEARCH_RATE_WINDOW - 1 });
    _searchRequests.set("valid-ip", { count: 5, firstRequest: 1000000 });

    expect(_searchRequests.size).toBe(2);

    _cleanupExpired();

    expect(_searchRequests.has("expired-ip")).toBe(false);
    expect(_searchRequests.has("valid-ip")).toBe(true);
  });
});

describe("Rate Limit Status Endpoint", () => {
  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn();
    return res;
  };

  let dateNowSpy;

  beforeEach(() => {
    dateNowSpy = jest.spyOn(Date, "now");
    dateNowSpy.mockReturnValue(1000000);
    _searchRequests.clear();
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  test("should return zero usage for new IP", () => {
    const req = { ip: "10.0.0.1", connection: { remoteAddress: "10.0.0.1" } };
    const res = mockRes();

    rateLimitStatus(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      search: expect.objectContaining({
        used: 0,
        remaining: expect.any(Number),
        windowMs: expect.any(Number),
      }),
    }));
  });

  test("should return current usage after requests", () => {
    const req = { ip: "10.0.0.2", connection: { remoteAddress: "10.0.0.2" } };
    const next = jest.fn();

    // Make 5 search requests
    for (let i = 0; i < 5; i++) {
      rateLimitSearch(req, mockRes(), next);
    }

    const res = mockRes();
    rateLimitStatus(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      search: expect.objectContaining({
        used: 5,
        resetInMs: expect.any(Number),
      }),
    }));
  });

  test("should return zero usage when window has expired", () => {
    const req = { ip: "10.0.0.3", connection: { remoteAddress: "10.0.0.3" } };
    const next = jest.fn();

    // Make requests
    for (let i = 0; i < 10; i++) {
      rateLimitSearch(req, mockRes(), next);
    }

    // Advance time past window
    dateNowSpy.mockReturnValue(1000000 + 60 * 1000 + 1);

    const res = mockRes();
    rateLimitStatus(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      search: expect.objectContaining({
        used: 0,
        remaining: expect.any(Number),
        resetInMs: 0,
      }),
    }));
  });

  test("should return usage for IP with expired entry still in map", () => {
    // Manually add an expired entry
    _searchRequests.set("10.0.0.4", { count: 15, firstRequest: 1000000 - _SEARCH_RATE_WINDOW - 1000 });

    const req = { ip: "10.0.0.4", connection: { remoteAddress: "10.0.0.4" } };
    const res = mockRes();

    rateLimitStatus(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      search: expect.objectContaining({
        used: 0,
        resetInMs: 0,
      }),
    }));
  });
});
