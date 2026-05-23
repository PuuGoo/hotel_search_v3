import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import crypto from "crypto";
import http from "http";

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
    req.end();
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());

  // Request ID middleware
  app.use((req, res, next) => {
    const id = req.headers["x-request-id"] || crypto.randomUUID();
    req.requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
  });

  app.get("/api/test", (_req, res) => {
    res.json({ ok: true });
  });

  // 404 handler with requestId in body
  app.use((req, res) => {
    if (req.accepts("html")) {
      return res.status(404).send("<h1>Not Found</h1>");
    }
    res.status(404).json({ error: "Not found", requestId: req.requestId });
  });

  // Error handler with requestId in body
  app.use((err, req, res, _next) => {
    console.error("Unhandled error:", err);
    if (req.accepts("html")) {
      return res.status(500).send("<h1>Server Error</h1>");
    }
    res.status(500).json({ error: "Internal server error", requestId: req.requestId });
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

describe("Request ID in Error Responses", () => {
  test("404 JSON response includes requestId", async () => {
    const res = await makeRequest(`${baseUrl}/api/nonexistent`, {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
    expect(data.requestId).toBeDefined();
    expect(typeof data.requestId).toBe("string");
    expect(data.requestId.length).toBeGreaterThan(0);
  });

  test("404 response includes X-Request-Id header", async () => {
    const res = await makeRequest(`${baseUrl}/api/nonexistent`, {
      headers: { Accept: "application/json" },
    });
    expect(res.headers["x-request-id"]).toBeDefined();
    const data = await res.json();
    expect(res.headers["x-request-id"]).toBe(data.requestId);
  });

  test("client-provided X-Request-Id is preserved in error response", async () => {
    const customId = "test-req-12345";
    const res = await makeRequest(`${baseUrl}/api/nonexistent`, {
      headers: { Accept: "application/json", "X-Request-Id": customId },
    });
    const data = await res.json();
    expect(data.requestId).toBe(customId);
    expect(res.headers["x-request-id"]).toBe(customId);
  });

  test("successful responses also have X-Request-Id header", async () => {
    const res = await makeRequest(`${baseUrl}/api/test`);
    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBeDefined();
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  test("each request gets a unique requestId when none provided", async () => {
    const res1 = await makeRequest(`${baseUrl}/api/nonexistent`, {
      headers: { Accept: "application/json" },
    });
    const res2 = await makeRequest(`${baseUrl}/api/nonexistent`, {
      headers: { Accept: "application/json" },
    });
    const data1 = await res1.json();
    const data2 = await res2.json();
    expect(data1.requestId).not.toBe(data2.requestId);
  });
});
