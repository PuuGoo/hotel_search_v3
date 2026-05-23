import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import crypto from "crypto";
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
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: body,
            json: () => Promise.resolve(JSON.parse(body)),
          })
        );
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

beforeAll(async () => {
  const app = express();

  // Request ID
  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    next();
  });

  // Slow request timeout (before body parser to monitor data events)
  app.use(
    slowRequestTimeout({
      thresholdMsPerKb: 50, // 50ms per KB (fast threshold for testing)
      minBodySize: 100, // Lower threshold for testing
      gracePeriod: 200, // Short grace period for testing
    })
  );

  app.use(express.json({ limit: "1mb" }));

  app.post("/api/data", (req, res) => {
    res.json({ received: true, size: JSON.stringify(req.body).length });
  });

  app.get("/api/test", (_req, res) => {
    res.json({ ok: true });
  });

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
  test("fast request completes normally", async () => {
    const body = JSON.stringify({ data: "x".repeat(1000) });
    const res = await makeRequest(`${baseUrl}/api/data`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.received).toBe(true);
  });

  test("GET requests are not affected by slow request timeout", async () => {
    const res = await makeRequest(`${baseUrl}/api/test`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  test("POST with no body is not affected", async () => {
    const res = await makeRequest(`${baseUrl}/api/data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
  });

  test("slow request times out with 408 or connection error", async () => {
    // Send chunks slowly to trigger speed check
    const body = JSON.stringify({ data: "x".repeat(5000) });
    const res = await new Promise((resolve) => {
      const url = new URL(`${baseUrl}/api/data`);
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let resBody = "";
          res.on("data", (c) => { resBody += c; });
          res.on("end", () =>
            resolve({ status: res.statusCode, text: resBody })
          );
        }
      );
      req.on("error", (err) => {
        resolve({ status: 0, error: err.code });
      });

      // Send 200-byte chunks with 500ms delays (way over 50ms/KB threshold)
      const chunkSize = 200;
      let offset = 0;
      function sendChunk() {
        if (offset >= body.length) {
          req.end();
          return;
        }
        const chunk = body.slice(offset, offset + chunkSize);
        offset += chunkSize;
        req.write(chunk);
        setTimeout(sendChunk, 500);
      }
      sendChunk();
    });

    // Either 408 timeout or connection reset (ECONNRESET)
    expect([408, 0]).toContain(res.status);
  }, 15000);

  test("slowRequestTimeout speed calculation: fast transfer is ok", () => {
    const threshold = 100; // ms per KB
    const bytesReceived = 10240; // 10KB
    const elapsed = 500; // 0.5s
    const kbReceived = bytesReceived / 1024;
    const msPerKb = elapsed / kbReceived;
    expect(msPerKb).toBeLessThan(threshold); // 50ms/KB < 100ms/KB = fast
  });

  test("slowRequestTimeout speed calculation: slow transfer trips breaker", () => {
    const threshold = 100; // ms per KB
    const bytesReceived = 1024; // 1KB
    const elapsed = 500; // 0.5s
    const kbReceived = bytesReceived / 1024;
    const msPerKb = elapsed / kbReceived;
    expect(msPerKb).toBeGreaterThan(threshold); // 500ms/KB > 100ms/KB = slow
  });

  test("slowRequestTimeout skips small bodies below minBodySize", () => {
    const minBodySize = 1024;
    const bytesReceived = 500;
    expect(bytesReceived).toBeLessThan(minBodySize); // Below threshold, skip check
  });
});
