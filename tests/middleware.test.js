import { describe, test, expect, jest } from "@jest/globals";
import { requestId } from "../middleware/requestId.js";
import { requestTimeout } from "../middleware/timeout.js";

describe("Request ID Middleware", () => {
  test("should generate UUID when no x-request-id header", () => {
    const req = { headers: {} };
    const res = { setHeader: jest.fn() };
    const next = jest.fn();

    requestId(req, res, next);

    expect(req.requestId).toBeDefined();
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", req.requestId);
    expect(next).toHaveBeenCalled();
  });

  test("should use x-request-id header when provided", () => {
    const customId = "custom-request-id-123";
    const req = { headers: { "x-request-id": customId } };
    const res = { setHeader: jest.fn() };
    const next = jest.fn();

    requestId(req, res, next);

    expect(req.requestId).toBe(customId);
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", customId);
    expect(next).toHaveBeenCalled();
  });
});

describe("Request Timeout Middleware", () => {
  test("should set timeout on request", () => {
    const req = { setTimeout: jest.fn() };
    const res = {};
    const next = jest.fn();

    requestTimeout()(req, res, next);

    expect(req.setTimeout).toHaveBeenCalledWith(30000, expect.any(Function));
    expect(next).toHaveBeenCalled();
  });

  test("should use custom timeout value", () => {
    const req = { setTimeout: jest.fn() };
    const res = {};
    const next = jest.fn();

    requestTimeout(5000)(req, res, next);

    expect(req.setTimeout).toHaveBeenCalledWith(5000, expect.any(Function));
  });

  test("should send 408 when timeout fires and headers not sent", () => {
    let timeoutCallback;
    const req = {
      setTimeout: (_ms, cb) => {
        timeoutCallback = cb;
      },
    };
    const res = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    requestTimeout()(req, res, next);

    // Simulate timeout
    timeoutCallback();

    expect(res.status).toHaveBeenCalledWith(408);
    expect(res.json).toHaveBeenCalledWith({ error: "Request timeout" });
  });

  test("should not send response when headers already sent", () => {
    let timeoutCallback;
    const req = {
      setTimeout: (_ms, cb) => {
        timeoutCallback = cb;
      },
    };
    const res = {
      headersSent: true,
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    requestTimeout()(req, res, next);

    // Simulate timeout
    timeoutCallback();

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
