import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import express from "express";
import http from "http";
import { requestDedup, _inflight } from "../middleware/dedup.js";

let server;
let baseUrl;
let requestCount = 0;

function makeRequest(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search },
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
  app.use(requestDedup());

  // Slow endpoint
  app.get("/api/slow", async (_req, res) => {
    requestCount++;
    await new Promise((r) => setTimeout(r, 100));
    res.json({ count: requestCount });
  });

  // Fast endpoint
  app.get("/api/fast", (_req, res) => {
    requestCount++;
    res.json({ count: requestCount });
  });

  // POST endpoint (not deduplicated)
  app.post("/api/post", (_req, res) => {
    requestCount++;
    res.json({ count: requestCount });
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

beforeEach(() => {
  requestCount = 0;
  _inflight.clear();
});

afterAll((done) => {
  server.close(done);
});

describe("Request Deduplication", () => {
  test("sequential requests each hit the handler", async () => {
    const res1 = await makeRequest(`${baseUrl}/api/fast`);
    const data1 = await res1.json();
    expect(data1.count).toBe(1);

    const res2 = await makeRequest(`${baseUrl}/api/fast`);
    const data2 = await res2.json();
    expect(data2.count).toBe(2);
  });

  test("concurrent identical GET requests are deduplicated", async () => {
    const [res1, res2] = await Promise.all([
      makeRequest(`${baseUrl}/api/slow`),
      makeRequest(`${baseUrl}/api/slow`),
    ]);

    const data1 = await res1.json();
    const data2 = await res2.json();

    // Both get the same count (only 1 handler call)
    expect(data1.count).toBe(1);
    expect(data2.count).toBe(1);
    expect(requestCount).toBe(1);
  });

  test("inflight map is cleaned up after response", async () => {
    await makeRequest(`${baseUrl}/api/fast`);
    expect(_inflight.size).toBe(0);
  });

  test("requestDedup is a function", () => {
    expect(typeof requestDedup).toBe("function");
    const middleware = requestDedup();
    expect(typeof middleware).toBe("function");
  });

  test("requestDedup accepts custom options", () => {
    const middleware = requestDedup({ methods: ["GET", "POST"] });
    expect(typeof middleware).toBe("function");
  });
});
