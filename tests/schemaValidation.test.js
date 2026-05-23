import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import http from "http";
import { validate, validateValue } from "../middleware/validate.js";

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
        method: options.method || "POST",
        headers: { "Content-Type": "application/json", ...options.headers },
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
    if (options.body !== undefined) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Test endpoint with body validation
  app.post("/api/bookmark", validate({
    body: {
      type: "object",
      required: ["title", "url", "engine"],
      properties: {
        title: { type: "string", minLength: 1, maxLength: 500 },
        url: { type: "string", minLength: 1, maxLength: 2000 },
        engine: { type: "string", enum: ["tavily", "google", "ddg"] },
        tags: { type: "array", maxItems: 10, items: { type: "string", maxLength: 50 } },
        rating: { type: "number", minimum: 0, maximum: 5 },
        active: { type: "boolean" },
      },
    },
  }), (req, res) => {
    res.json({ success: true, data: req.body });
  });

  // Test endpoint with query validation
  app.get("/api/search", validate({
    query: {
      type: "object",
      required: ["q"],
      properties: {
        q: { type: "string", minLength: 1, maxLength: 500 },
        page: { type: "number", integer: true, minimum: 1 },
        limit: { type: "number", integer: true, minimum: 1, maximum: 100 },
      },
    },
  }), (req, res) => {
    res.json({ success: true, query: req.query });
  });

  // Test endpoint with nested object validation
  app.post("/api/profile", validate({
    body: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
        address: {
          type: "object",
          properties: {
            city: { type: "string" },
            zip: { type: "string", pattern: "^\\d{5}$" },
          },
        },
      },
    },
  }), (req, res) => {
    res.json({ success: true });
  });

  // Test endpoint with no additional properties
  app.post("/api/strict", validate({
    body: {
      type: "object",
      required: ["name"],
      additionalProperties: false,
      properties: {
        name: { type: "string" },
      },
    },
  }), (req, res) => {
    res.json({ success: true });
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

describe("Schema Validation Middleware", () => {
  test("Valid request passes through", async () => {
    const res = await makeRequest(`${baseUrl}/api/bookmark`, {
      body: { title: "Hotel", url: "https://example.com", engine: "tavily" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("Missing required field returns 400", async () => {
    const res = await makeRequest(`${baseUrl}/api/bookmark`, {
      body: { title: "Hotel" },
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Validation failed");
    expect(data.details).toEqual(expect.arrayContaining([expect.stringContaining("url")]));
    expect(data.details).toEqual(expect.arrayContaining([expect.stringContaining("engine")]));
  });

  test("Invalid enum value returns 400", async () => {
    const res = await makeRequest(`${baseUrl}/api/bookmark`, {
      body: { title: "Hotel", url: "https://example.com", engine: "bing" },
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details[0]).toContain("engine");
    expect(data.details[0]).toContain("tavily");
  });

  test("String too long returns 400", async () => {
    const res = await makeRequest(`${baseUrl}/api/bookmark`, {
      body: { title: "x".repeat(501), url: "https://example.com", engine: "tavily" },
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details[0]).toContain("500");
  });

  test("Array maxItems validation", async () => {
    const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`);
    const res = await makeRequest(`${baseUrl}/api/bookmark`, {
      body: { title: "Hotel", url: "https://example.com", engine: "tavily", tags },
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details[0]).toContain("10");
  });

  test("Number validation works", async () => {
    const res = await makeRequest(`${baseUrl}/api/bookmark`, {
      body: { title: "Hotel", url: "https://example.com", engine: "tavily", rating: 6 },
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details[0]).toContain("5");
  });

  test("Boolean validation works", async () => {
    const res = await makeRequest(`${baseUrl}/api/bookmark`, {
      body: { title: "Hotel", url: "https://example.com", engine: "tavily", active: "yes" },
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details[0]).toContain("boolean");
  });

  test("Query validation works", async () => {
    const res = await makeRequest(`${baseUrl}/api/search`, { method: "GET" });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details[0]).toContain("q");
  });

  test("Valid query passes through", async () => {
    const res = await makeRequest(`${baseUrl}/api/search?q=hotel&page=1&limit=10`, { method: "GET" });
    expect(res.status).toBe(200);
  });

  test("Nested object validation works", async () => {
    const res = await makeRequest(`${baseUrl}/api/profile`, {
      body: { name: "John", address: { zip: "abc" } },
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details[0]).toContain("zip");
  });

  test("additionalProperties: false rejects extra fields", async () => {
    const res = await makeRequest(`${baseUrl}/api/strict`, {
      body: { name: "test", extra: "field" },
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details[0]).toContain("not allowed");
  });

  test("Valid nested object passes", async () => {
    const res = await makeRequest(`${baseUrl}/api/profile`, {
      body: { name: "John", address: { city: "Hanoi", zip: "10000" } },
    });
    expect(res.status).toBe(200);
  });
});

describe("validateValue utility", () => {
  test("Returns errors for missing required fields", () => {
    const result = validateValue({}, {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("name");
  });

  test("Returns empty errors for valid input", () => {
    const result = validateValue({ name: "test" }, {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string", minLength: 1 } },
    });
    expect(result.errors).toHaveLength(0);
  });

  test("Validates array items", () => {
    const result = validateValue(["ok", ""], {
      type: "array",
      items: { type: "string", minLength: 1 },
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("[1]");
  });

  test("Number integer validation", () => {
    const result = validateValue(3.5, { type: "number", integer: true });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("integer");
  });
});
