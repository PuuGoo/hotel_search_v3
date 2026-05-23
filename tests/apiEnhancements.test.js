import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import session from "express-session";
import http from "http";
import { ResponseCache, responseCache, getCacheStats, clearCache } from "../middleware/responseCache.js";
import { signPayload, verifyWebhookSignature } from "../middleware/webhookSignature.js";
import { deprecated } from "../middleware/deprecation.js";

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
          resolve({ status: res.statusCode, headers: res.headers, json: () => Promise.resolve(JSON.parse(body)) })
        );
      }
    );
    req.on("error", reject);
    if (options.body) req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));

  // Response cache
  app.use("/api/cached", responseCache({ ttl: 5000 }));

  let callCount = 0;
  app.get("/api/cached/data", (_req, res) => {
    callCount++;
    res.json({ count: callCount });
  });

  // Deprecated endpoint
  app.get("/api/deprecated", deprecated({ message: "Use /api/v2/data", alternative: "/api/v2/data" }), (_req, res) => {
    res.json({ old: true });
  });

  // Webhook verification
  app.post("/api/webhook", (req, res) => {
    const secret = "test-secret";
    const valid = verifyWebhookSignature(req, secret);
    if (!valid) return res.status(401).json({ error: "Invalid signature" });
    res.json({ received: true });
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

describe("Response Cache", () => {
  test("first request is MISS", async () => {
    const res = await makeRequest(`${baseUrl}/api/cached/data`);
    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    const data = await res.json();
    expect(data.count).toBe(1);
  });

  test("second request is HIT", async () => {
    // First request
    await makeRequest(`${baseUrl}/api/cached/data`);
    // Second request should be cached
    const res = await makeRequest(`${baseUrl}/api/cached/data`);
    expect(res.headers["x-cache"]).toBe("HIT");
    const data = await res.json();
    expect(data.count).toBe(1); // Same count as first
  });

  test("cache stats work", () => {
    const cache = new ResponseCache({ maxSize: 5 });
    expect(cache.stats().size).toBe(0);
    expect(cache.stats().maxSize).toBe(5);
  });

  test("cache clear works", () => {
    const cache = new ResponseCache();
    cache.set({ originalUrl: "/test" }, 200, { ok: true });
    expect(cache.stats().size).toBe(1);
    cache.clear();
    expect(cache.stats().size).toBe(0);
  });

  test("cache clear empties all entries", () => {
    const cache = new ResponseCache({ maxSize: 50 });
    cache.set({ method: "GET", originalUrl: "/a", session: {} }, 200, {}, {});
    cache.set({ method: "GET", originalUrl: "/b", session: {} }, 200, {}, {});
    cache.set({ method: "GET", originalUrl: "/c", session: {} }, 200, {}, {});
    expect(cache.stats().size).toBe(3);
    cache.clear();
    expect(cache.stats().size).toBe(0);
  });
});

describe("Webhook Signature", () => {
  test("signPayload generates consistent signature", () => {
    const sig1 = signPayload({ event: "test" }, "secret");
    const sig2 = signPayload({ event: "test" }, "secret");
    expect(sig1).toBe(sig2);
  });

  test("signPayload with string payload", () => {
    const sig = signPayload("raw body", "secret");
    expect(sig).toHaveLength(64); // SHA256 hex
  });

  test("different secrets produce different signatures", () => {
    const sig1 = signPayload({ event: "test" }, "secret1");
    const sig2 = signPayload({ event: "test" }, "secret2");
    expect(sig1).not.toBe(sig2);
  });

  test("webhook verification succeeds with correct signature", async () => {
    const payload = { event: "test" };
    const signature = signPayload(payload, "test-secret");
    const res = await makeRequest(`${baseUrl}/api/webhook`, {
      method: "POST",
      headers: { "x-webhook-signature": signature, "Content-Type": "application/json" },
      body: payload,
    });
    expect(res.status).toBe(200);
  });

  test("webhook verification fails with wrong signature", async () => {
    const res = await makeRequest(`${baseUrl}/api/webhook`, {
      method: "POST",
      headers: { "x-webhook-signature": "wrong", "Content-Type": "application/json" },
      body: { event: "test" },
    });
    expect(res.status).toBe(401);
  });

  test("webhook verification fails without signature", async () => {
    const res = await makeRequest(`${baseUrl}/api/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { event: "test" },
    });
    expect(res.status).toBe(401);
  });
});

describe("Deprecation Warnings", () => {
  test("deprecated endpoint returns Sunset header", async () => {
    const res = await makeRequest(`${baseUrl}/api/deprecated`);
    expect(res.status).toBe(200);
    expect(res.headers["sunset"]).toBeDefined();
  });

  test("deprecated endpoint returns Warning header", async () => {
    const res = await makeRequest(`${baseUrl}/api/deprecated`);
    expect(res.headers["warning"]).toBeDefined();
    expect(res.headers["warning"]).toContain("Use /api/v2/data");
  });

  test("deprecated endpoint returns Link with alternative", async () => {
    const res = await makeRequest(`${baseUrl}/api/deprecated`);
    expect(res.headers["link"]).toBeDefined();
    expect(res.headers["link"]).toContain("/api/v2/data");
  });
});
