import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_USERS_FILE = path.join(__dirname, "..", "users.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: gdprRoutes } = await import("../routes/gdprExport.js");

function makeRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
            text: () => body.toString("utf8"),
            json: () => Promise.resolve(JSON.parse(body.toString("utf8"))),
          });
        });
      }
    );
    req.on("error", reject);
    if (options.body)
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: "test",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 86400000 },
  }));
  app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
    const user = users.find((u) => u.username === username);
    if (user && (await bcrypt.compare(password, user.password))) {
      req.session.isAuthenticated = true;
      req.session.user = { id: user.id, username: user.username, role: user.role, displayName: user.displayName, features: user.features || [] };
      res.json({ success: true });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });
  app.use(gdprRoutes);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

async function loginAs(username, password) {
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}/login`);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: "POST", headers: { "Content-Type": "application/json" },
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve(res.headers["set-cookie"]));
    });
    req.write(JSON.stringify({ username, password }));
    req.end();
  });
}

beforeAll(async () => {
  if (fs.existsSync(TEST_USERS_FILE))
    originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");

  const adminHash = await bcrypt.hash("Admin123!", 10);
  fs.writeFileSync(TEST_USERS_FILE, JSON.stringify([{
    id: 1, username: "admin", password: adminHash,
    displayName: "Admin", role: "admin", features: [], createdAt: new Date().toISOString(),
  }], null, 2));

  const app = createTestApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
  adminCookie = await loginAs("admin", "Admin123!");
});

afterAll((done) => {
  if (originalUsers !== undefined) fs.writeFileSync(TEST_USERS_FILE, originalUsers);
  server.close(done);
});

describe("Data Export Bundle", () => {
  test("GET /api/gdpr/export-bundle requires authentication", async () => {
    const res = await makeRequest(`${baseUrl}/api/gdpr/export-bundle`);
    expect(res.status).toBe(401);
  });

  test("GET /api/gdpr/export-bundle returns JSON bundle", async () => {
    const res = await makeRequest(`${baseUrl}/api/gdpr/export-bundle`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.manifest).toBeDefined();
    expect(data.manifest.version).toBe("1.0");
    expect(data.manifest.format).toBe("hotel-search-data-bundle");
    expect(data.manifest.exportDate).toBeDefined();
    expect(data.manifest.totalItems).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(data.manifest.sections)).toBe(true);
  });

  test("GET /api/gdpr/export-bundle includes user info", async () => {
    const res = await makeRequest(`${baseUrl}/api/gdpr/export-bundle`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.user.username).toBe("admin");
    expect(data.user.id).toBeDefined();
    expect(data.user.displayName).toBe("Admin");
    expect(data.user.role).toBe("admin");
  });

  test("GET /api/gdpr/export-bundle has sections with profile", async () => {
    const res = await makeRequest(`${baseUrl}/api/gdpr/export-bundle`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.sections.profile).toBeDefined();
    expect(data.sections.profile.data.username).toBe("admin");
    expect(data.sections.profile.count).toBe(1);
  });

  test("GET /api/gdpr/export-bundle sets Content-Disposition for download", async () => {
    const res = await makeRequest(`${baseUrl}/api/gdpr/export-bundle`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const disposition = res.headers["content-disposition"] || "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("data-bundle-");
    expect(disposition).toContain(".json");
  });

  test("GET /api/gdpr/export still works as JSON", async () => {
    const res = await makeRequest(`${baseUrl}/api/gdpr/export`, {
      headers: { Cookie: adminCookie },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.user.username).toBe("admin");
    expect(data.exportDate).toBeDefined();
  });
});
