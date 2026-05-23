import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import emailRoutes from "../routes/emailNotifications.js";
import { getEmailConfig, setEmailConfig, sendEmail, sendTestEmail } from "../utils/email.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, "..", "email_config.json");

let configBackup;

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
  app.use(emailRoutes);
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

describe("Email Notifications", () => {
  beforeEach(() => {
    try { configBackup = fs.readFileSync(CONFIG_FILE, "utf8"); } catch { configBackup = null; }
    // Reset to console transport
    setEmailConfig({ transport: "console", settings: {} });
  });

  afterEach(() => {
    if (configBackup) {
      fs.writeFileSync(CONFIG_FILE, configBackup);
    } else {
      try { fs.unlinkSync(CONFIG_FILE); } catch { /* ignore */ }
    }
  });

  describe("Email utility", () => {
    test("sendEmail with console transport succeeds", async () => {
      const result = await sendEmail({ to: "test@example.com", subject: "Test", body: "Hello" });
      expect(result.success).toBe(true);
      expect(result.transport).toBe("console");
      expect(result.messageId).toBeDefined();
    });

    test("sendEmail requires to and subject", async () => {
      await expect(sendEmail({ subject: "Test" })).rejects.toThrow("to and subject");
      await expect(sendEmail({ to: "test@example.com" })).rejects.toThrow("subject");
    });

    test("sendTestEmail sends successfully", async () => {
      const result = await sendTestEmail("test@example.com");
      expect(result.success).toBe(true);
    });

    test("getEmailConfig returns config object", () => {
      const config = getEmailConfig();
      expect(config).toHaveProperty("transport");
    });

    test("setEmailConfig updates config", () => {
      setEmailConfig({ transport: "smtp", settings: { host: "smtp.example.com" } });
      const config = getEmailConfig();
      expect(config.transport).toBe("smtp");
      expect(config.settings.host).toBe("smtp.example.com");
    });

    test("SMTP transport requires host", async () => {
      setEmailConfig({ transport: "smtp", settings: {} });
      await expect(sendEmail({ to: "test@example.com", subject: "Test", body: "Hello" }))
        .rejects.toThrow("host");
    });

    test("webhook transport requires URL", async () => {
      setEmailConfig({ transport: "webhook", settings: {} });
      await expect(sendEmail({ to: "test@example.com", subject: "Test", body: "Hello" }))
        .rejects.toThrow("URL");
    });
  });

  describe("API routes", () => {
    test("GET /api/email/config requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/email/config");
      expect(status).toBe(401);
    });

    test("GET /api/email/config requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/email/config", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/email/config returns config for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/email/config", {
        headers: { "x-test-user": "admin1", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("transport");
    });

    test("PUT /api/email/config requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/email/config", {
        method: "PUT",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { transport: "console" },
      });
      expect(status).toBe(403);
    });

    test("PUT /api/email/config validates transport", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/email/config", {
        method: "PUT",
        headers: { "x-test-user": "admin1", "x-test-role": "admin", "content-type": "application/json" },
        body: { transport: "invalid" },
      });
      expect(status).toBe(400);
      expect(body.error).toContain("transport");
    });

    test("PUT /api/email/config updates config", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/email/config", {
        method: "PUT",
        headers: { "x-test-user": "admin1", "x-test-role": "admin", "content-type": "application/json" },
        body: { transport: "console" },
      });
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    test("POST /api/email/test requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/email/test", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { to: "test@example.com" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/email/test requires to", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/email/test", {
        method: "POST",
        headers: { "x-test-user": "admin1", "x-test-role": "admin", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
      expect(body.error).toContain("to");
    });

    test("POST /api/email/test sends test email", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/email/test", {
        method: "POST",
        headers: { "x-test-user": "admin1", "x-test-role": "admin", "content-type": "application/json" },
        body: { to: "test@example.com" },
      });
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.result.transport).toBe("console");
    });

    test("POST /api/email/send requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/email/send", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { to: "test@example.com", subject: "Test", body: "Hello" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/email/send requires all fields", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/email/send", {
        method: "POST",
        headers: { "x-test-user": "admin1", "x-test-role": "admin", "content-type": "application/json" },
        body: { to: "test@example.com" },
      });
      expect(status).toBe(400);
    });

    test("POST /api/email/send sends email", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/email/send", {
        method: "POST",
        headers: { "x-test-user": "admin1", "x-test-role": "admin", "content-type": "application/json" },
        body: { to: "test@example.com", subject: "Test", body: "Hello" },
      });
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    test("POST /api/email/notify-price-alert sends alert", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/email/notify-price-alert", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {
          alert: { hotelName: "Hilton", targetPrice: 150, currentPrice: 120 },
          priceChange: -30,
          userEmail: "user@example.com",
        },
      });
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    test("POST /api/email/notify-price-alert requires fields", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/email/notify-price-alert", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/email/notify-scheduled-search sends results", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/email/notify-scheduled-search", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {
          search: { query: "hotel paris", engine: "tavily" },
          results: [{ title: "Hotel Paris", url: "https://example.com" }],
          userEmail: "user@example.com",
        },
      });
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    test("POST /api/email/notify-scheduled-search requires fields", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/email/notify-scheduled-search", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("GET /api/email/config masks password", async () => {
      setEmailConfig({ transport: "smtp", settings: { host: "smtp.example.com", pass: "secret123" } });
      const app = createTestApp();
      const { body } = await makeRequest(app, "/api/email/config", {
        headers: { "x-test-user": "admin1", "x-test-role": "admin" },
      });
      expect(body.settings.pass).toBe("***");
    });
  });
});
