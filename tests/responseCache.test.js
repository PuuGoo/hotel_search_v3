import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import session from "express-session";
import http from "http";
import { responseCache, ResponseCache } from "../middleware/responseCache.js";

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
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

let requestCount = 0;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));

  // Simulate auth
  app.use((req, _res, next) => {
    if (req.headers["x-test-user"]) {
      req.session.user = { id: req.headers["x-test-user"], role: "user" };
    }
    next();
  });

  app.use(responseCache({ skipPaths: ["/api/skip"] }));

  app.get("/api/data", (_req, res) => {
    requestCount++;
    res.json({ count: requestCount, timestamp: Date.now() });
  });

  app.get("/api/skip", (_req, res) => {
    requestCount++;
    res.json({ count: requestCount });
  });

  app.get("/api/other", (_req, res) => {
    requestCount++;
    res.json({ count: requestCount });
  });

  app.post("/api/data", (_req, res) => {
    requestCount++;
    res.json({ count: requestCount });
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

describe("Response Cache Middleware", () => {
  test("first request is a cache miss", async () => {
    const res = await makeRequest(`${baseUrl}/api/data`);
    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    const data = await res.json();
    expect(data.count).toBeDefined();
  });

  test("second request is a cache hit", async () => {
    const res1 = await makeRequest(`${baseUrl}/api/other`);
    const data1 = await res1.json();

    const res2 = await makeRequest(`${baseUrl}/api/other`);
    expect(res2.headers["x-cache"]).toBe("HIT");
    const data2 = await res2.json();

    // Same response body from cache
    expect(data2.count).toBe(data1.count);
  });

  test("POST requests are not cached", async () => {
    const res1 = await makeRequest(`${baseUrl}/api/data`, { method: "POST", body: {} });
    const res2 = await makeRequest(`${baseUrl}/api/data`, { method: "POST", body: {} });
    // POST should not have X-Cache header
    expect(res1.headers["x-cache"]).toBeUndefined();
    expect(res2.headers["x-cache"]).toBeUndefined();
  });

  test("skipPaths bypass cache", async () => {
    const res1 = await makeRequest(`${baseUrl}/api/skip`);
    const data1 = await res1.json();
    const res2 = await makeRequest(`${baseUrl}/api/skip`);
    const data2 = await res2.json();
    // Should not be cached — different counts
    expect(res2.headers["x-cache"]).toBeUndefined();
    expect(data2.count).not.toBe(data1.count);
  });

  test("Cache-Control: no-cache bypasses cache", async () => {
    const res1 = await makeRequest(`${baseUrl}/api/data`);
    const data1 = await res1.json();

    const res2 = await makeRequest(`${baseUrl}/api/data`, {
      headers: { "Cache-Control": "no-cache" },
    });
    expect(res2.headers["x-cache"]).toBe("BYPASS");
    const data2 = await res2.json();
    expect(data2.count).not.toBe(data1.count);
  });

  test("different users get separate cache entries", async () => {
    const res1 = await makeRequest(`${baseUrl}/api/data`, {
      headers: { "x-test-user": "user1" },
    });
    const data1 = await res1.json();

    const res2 = await makeRequest(`${baseUrl}/api/data`, {
      headers: { "x-test-user": "user2" },
    });
    expect(res2.headers["x-cache"]).toBe("MISS");
    const data2 = await res2.json();
    expect(data2.count).not.toBe(data1.count);
  });

  test("cache hit includes X-Cache-Hits header", async () => {
    await makeRequest(`${baseUrl}/api/data`);
    const res = await makeRequest(`${baseUrl}/api/data`);
    expect(res.headers["x-cache"]).toBe("HIT");
    expect(res.headers["x-cache-hits"]).toBeDefined();
  });
});
