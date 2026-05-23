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
          resolve({ status: res.statusCode, body })
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

describe("Quick Bookmark from Results", () => {
  test("Google search page has Actions column header", async () => {
    const res = await makeRequest(`${baseUrl}/hotelSearchGoogle.html`);
    expect(res.body).toContain("<th>Actions</th>");
  });

  test("Google search JS has bookmark button in result rows", async () => {
    const res = await makeRequest(`${baseUrl}/hotelSearchGoogle.js`);
    expect(res.body).toContain("btn-bookmark");
    expect(res.body).toContain("/api/bookmarks");
    expect(res.body).toContain('engine: "google"');
  });

  test("DDG search page has Actions column header", async () => {
    const res = await makeRequest(`${baseUrl}/hotelSearchXNG.html`);
    expect(res.body).toContain("<th>Actions</th>");
  });

  test("DDG search JS has bookmark button in result rows", async () => {
    const res = await makeRequest(`${baseUrl}/hotelSearchXNG.js`);
    expect(res.body).toContain("btn-bookmark");
    expect(res.body).toContain("/api/bookmarks");
    expect(res.body).toContain('engine: "ddg"');
  });

  test("Tavily search page already has bookmark functionality", async () => {
    const res = await makeRequest(`${baseUrl}/hotelSearchTavily.js`);
    expect(res.body).toContain('data-action="bookmark"');
    expect(res.body).toContain("/api/bookmarks");
  });

  test("Bookmark buttons use correct engine per page", async () => {
    const googleRes = await makeRequest(`${baseUrl}/hotelSearchGoogle.js`);
    const ddgRes = await makeRequest(`${baseUrl}/hotelSearchXNG.js`);
    const tavilyRes = await makeRequest(`${baseUrl}/hotelSearchTavily.js`);

    expect(googleRes.body).toContain('engine: "google"');
    expect(ddgRes.body).toContain('engine: "ddg"');
    expect(tavilyRes.body).toContain('engine: "tavily"');
  });

  test("Bookmark buttons disable after successful save", async () => {
    const googleRes = await makeRequest(`${baseUrl}/hotelSearchGoogle.js`);
    const ddgRes = await makeRequest(`${baseUrl}/hotelSearchXNG.js`);

    expect(googleRes.body).toContain('bookmarkBtn.disabled = true');
    expect(ddgRes.body).toContain('bookmarkBtn.disabled = true');
  });
});
