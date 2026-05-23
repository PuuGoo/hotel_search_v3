import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import http from "http";
import { fetchWithRetry, retryMiddleware } from "../middleware/retry.js";

let server;
let baseUrl;
let failCount = 0;

function createTestApp() {
  const app = express();

  // Endpoint that fails first N times then succeeds
  app.get("/api/flaky", (_req, res) => {
    failCount++;
    if (failCount <= 2) {
      return res.status(503).json({ error: "Service unavailable" });
    }
    res.json({ success: true });
  });

  // Endpoint that always returns 429 with Retry-After
  app.get("/api/rate-limited", (_req, res) => {
    res.setHeader("Retry-After", "1");
    res.status(429).json({ error: "Too many requests" });
  });

  // Endpoint that always succeeds
  app.get("/api/stable", (_req, res) => {
    res.json({ ok: true });
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

describe("Retry Middleware", () => {
  test("fetchWithRetry succeeds on first try", async () => {
    const res = await fetchWithRetry(`${baseUrl}/api/stable`, {}, { maxRetries: 2, baseDelayMs: 10 });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  test("fetchWithRetry retries on 503 and eventually succeeds", async () => {
    failCount = 0;
    const res = await fetchWithRetry(`${baseUrl}/api/flaky`, {}, { maxRetries: 3, baseDelayMs: 10 });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("fetchWithRetry returns last response when all retries fail", async () => {
    const res = await fetchWithRetry(
      `${baseUrl}/api/rate-limited`,
      {},
      { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 50 }
    );
    expect(res.status).toBe(429);
  });

  test("fetchWithRetry respects custom retryable statuses", async () => {
    const res = await fetchWithRetry(
      `${baseUrl}/api/stable`,
      {},
      { maxRetries: 1, retryableStatuses: [500] }
    );
    expect(res.ok).toBe(true);
  });

  test("retryMiddleware adds fetchWithRetry to request", () => {
    const req = {};
    const res = {};
    let nextCalled = false;
    retryMiddleware(req, res, () => { nextCalled = true; });
    expect(typeof req.fetchWithRetry).toBe("function");
    expect(nextCalled).toBe(true);
  });

  test("fetchWithRetry with default options", async () => {
    const res = await fetchWithRetry(`${baseUrl}/api/stable`);
    expect(res.ok).toBe(true);
  });
});
