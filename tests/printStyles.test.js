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

describe("Print-Friendly Styles", () => {
  test("app.css contains @media print block", async () => {
    const res = await makeRequest(`${baseUrl}/app.css`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("@media print");
  });

  test("Print styles hide .no-print elements", async () => {
    const res = await makeRequest(`${baseUrl}/app.css`);
    expect(res.body).toContain(".no-print");
    expect(res.body).toContain("display: none !important");
  });

  test("Print styles set white background", async () => {
    const res = await makeRequest(`${baseUrl}/app.css`);
    expect(res.body).toContain("background: #fff !important");
  });

  test("Print styles hide navigation elements", async () => {
    const res = await makeRequest(`${baseUrl}/app.css`);
    expect(res.body).toContain(".app-header");
    expect(res.body).toContain("nav");
  });

  test("Print styles hide interactive elements", async () => {
    const res = await makeRequest(`${baseUrl}/app.css`);
    expect(res.body).toContain(".modal-overlay");
    expect(res.body).toContain(".toast-container");
  });

  test("Print styles include page break control", async () => {
    const res = await makeRequest(`${baseUrl}/app.css`);
    expect(res.body).toContain("break-inside: avoid");
  });

  test("Print styles show link URLs", async () => {
    const res = await makeRequest(`${baseUrl}/app.css`);
    expect(res.body).toContain("attr(href)");
  });

  test("Print styles configure page margins", async () => {
    const res = await makeRequest(`${baseUrl}/app.css`);
    expect(res.body).toContain("@page");
    expect(res.body).toContain("margin: 1.5cm");
  });

  test("Bookmarks page has print button", async () => {
    const res = await makeRequest(`${baseUrl}/bookmarks.html`);
    expect(res.body).toContain("printBtn");
    expect(res.body).toContain("fa-print");
  });

  test("Bookmarks page print button triggers window.print", async () => {
    const res = await makeRequest(`${baseUrl}/bookmarks.html`);
    expect(res.body).toContain("window.print()");
  });

  test("Search page has print button", async () => {
    const res = await makeRequest(`${baseUrl}/hotelSearchTavily.html`);
    expect(res.body).toContain("printResultsButton");
    expect(res.body).toContain("fa-print");
  });
});
