import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import http from "http";
import { apiVersion, getApiVersion } from "../middleware/apiVersion.js";

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
          resolve({ status: res.statusCode, json: () => Promise.resolve(JSON.parse(body)) })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(apiVersion);

  app.get("/api/test", (req, res) => {
    res.json({ path: req.url, version: getApiVersion(req) });
  });

  app.get("/api/users", (req, res) => {
    res.json({ path: req.url, version: getApiVersion(req) });
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

describe("API Versioning", () => {
  test("/api/test works without version prefix", async () => {
    const res = await makeRequest(`${baseUrl}/api/test`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.path).toBe("/api/test");
    expect(data.version).toBe("v1");
  });

  test("/api/v1/test works with version prefix", async () => {
    const res = await makeRequest(`${baseUrl}/api/v1/test`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.path).toBe("/api/test");
    expect(data.version).toBe("v1");
  });

  test("/api/v1/users rewrites to /api/users", async () => {
    const res = await makeRequest(`${baseUrl}/api/v1/users`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.path).toBe("/api/users");
    expect(data.version).toBe("v1");
  });

  test("unsupported version falls through", async () => {
    const res = await makeRequest(`${baseUrl}/api/v2/test`);
    // v2 is not supported, path stays as /api/v2/test which has no handler
    expect(res.status).toBe(404);
  });

  test("getApiVersion returns default for non-api paths", () => {
    const req = { path: "/dashboard", apiVersion: undefined };
    expect(getApiVersion(req)).toBe("v1");
  });

  test("getApiVersion returns set version", () => {
    const req = { apiVersion: "v1" };
    expect(getApiVersion(req)).toBe("v1");
  });
});
