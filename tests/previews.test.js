import { describe, test, expect, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import previewRoutes from "../routes/previews.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    if (req.headers["x-test-user"]) {
      req.session.isAuthenticated = true;
      req.session.user = { id: req.headers["x-test-user"], role: "user" };
    }
    next();
  });
  app.use(previewRoutes);
  return app;
}

function makeRequest(app, urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const req = http.request(
        { hostname: "localhost", port, path: urlPath, method: options.method || "GET", headers: { ...options.headers } },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            server.close();
            try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
            catch { resolve({ status: res.statusCode, body }); }
          });
        }
      );
      req.on("error", (err) => { server.close(); reject(err); });
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    });
  });
}

describe("Previews", () => {
  test("GET /api/preview requires auth", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/preview?url=https://example.com");
    expect(status).toBe(401);
  });

  test("GET /api/preview requires url", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/preview", {
      headers: { "x-test-user": "user1" },
    });
    expect(status).toBe(400);
    expect(body.error).toContain("url");
  });

  test("GET /api/preview validates URL", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/preview?url=not-a-url", {
      headers: { "x-test-user": "user1" },
    });
    expect(status).toBe(400);
    expect(body.error).toContain("Invalid");
  });

  test("GET /api/preview rejects non-HTTP URLs", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/preview?url=ftp://example.com", {
      headers: { "x-test-user": "user1" },
    });
    expect(status).toBe(400);
    expect(body.error).toContain("HTTP");
  });

  test("POST /api/preview/batch requires urls array", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/preview/batch", {
      method: "POST",
      headers: { "x-test-user": "user1", "content-type": "application/json" },
      body: {},
    });
    expect(status).toBe(400);
    expect(body.error).toContain("urls");
  });

  test("POST /api/preview/batch rejects more than 5 URLs", async () => {
    const app = createTestApp();
    const { status, body } = await makeRequest(app, "/api/preview/batch", {
      method: "POST",
      headers: { "x-test-user": "user1", "content-type": "application/json" },
      body: { urls: Array(6).fill("https://example.com") },
    });
    expect(status).toBe(400);
    expect(body.error).toContain("5");
  });

  test("POST /api/preview/batch requires non-empty array", async () => {
    const app = createTestApp();
    const { status } = await makeRequest(app, "/api/preview/batch", {
      method: "POST",
      headers: { "x-test-user": "user1", "content-type": "application/json" },
      body: { urls: [] },
    });
    expect(status).toBe(400);
  });
});
