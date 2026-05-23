import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

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
        res.on("end", () => resolve({ status: res.statusCode, text: body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.static(publicDir));
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

describe("Accessibility — WCAG Compliance", () => {
  test("app.css defines focus-visible styles", () => {
    const css = fs.readFileSync(path.join(publicDir, "app.css"), "utf8");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("--focus-ring");
  });

  test("app.css defines .visually-hidden class", () => {
    const css = fs.readFileSync(path.join(publicDir, "app.css"), "utf8");
    expect(css).toContain(".visually-hidden");
    expect(css).toContain("position: absolute");
  });

  test("app.css defines .skip-link styles", () => {
    const css = fs.readFileSync(path.join(publicDir, "app.css"), "utf8");
    expect(css).toContain(".skip-link");
    expect(css).toContain(".skip-link:focus");
  });

  test("accessibility.js exists and exports helpers", async () => {
    const mod = await import("../public/accessibility.js");
    expect(typeof mod.trapFocus).toBe("function");
    expect(typeof mod.announce).toBe("function");
    expect(typeof mod.enhanceAccessibility).toBe("function");
  });

  test("bookmarks.html has skip-link", async () => {
    const res = await makeRequest(`${baseUrl}/bookmarks.html`);
    expect(res.text).toContain("skip-link");
    expect(res.text).toContain("#mainContent");
  });

  test("bookmarks.html has aria-label on search input", async () => {
    const res = await makeRequest(`${baseUrl}/bookmarks.html`);
    expect(res.text).toContain('aria-label="Search bookmarks"');
  });

  test("bookmarks.html has aria-label on filter selects", async () => {
    const res = await makeRequest(`${baseUrl}/bookmarks.html`);
    expect(res.text).toContain('aria-label="Filter by engine"');
    expect(res.text).toContain('aria-label="Filter by tag"');
  });

  test("bookmarks.html has aria-live on results area", async () => {
    const res = await makeRequest(`${baseUrl}/bookmarks.html`);
    expect(res.text).toContain('aria-live="polite"');
  });

  test("bookmarks.html has main landmark with id", async () => {
    const res = await makeRequest(`${baseUrl}/bookmarks.html`);
    expect(res.text).toContain('<main id="mainContent"');
  });

  test("dashboard.html has skip-link", async () => {
    const res = await makeRequest(`${baseUrl}/dashboard.html`);
    expect(res.text).toContain("skip-link");
    expect(res.text).toContain("#mainContent");
  });

  test("dashboard.html has main landmark", async () => {
    const res = await makeRequest(`${baseUrl}/dashboard.html`);
    expect(res.text).toContain('<main id="mainContent"');
  });

  test("HTML pages have lang attribute", async () => {
    const res = await makeRequest(`${baseUrl}/bookmarks.html`);
    expect(res.text).toMatch(/<html[^>]*lang="/);
  });
});

describe("Accessibility — Source Code Verification", () => {
  test("accessibility.js exports trapFocus function", () => {
    const src = fs.readFileSync(path.join(publicDir, "accessibility.js"), "utf8");
    expect(src).toContain("export function trapFocus");
    expect(src).toContain("focusable");
    expect(src).toContain("handleKeydown");
  });

  test("accessibility.js exports announce function", () => {
    const src = fs.readFileSync(path.join(publicDir, "accessibility.js"), "utf8");
    expect(src).toContain("export function announce");
    expect(src).toContain("aria-live");
    expect(src).toContain("sr-announcer");
  });

  test("accessibility.js exports enhanceAccessibility function", () => {
    const src = fs.readFileSync(path.join(publicDir, "accessibility.js"), "utf8");
    expect(src).toContain("export function enhanceAccessibility");
    expect(src).toContain("aria-label");
    expect(src).toContain("aria-current");
  });

  test("accessibility.js enhances nav elements", () => {
    const src = fs.readFileSync(path.join(publicDir, "accessibility.js"), "utf8");
    expect(src).toContain('querySelectorAll("nav")');
    expect(src).toContain("Main navigation");
  });

  test("accessibility.js enhances icon-only buttons", () => {
    const src = fs.readFileSync(path.join(publicDir, "accessibility.js"), "utf8");
    expect(src).toContain("aria-label");
    expect(src).toContain("svg, img, .icon");
  });
});
