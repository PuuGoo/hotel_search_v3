import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let server;
let baseUrl;

function makeRequest(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "GET",
      },
      (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, "..", "public")));
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

describe("Service Worker", () => {
  test("GET /sw.js returns service worker file", async () => {
    const res = await makeRequest(`${baseUrl}/sw.js`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
    expect(res.body).toContain("CACHE_NAME");
    expect(res.body).toContain("hotel-search-v1");
  });

  test("Service worker caches static assets", async () => {
    const res = await makeRequest(`${baseUrl}/sw.js`);
    expect(res.body).toContain("STATIC_ASSETS");
    expect(res.body).toContain("/bookmarks");
    expect(res.body).toContain("/app.css");
  });

  test("Service worker handles API cache", async () => {
    const res = await makeRequest(`${baseUrl}/sw.js`);
    expect(res.body).toContain("API_CACHE");
    expect(res.body).toContain("/api/bookmarks");
  });

  test("Service worker uses network-first for API", async () => {
    const res = await makeRequest(`${baseUrl}/sw.js`);
    expect(res.body).toContain("fetch(request)");
    expect(res.body).toContain("caches.match(request)");
  });

  test("Service worker clears old caches on activate", async () => {
    const res = await makeRequest(`${baseUrl}/sw.js`);
    expect(res.body).toContain("caches.delete");
  });

  test("Bookmarks page includes service worker registration", async () => {
    const res = await makeRequest(`${baseUrl}/bookmarks.html`);
    expect(res.body).toContain('navigator.serviceWorker.register("/sw.js")');
  });

  test("Bookmarks page includes offline indicator", async () => {
    const res = await makeRequest(`${baseUrl}/bookmarks.html`);
    expect(res.body).toContain("offlineBanner");
    expect(res.body).toContain("navigator.onLine");
  });
});
