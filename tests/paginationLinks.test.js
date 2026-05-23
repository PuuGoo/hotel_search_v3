import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import http from "http";
import { paginate, paginationMiddleware } from "../middleware/pagination.js";

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
          resolve({
            status: res.statusCode,
            headers: res.headers,
            json: () => Promise.resolve(JSON.parse(body)),
          })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(paginationMiddleware);

  app.get("/api/items", (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const total = 95;

    const start = (page - 1) * limit;
    const items = Array.from({ length: Math.min(limit, total - start) }, (_, i) => ({
      id: start + i + 1,
    }));

    res.paginate({ data: items, total, page, limit });
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

describe("Pagination Links", () => {
  test("paginate returns correct metadata", () => {
    const result = paginate({
      page: 2,
      limit: 10,
      total: 95,
      baseUrl: "http://localhost/api/items",
    });

    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
    expect(result.total).toBe(95);
    expect(result.totalPages).toBe(10);
    expect(result.hasMore).toBe(true);
    expect(result.links.self).toContain("page=2");
    expect(result.links.first).toContain("page=1");
    expect(result.links.last).toContain("page=10");
    expect(result.links.prev).toContain("page=1");
    expect(result.links.next).toContain("page=3");
  });

  test("paginate first page has no prev link", () => {
    const result = paginate({
      page: 1,
      limit: 10,
      total: 50,
      baseUrl: "http://localhost/api/items",
    });

    expect(result.links.prev).toBeUndefined();
    expect(result.links.next).toContain("page=2");
  });

  test("paginate last page has no next link", () => {
    const result = paginate({
      page: 5,
      limit: 10,
      total: 50,
      baseUrl: "http://localhost/api/items",
    });

    expect(result.links.next).toBeUndefined();
    expect(result.links.prev).toContain("page=4");
  });

  test("paginate preserves extra query params", () => {
    const result = paginate({
      page: 1,
      limit: 10,
      total: 50,
      baseUrl: "http://localhost/api/items",
      query: { sort: "name", order: "asc" },
    });

    expect(result.links.self).toContain("sort=name");
    expect(result.links.self).toContain("order=asc");
  });

  test("API returns pagination in response body", async () => {
    const res = await makeRequest(`${baseUrl}/api/items?page=2&limit=10`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.length).toBe(10);
    expect(data.pagination.page).toBe(2);
    expect(data.pagination.totalPages).toBe(10);
    expect(data.pagination.hasMore).toBe(true);
    expect(data.pagination.links.next).toBeDefined();
    expect(data.pagination.links.prev).toBeDefined();
  });

  test("API returns Link header", async () => {
    const res = await makeRequest(`${baseUrl}/api/items?page=1&limit=10`);
    expect(res.headers["link"]).toBeDefined();
    expect(res.headers["link"]).toContain('rel="self"');
    expect(res.headers["link"]).toContain('rel="first"');
    expect(res.headers["link"]).toContain('rel="last"');
  });

  test("API returns X-Total-Count header", async () => {
    const res = await makeRequest(`${baseUrl}/api/items?page=1&limit=10`);
    expect(res.headers["x-total-count"]).toBe("95");
    expect(res.headers["x-page-count"]).toBe("10");
  });

  test("API first page Link header has no prev", async () => {
    const res = await makeRequest(`${baseUrl}/api/items?page=1&limit=10`);
    const link = res.headers["link"];
    expect(link).not.toContain('rel="prev"');
  });
});
