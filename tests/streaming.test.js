import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import http from "http";
import { streamJsonArray, streamNdjson } from "../middleware/streaming.js";
import { createAgents, getAgentStats } from "../middleware/connectionPool.js";

let server;
let baseUrl;

function makeRequest(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname },
      (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function createTestApp() {
  const app = express();

  app.get("/api/stream-array", (_req, res) => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    streamJsonArray(res, items, { page: 1, total: 100 });
  });

  app.get("/api/stream-ndjson", (_req, res) => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    streamNdjson(res, items);
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

describe("Response Streaming", () => {
  test("streamJsonArray returns valid JSON", async () => {
    const res = await makeRequest(`${baseUrl}/api/stream-array`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.text);
    expect(data.data.length).toBe(100);
    expect(data.count).toBe(100);
    expect(data.page).toBe(1);
    expect(data.total).toBe(100);
  });

  test("streamJsonArray sets correct headers", async () => {
    const res = await makeRequest(`${baseUrl}/api/stream-array`);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["transfer-encoding"]).toBe("chunked");
  });

  test("streamNdjson returns newline-delimited JSON", async () => {
    const res = await makeRequest(`${baseUrl}/api/stream-ndjson`);
    expect(res.status).toBe(200);
    const lines = res.text.trim().split("\n");
    expect(lines.length).toBe(50);
    for (const line of lines) {
      const obj = JSON.parse(line);
      expect(obj.id).toBeDefined();
      expect(obj.name).toBeDefined();
    }
  });

  test("streamNdjson sets correct content type", async () => {
    const res = await makeRequest(`${baseUrl}/api/stream-ndjson`);
    expect(res.headers["content-type"]).toContain("x-ndjson");
  });
});

describe("Connection Pooling", () => {
  test("createAgents returns http and https agents", () => {
    const agents = createAgents();
    expect(agents.httpAgent).toBeDefined();
    expect(agents.httpsAgent).toBeDefined();
  });

  test("createAgents accepts custom options", () => {
    const agents = createAgents({ maxSockets: 100, keepAlive: false });
    expect(agents.httpAgent).toBeDefined();
    expect(agents.httpsAgent).toBeDefined();
  });

  test("getAgentStats returns config info", () => {
    const stats = getAgentStats();
    expect(stats.http).toBeDefined();
    expect(stats.https).toBeDefined();
    expect(stats.http.maxSockets).toBe(50);
    expect(stats.http.keepAlive).toBe(true);
  });
});
