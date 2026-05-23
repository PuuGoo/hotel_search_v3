import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import http from "http";
import { ErrorCodes, apiError, errorCodesMiddleware } from "../middleware/errorCodes.js";

let server;
let baseUrl;

function makeRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () =>
          resolve({ status: res.statusCode, json: () => Promise.resolve(JSON.parse(body)) })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(errorCodesMiddleware);

  app.get("/api/auth-required", (req, res) => {
    res.apiError(ErrorCodes.AUTH_REQUIRED);
  });

  app.get("/api/not-found", (req, res) => {
    res.apiError(ErrorCodes.RESOURCE_NOT_FOUND);
  });

  app.get("/api/validation", (req, res) => {
    res.apiError(ErrorCodes.VALIDATION_FAILED, { fields: ["email", "name"] });
  });

  app.get("/api/rate-limit", (req, res) => {
    res.apiError(ErrorCodes.RATE_LIMIT_EXCEEDED, { retryAfter: 60 });
  });

  return app;
}

beforeAll(async () => {
  const app = createTestApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

afterAll((done) => {
  server.close(done);
});

describe("Structured Error Codes", () => {
  test("ErrorCodes has auth errors", () => {
    expect(ErrorCodes.AUTH_REQUIRED.code).toBe("AUTH_REQUIRED");
    expect(ErrorCodes.AUTH_REQUIRED.status).toBe(401);
  });

  test("ErrorCodes has validation errors", () => {
    expect(ErrorCodes.VALIDATION_FAILED.code).toBe("VALIDATION_FAILED");
    expect(ErrorCodes.VALIDATION_FAILED.status).toBe(400);
  });

  test("ErrorCodes has resource errors", () => {
    expect(ErrorCodes.RESOURCE_NOT_FOUND.code).toBe("RESOURCE_NOT_FOUND");
    expect(ErrorCodes.RESOURCE_NOT_FOUND.status).toBe(404);
  });

  test("ErrorCodes has rate limit errors", () => {
    expect(ErrorCodes.RATE_LIMIT_EXCEEDED.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(ErrorCodes.RATE_LIMIT_EXCEEDED.status).toBe(429);
  });

  test("ErrorCodes has server errors", () => {
    expect(ErrorCodes.SERVER_ERROR.code).toBe("SERVER_ERROR");
    expect(ErrorCodes.SERVER_ERROR.status).toBe(500);
  });

  test("apiError returns correct status and body", async () => {
    const res = await makeRequest(`${baseUrl}/api/auth-required`);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("AUTH_REQUIRED");
    expect(data.error).toBe("Authentication required");
    expect(data.status).toBe(401);
  });

  test("apiError with details", async () => {
    const res = await makeRequest(`${baseUrl}/api/validation`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe("VALIDATION_FAILED");
    expect(data.details).toEqual({ fields: ["email", "name"] });
  });

  test("apiError 404", async () => {
    const res = await makeRequest(`${baseUrl}/api/not-found`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("RESOURCE_NOT_FOUND");
  });

  test("apiError 429 with retry details", async () => {
    const res = await makeRequest(`${baseUrl}/api/rate-limit`);
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(data.details.retryAfter).toBe(60);
  });

  test("errorCodesMiddleware adds apiError to res", () => {
    const res = {};
    let nextCalled = false;
    errorCodesMiddleware({}, res, () => { nextCalled = true; });
    expect(typeof res.apiError).toBe("function");
    expect(nextCalled).toBe(true);
  });
});
