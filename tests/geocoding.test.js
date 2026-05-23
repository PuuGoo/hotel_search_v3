import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import geocodingRoutes from "../routes/geocoding.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    if (req.headers["x-test-user"]) {
      req.session.isAuthenticated = true;
      req.session.user = { id: req.headers["x-test-user"], role: req.headers["x-test-role"] || "user" };
    }
    next();
  });
  app.use(geocodingRoutes);
  return app;
}

function makeRequest(app, path, options = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const req = http.request(
        {
          hostname: "localhost",
          port,
          path,
          method: options.method || "GET",
          headers: { ...options.headers },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            server.close();
            try {
              resolve({ status: res.statusCode, body: JSON.parse(body) });
            } catch {
              resolve({ status: res.statusCode, body });
            }
          });
        }
      );
      req.on("error", (err) => { server.close(); reject(err); });
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    });
  });
}

describe("Geocoding", () => {
  test("GET /api/geocode requires auth", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/geocode?q=Paris");
    expect(status).toBe(401);
  });

  test("GET /api/geocode requires q parameter", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/geocode", {
      headers: { "x-test-user": "user1" },
    });
    expect(status).toBe(400);
    expect(body.error).toContain("q");
  });

  test("POST /api/geocode/batch requires addresses array", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/geocode/batch", {
      method: "POST",
      headers: { "x-test-user": "user1", "content-type": "application/json" },
      body: {},
    });
    expect(status).toBe(400);
    expect(body.error).toContain("addresses");
  });

  test("POST /api/geocode/batch rejects more than 20 addresses", async () => {
    const app = createTestApp();
    const addresses = Array(21).fill("Paris");
    const { status, body } = await makeRequest(app, "/api/geocode/batch", {
      method: "POST",
      headers: { "x-test-user": "user1", "content-type": "application/json" },
      body: { addresses },
    });
    expect(status).toBe(400);
    expect(body.error).toContain("20");
  });

  test("POST /api/geocode/batch requires addresses to be array", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/geocode/batch", {
      method: "POST",
      headers: { "x-test-user": "user1", "content-type": "application/json" },
      body: { addresses: "not-array" },
    });
    expect(status).toBe(400);
  });

  test("POST /api/geocode/batch requires non-empty array", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/geocode/batch", {
      method: "POST",
      headers: { "x-test-user": "user1", "content-type": "application/json" },
      body: { addresses: [] },
    });
    expect(status).toBe(400);
  });

  test("GET /api/geocode/stats requires admin", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/geocode/stats", {
      headers: { "x-test-user": "user1", "x-test-role": "user" },
    });
    expect(status).toBe(403);
  });

  test("GET /api/geocode/stats returns stats for admin", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/geocode/stats", {
      headers: { "x-test-user": "admin1", "x-test-role": "admin" },
    });
    expect(status).toBe(200);
    expect(body).toHaveProperty("cacheSize");
    expect(body).toHaveProperty("maxCacheSize");
    expect(body).toHaveProperty("ttl");
  });
});
