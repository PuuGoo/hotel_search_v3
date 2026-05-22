import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_USERS_FILE = path.join(__dirname, "..", "users.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
    })
  );

  // Login endpoint
  app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const users = JSON.parse(fs.readFileSync(TEST_USERS_FILE, "utf8"));
    const user = users.find((u) => u.username === username);
    if (user && (await bcrypt.compare(password, user.password))) {
      req.session.isAuthenticated = true;
      req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.displayName,
        features: user.features || [],
      };
      res.json({ success: true });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  // Auth middleware
  function checkAuthenticated(req, res, next) {
    if (req.session.isAuthenticated) return next();
    return res.redirect("/");
  }

  // Page routes (mimicking routes/pages.js)
  const publicDir = path.join(__dirname, "..", "public");

  app.get("/BRAVE_MASTER", checkAuthenticated, (_req, res) => {
    res.sendFile(path.join(publicDir, "hotelSearchMaster.html"));
  });

  app.get("/AZURE_CHILD", checkAuthenticated, (_req, res) => {
    res.sendFile(path.join(publicDir, "hotelSearchChild.html"));
  });

  app.get("/searchXNG", checkAuthenticated, (_req, res) => {
    res.sendFile(path.join(publicDir, "hotelSearchXNG.html"));
  });

  app.get("/roomXNG", checkAuthenticated, (_req, res) => {
    res.sendFile(path.join(publicDir, "hotelRoomXNG.html"));
  });

  app.get("/CRAWLBASE_MASTER", checkAuthenticated, (_req, res) => {
    res.sendFile(path.join(publicDir, "crawlbaseMaster.html"));
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

describe("Page Routes", () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE)) {
      originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");
    }

    const testUsers = [
      {
        id: 1,
        username: "admin",
        password: await bcrypt.hash("admin123", 10),
        displayName: "Admin",
        role: "admin",
        features: ["tavily", "ddg", "case12"],
        createdAt: new Date().toISOString(),
      },
    ];
    fs.writeFileSync(TEST_USERS_FILE, JSON.stringify(testUsers, null, 2), "utf8");

    const app = createTestApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });

    const res = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
      redirect: "manual",
    });
    adminCookie = res.headers.get("set-cookie");
  });

  afterAll((done) => {
    if (originalUsers !== undefined) {
      fs.writeFileSync(TEST_USERS_FILE, originalUsers, "utf8");
    }
    server.close(done);
  });

  describe("BRAVE_MASTER", () => {
    test("should serve page for authenticated user", async () => {
      const res = await fetch(`${baseUrl}/BRAVE_MASTER`, {
        headers: { Cookie: adminCookie },
        redirect: "manual",
      });
      expect(res.status).toBe(200);
    });

    test("should redirect unauthenticated user", async () => {
      const res = await fetch(`${baseUrl}/BRAVE_MASTER`, { redirect: "manual" });
      expect(res.status).toBe(302);
    });
  });

  describe("AZURE_CHILD", () => {
    test("should serve page for authenticated user", async () => {
      const res = await fetch(`${baseUrl}/AZURE_CHILD`, {
        headers: { Cookie: adminCookie },
        redirect: "manual",
      });
      expect(res.status).toBe(200);
    });

    test("should redirect unauthenticated user", async () => {
      const res = await fetch(`${baseUrl}/AZURE_CHILD`, { redirect: "manual" });
      expect(res.status).toBe(302);
    });
  });

  describe("searchXNG", () => {
    test("should serve page for authenticated user", async () => {
      const res = await fetch(`${baseUrl}/searchXNG`, {
        headers: { Cookie: adminCookie },
        redirect: "manual",
      });
      expect(res.status).toBe(200);
    });

    test("should redirect unauthenticated user", async () => {
      const res = await fetch(`${baseUrl}/searchXNG`, { redirect: "manual" });
      expect(res.status).toBe(302);
    });
  });

  describe("roomXNG", () => {
    test("should serve page for authenticated user", async () => {
      const res = await fetch(`${baseUrl}/roomXNG`, {
        headers: { Cookie: adminCookie },
        redirect: "manual",
      });
      expect(res.status).toBe(200);
    });

    test("should redirect unauthenticated user", async () => {
      const res = await fetch(`${baseUrl}/roomXNG`, { redirect: "manual" });
      expect(res.status).toBe(302);
    });
  });

  describe("CRAWLBASE_MASTER", () => {
    test("should serve page for authenticated user", async () => {
      const res = await fetch(`${baseUrl}/CRAWLBASE_MASTER`, {
        headers: { Cookie: adminCookie },
        redirect: "manual",
      });
      expect(res.status).toBe(200);
    });

    test("should redirect unauthenticated user", async () => {
      const res = await fetch(`${baseUrl}/CRAWLBASE_MASTER`, { redirect: "manual" });
      expect(res.status).toBe(302);
    });
  });

  describe("404 Handler", () => {
    test("should return 404 for unknown routes", async () => {
      const res = await fetch(`${baseUrl}/nonexistent`);
      expect(res.status).toBe(404);
    });
  });
});
