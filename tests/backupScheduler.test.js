import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import backupRoutes from "../routes/backupScheduler.js";
import {
  getBackupConfig,
  updateBackupConfig,
  createBackup,
  listBackups,
  deleteBackup,
  restoreBackup,
  getBackupStats,
} from "../utils/backupScheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const BACKUP_DIR = path.join(ROOT, "backups");
const CONFIG_FILE = path.join(ROOT, "backup_config.json");

let configBackup;
let testBackups = [];

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
  app.use(backupRoutes);
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

function cleanupTestBackups() {
  for (const name of testBackups) {
    try { deleteBackup(name); } catch {}
  }
  testBackups = [];
}

describe("Backup Scheduler", () => {
  beforeEach(() => {
    try { configBackup = fs.readFileSync(CONFIG_FILE, "utf8"); } catch { configBackup = null; }
  });

  afterEach(() => {
    cleanupTestBackups();
    if (configBackup) {
      try { fs.writeFileSync(CONFIG_FILE, configBackup); } catch {}
    } else {
      try { fs.unlinkSync(CONFIG_FILE); } catch {}
    }
  });

  describe("Utility functions", () => {
    test("getBackupConfig returns default config", () => {
      const config = getBackupConfig();
      expect(config).toHaveProperty("enabled");
      expect(config).toHaveProperty("maxBackups");
      expect(config).toHaveProperty("files");
      expect(config).toHaveProperty("intervalHours");
    });

    test("updateBackupConfig updates config", () => {
      const config = updateBackupConfig({ maxBackups: 5 });
      expect(config.maxBackups).toBe(5);
    });

    test("createBackup creates a backup", () => {
      const result = createBackup("test_backup_1");
      testBackups.push(result.name);
      expect(result.filesBacked).toBeGreaterThan(0);
      expect(result.name).toBe("test_backup_1");
    });

    test("listBackups lists backups", () => {
      createBackup("test_list_backup");
      testBackups.push("test_list_backup");
      const backups = listBackups();
      expect(backups.length).toBeGreaterThan(0);
      expect(backups[0]).toHaveProperty("name");
      expect(backups[0]).toHaveProperty("size");
    });

    test("deleteBackup deletes a backup", () => {
      createBackup("test_delete_backup");
      const result = deleteBackup("test_delete_backup");
      expect(result.deleted).toBe(true);
    });

    test("deleteBackup returns error for missing", () => {
      const result = deleteBackup("nonexistent_backup");
      expect(result.deleted).toBe(false);
    });

    test("restoreBackup restores from backup", () => {
      createBackup("test_restore_backup");
      testBackups.push("test_restore_backup");
      const result = restoreBackup("test_restore_backup");
      expect(result.success).toBe(true);
      expect(result.filesRestored).toBeGreaterThan(0);
    });

    test("restoreBackup returns error for missing", () => {
      const result = restoreBackup("nonexistent_backup");
      expect(result.success).toBe(false);
    });

    test("getBackupStats returns stats", () => {
      createBackup("test_stats_backup");
      testBackups.push("test_stats_backup");
      const stats = getBackupStats();
      expect(stats.totalBackups).toBeGreaterThan(0);
      expect(stats).toHaveProperty("totalSize");
    });
  });

  describe("API Routes", () => {
    test("GET /api/backup/config requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/backup/config", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/backup/config returns config for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/backup/config", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("enabled");
    });

    test("PUT /api/backup/config updates config", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/backup/config", {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { maxBackups: 5 },
      });
      expect(status).toBe(200);
      expect(body.maxBackups).toBe(5);
    });

    test("POST /api/backup/create requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/backup/create", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/backup/create creates backup", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/backup/create", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { name: "api_test_backup" },
      });
      expect(status).toBe(201);
      testBackups.push(body.name);
      expect(body.filesBacked).toBeGreaterThan(0);
    });

    test("GET /api/backup/list requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/backup/list", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/backup/list returns list", async () => {
      createBackup("list_test_backup");
      testBackups.push("list_test_backup");
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/backup/list", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.backups.length).toBeGreaterThan(0);
    });

    test("POST /api/backup/restore/:name requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/backup/restore/test", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/backup/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/backup/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/backup/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/backup/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalBackups");
    });
  });
});
