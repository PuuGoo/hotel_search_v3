import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import http from "http";
import { slowRequestTimeout } from "../middleware/slowTimeout.js";

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
        method: options.method || "POST",
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
    if (options.body) req.write(options.body);
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Slow timeout with aggressive settings for testing
  app.use(slowRequestTimeout({ thresholdMsPerKb: 1, minBodySize: 100, gracePeriod: 50 }));

  app.post("/api/test", (req, res) => {
    res.json({ received: true, size: req.body?.size || 0 });
  });

  app.get("/api/test-get", (_req, res) => {
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

describe("Slow Request Timeout", () => {
  test("GET requests are not affected", async () => {
    const res = await makeRequest(`${baseUrl}/api/test-get`, { method: "GET" });
    expect(res.status).toBe(200);
  });

  test("fast POST request succeeds", async () => {
    const body = JSON.stringify({ size: 100 });
    const res = await makeRequest(`${baseUrl}/api/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      body,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.received).toBe(true);
  });

  test("slow request timeout module exports function", () => {
    expect(typeof slowRequestTimeout).toBe("function");
    const middleware = slowRequestTimeout();
    expect(typeof middleware).toBe("function");
  });

  test("slow request timeout accepts options", () => {
    const middleware = slowRequestTimeout({
      thresholdMsPerKb: 200,
      minBodySize: 2048,
      gracePeriod: 10000,
    });
    expect(typeof middleware).toBe("function");
  });

  test("slow request timeout with default options", () => {
    const middleware = slowRequestTimeout();
    expect(typeof middleware).toBe("function");
  });
});
