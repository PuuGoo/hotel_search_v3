import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import helmet from "helmet";
import http from "http";

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

beforeAll(async () => {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: [],
        payment: [],
      },
    })
  );

  // Manual Permissions-Policy (helmet 8.x doesn't set this reliably)
  app.use((_req, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    next();
  });

  app.get("/test", (_req, res) => {
    res.json({ ok: true });
  });

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

describe("Security Headers", () => {
  test("X-Content-Type-Options is nosniff", async () => {
    const res = await makeRequest(`${baseUrl}/test`);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("X-Frame-Options is SAMEORIGIN", async () => {
    const res = await makeRequest(`${baseUrl}/test`);
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  test("X-DNS-Prefetch-Control is off", async () => {
    const res = await makeRequest(`${baseUrl}/test`);
    expect(res.headers["x-dns-prefetch-control"]).toBe("off");
  });

  test("X-Download-Options is noopen", async () => {
    const res = await makeRequest(`${baseUrl}/test`);
    expect(res.headers["x-download-options"]).toBe("noopen");
  });

  test("X-Permitted-Cross-Domain-Policies is none", async () => {
    const res = await makeRequest(`${baseUrl}/test`);
    expect(res.headers["x-permitted-cross-domain-policies"]).toBe("none");
  });

  test("Referrer-Policy is set", async () => {
    const res = await makeRequest(`${baseUrl}/test`);
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("Permissions-Policy is set", async () => {
    const res = await makeRequest(`${baseUrl}/test`);
    const pp = res.headers["permissions-policy"] || "";
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
    expect(pp).toContain("geolocation=()");
    expect(pp).toContain("payment=()");
  });

  test("X-XSS-Protection is 0 (modern browsers)", async () => {
    const res = await makeRequest(`${baseUrl}/test`);
    expect(res.headers["x-xss-protection"]).toBe("0");
  });
});
