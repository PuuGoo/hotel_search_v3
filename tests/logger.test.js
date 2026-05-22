import { describe, test, expect, jest } from "@jest/globals";
import { requestLogger } from "../middleware/logger.js";

describe("Request Logger Middleware", () => {
  test("should call next()", () => {
    const req = { method: "GET", url: "/test" };
    const res = { on: jest.fn(), statusCode: 200, end: jest.fn() };
    const next = jest.fn();

    requestLogger(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test("should register finish event listener", () => {
    const req = { method: "GET", url: "/test" };
    const res = { on: jest.fn(), statusCode: 200, end: jest.fn() };
    const next = jest.fn();

    requestLogger(req, res, next);

    expect(res.on).toHaveBeenCalledWith("finish", expect.any(Function));
  });

  test("should override res.end to set response time header", () => {
    const req = { method: "GET", url: "/test" };
    const originalEnd = jest.fn();
    const res = {
      on: jest.fn(),
      statusCode: 200,
      end: originalEnd,
      setHeader: jest.fn(),
      headersSent: false,
    };
    const next = jest.fn();

    requestLogger(req, res, next);

    // res.end should be overridden
    expect(res.end).not.toBe(originalEnd);
  });

  test("should set X-Response-Time header when res.end is called", () => {
    const req = { method: "GET", url: "/test" };
    const originalEnd = jest.fn();
    const res = {
      on: jest.fn(),
      statusCode: 200,
      end: originalEnd,
      setHeader: jest.fn(),
      headersSent: false,
    };
    const next = jest.fn();

    requestLogger(req, res, next);

    // Call the overridden res.end
    res.end();

    expect(res.setHeader).toHaveBeenCalledWith("X-Response-Time", expect.stringMatching(/^\d+ms$/));
    expect(originalEnd).toHaveBeenCalled();
  });

  test("should not set header if headers already sent", () => {
    const req = { method: "GET", url: "/test" };
    const originalEnd = jest.fn();
    const res = {
      on: jest.fn(),
      statusCode: 200,
      end: originalEnd,
      setHeader: jest.fn(),
      headersSent: true,
    };
    const next = jest.fn();

    requestLogger(req, res, next);

    res.end();

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(originalEnd).toHaveBeenCalled();
  });

  test("should log error for 4xx/5xx status codes", () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const req = { method: "POST", url: "/api/test" };
    const res = { on: jest.fn(), statusCode: 500, end: jest.fn() };
    const next = jest.fn();

    requestLogger(req, res, next);

    // Simulate finish event
    const finishCallback = res.on.mock.calls.find((call) => call[0] === "finish")[1];
    finishCallback();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("500"));

    consoleSpy.mockRestore();
    logSpy.mockRestore();
  });

  test("should log normal for 2xx status codes", () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const req = { method: "GET", url: "/health" };
    const res = { on: jest.fn(), statusCode: 200, end: jest.fn() };
    const next = jest.fn();

    requestLogger(req, res, next);

    // Simulate finish event
    const finishCallback = res.on.mock.calls.find((call) => call[0] === "finish")[1];
    finishCallback();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("200"));

    consoleSpy.mockRestore();
  });
});
