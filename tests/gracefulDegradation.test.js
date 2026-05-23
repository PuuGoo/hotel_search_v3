import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { gracefulDegradation, freshDataHeader } from "../middleware/gracefulDegradation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, "..", "result_cache.json");

let server;
let baseUrl;

function makeRequest(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search },
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
  app.use(express.json());

  // Endpoint that always throws — should fall back to cache
  app.get("/api/search/failing", gracefulDegradation(async (req, res) => {
    throw new Error("External API unavailable");
  }));

  // Endpoint that succeeds — should not use cache
  app.get("/api/search/working", gracefulDegradation(async (req, res) => {
    res.json({ results: [{ title: "Fresh result" }], stale: false });
  }));

  // Endpoint with freshDataHeader
  app.get("/api/search/fresh", freshDataHeader, (req, res) => {
    res.json({ results: [{ title: "Fresh" }] });
  });

  // Error handler
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: err.message });
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

afterEach(() => {
  // Clean up cache file
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch {}
});

afterAll((done) => {
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch {}
  server.close(done);
});

describe("Graceful Degradation", () => {
  test("successful handler returns normal response", async () => {
    const res = await makeRequest(`${baseUrl}/api/search/working`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.stale).toBe(false);
    expect(data.results[0].title).toBe("Fresh result");
  });

  test("failing handler without cache returns 500", async () => {
    const res = await makeRequest(`${baseUrl}/api/search/failing?q=hotels`);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  test("failing handler with cache serves stale results", async () => {
    // Pre-populate cache
    const cacheData = {};
    const crypto = await import("crypto");
    const key = crypto.createHash("md5").update("hotels|tavily").digest("hex");
    cacheData[key] = {
      query: "hotels",
      engine: "tavily",
      results: [{ title: "Cached hotel" }],
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData));

    const res = await makeRequest(`${baseUrl}/api/search/failing?q=hotels`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.stale).toBe(true);
    expect(data.results[0].title).toBe("Cached hotel");
    expect(data.error).toContain("cached results");
  });

  test("failing handler with expired cache returns 500", async () => {
    // Pre-populate with old cache (25 hours ago)
    const cacheData = {};
    const crypto = await import("crypto");
    const key = crypto.createHash("md5").update("old-query|tavily").digest("hex");
    cacheData[key] = {
      query: "old-query",
      engine: "tavily",
      results: [{ title: "Very old" }],
      timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData));

    const res = await makeRequest(`${baseUrl}/api/search/failing?q=old-query`);
    expect(res.status).toBe(500);
  });

  test("freshDataHeader sets X-Data-Freshness header", async () => {
    const res = await makeRequest(`${baseUrl}/api/search/fresh`);
    expect(res.status).toBe(200);
    expect(res.headers["x-data-freshness"]).toBe("fresh");
  });
});
