import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import compression from "compression";
import http from "http";
import zlib from "zlib";

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
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
            text: () => body.toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function createTestApp() {
  const app = express();

  app.use(compression({
    threshold: 256,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
  }));

  // Small response (below threshold — should NOT be compressed)
  app.get("/small", (_req, res) => {
    res.json({ ok: true });
  });

  // Large response (above threshold — should be compressed)
  app.get("/large", (_req, res) => {
    const data = { items: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}`, description: "A".repeat(50) })) };
    res.json(data);
  });

  // HTML endpoint
  app.get("/html", (_req, res) => {
    const html = "<html><body>" + "A".repeat(500) + "</body></html>";
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });

  // Endpoint respecting x-no-compression
  app.get("/nocomp", (_req, res) => {
    const data = { items: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}` })) };
    res.json(data);
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

describe("Response Compression", () => {
  test("Large JSON response is gzip compressed", async () => {
    const res = await makeRequest(`${baseUrl}/large`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");

    // Verify we can decompress it
    const decompressed = zlib.gunzipSync(res.body);
    const data = JSON.parse(decompressed.toString("utf8"));
    expect(data.items).toHaveLength(100);
  });

  test("Small response is not compressed (below threshold)", async () => {
    const res = await makeRequest(`${baseUrl}/small`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(res.status).toBe(200);
    // Small responses below 256 bytes should not be compressed
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  test("HTML response is compressed", async () => {
    const res = await makeRequest(`${baseUrl}/html`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");

    const decompressed = zlib.gunzipSync(res.body);
    expect(decompressed.toString("utf8")).toContain("<html>");
  });

  test("x-no-compression header disables compression", async () => {
    const res = await makeRequest(`${baseUrl}/nocomp`, {
      headers: { "Accept-Encoding": "gzip", "x-no-compression": "1" },
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  test("Response without Accept-Encoding is not compressed", async () => {
    const res = await makeRequest(`${baseUrl}/large`);
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    // Should still return valid JSON
    const data = JSON.parse(res.text());
    expect(data.items).toHaveLength(100);
  });

  test("Compressed response is smaller than uncompressed", async () => {
    const compressed = await makeRequest(`${baseUrl}/large`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    const uncompressed = await makeRequest(`${baseUrl}/large`);
    expect(compressed.body.length).toBeLessThan(uncompressed.body.length);
  });
});
