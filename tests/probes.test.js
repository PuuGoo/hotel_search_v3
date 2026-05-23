import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import http from "http";
import {
  livenessProbe,
  readinessProbe,
  startupProbe,
  markReady,
  registerCheck,
} from "../middleware/probes.js";

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

  app.get("/healthz", livenessProbe);
  app.get("/readyz", readinessProbe);
  app.get("/startupz", startupProbe);

  return app;
}

beforeAll(async () => {
  const app = createTestApp();
  markReady();
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

describe("Health Probes", () => {
  test("liveness probe always returns 200", async () => {
    const res = await makeRequest(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("alive");
    expect(data.uptime).toBeDefined();
    expect(data.timestamp).toBeDefined();
  });

  test("readiness probe returns 200 when ready", async () => {
    const res = await makeRequest(`${baseUrl}/readyz`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ready");
    expect(data.checks).toBeDefined();
    expect(data.startupTime).toBeDefined();
  });

  test("readiness probe includes memory check", async () => {
    const res = await makeRequest(`${baseUrl}/readyz`);
    const data = await res.json();
    expect(data.checks.memory).toBeDefined();
    expect(data.checks.memory.status).toBe("ok");
  });

  test("readiness probe includes event loop check", async () => {
    const res = await makeRequest(`${baseUrl}/readyz`);
    const data = await res.json();
    expect(data.checks.event_loop).toBeDefined();
    expect(data.checks.event_loop.status).toBe("ok");
    expect(data.checks.event_loop.lagMs).toBeLessThan(100);
  });

  test("startup probe returns 200 when started", async () => {
    const res = await makeRequest(`${baseUrl}/startupz`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("started");
  });

  test("readiness probe fails when check fails", async () => {
    // Register a failing check on a separate server
    const app2 = express();
    markReady();
    registerCheck("failing", () => ({ status: "fail", detail: "test failure" }));
    app2.get("/readyz", readinessProbe);

    const server2 = await new Promise((resolve) => {
      const s = app2.listen(0, () => resolve(s));
    });
    const base2 = `http://localhost:${server2.address().port}`;

    const res = await makeRequest(`${base2}/readyz`);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.status).toBe("not_ready");

    server2.close();
  });
});
