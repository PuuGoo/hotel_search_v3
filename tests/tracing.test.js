import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import http from "http";
import {
  generateTraceContext,
  parseTraceparent,
  tracingMiddleware,
  propagateTrace,
} from "../middleware/tracing.js";

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
        headers: options.headers || {},
      },
      (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, json: () => Promise.resolve(JSON.parse(body)) })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(tracingMiddleware);

  app.get("/api/test", (req, res) => {
    res.json({ traceId: req.traceId, spanId: req.spanId });
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

describe("Request Tracing", () => {
  test("generateTraceContext returns valid trace", () => {
    const trace = generateTraceContext();
    expect(trace.traceId).toHaveLength(32);
    expect(trace.spanId).toHaveLength(16);
    expect(trace.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  });

  test("parseTraceparent extracts trace context", () => {
    const trace = generateTraceContext();
    const parsed = parseTraceparent(trace.traceparent);
    expect(parsed).not.toBeNull();
    expect(parsed.traceId).toBe(trace.traceId);
    expect(parsed.spanId).toBe(trace.spanId);
    expect(parsed.flags).toBe("01");
  });

  test("parseTraceparent returns null for invalid format", () => {
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent("")).toBeNull();
    expect(parseTraceparent("invalid")).toBeNull();
    expect(parseTraceparent("01-too-many-parts-here")).toBeNull();
  });

  test("middleware generates trace ID when none provided", async () => {
    const res = await makeRequest(`${baseUrl}/api/test`);
    expect(res.status).toBe(200);
    expect(res.headers["x-trace-id"]).toBeDefined();
    expect(res.headers["x-span-id"]).toBeDefined();
    const data = await res.json();
    expect(data.traceId).toBe(res.headers["x-trace-id"]);
  });

  test("middleware preserves incoming trace context", async () => {
    const trace = generateTraceContext();
    const res = await makeRequest(`${baseUrl}/api/test`, {
      headers: { traceparent: trace.traceparent },
    });
    const data = await res.json();
    expect(data.traceId).toBe(trace.traceId);
  });

  test("propagateTrace adds trace headers to options", () => {
    const req = { traceId: "abc123" };
    const options = propagateTrace(req, { headers: { "Content-Type": "application/json" } });
    expect(options.headers["X-Trace-Id"]).toBe("abc123");
    expect(options.headers["traceparent"]).toContain("abc123");
    expect(options.headers["Content-Type"]).toBe("application/json");
  });
});
