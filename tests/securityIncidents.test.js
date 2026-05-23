import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import incidentRoutes from "../routes/securityIncidents.js";
import {
  createIncident,
  getIncidents,
  getIncident,
  updateIncident,
  deleteIncident,
  addComment,
  getIncidentTimeline,
  getIncidentStats,
  clearIncidentData,
} from "../utils/securityIncidents.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "security_incidents.json");

let dataBackup;

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
  app.use(incidentRoutes);
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

function saveWithRetry(filePath, data) {
  let retries = 5;
  while (retries-- > 0) {
    try { fs.writeFileSync(filePath, data); return; }
    catch (e) { if (e.code === "EBUSY") { /* retry */ } else throw e; }
  }
}

describe("Security Incident Tracker", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearIncidentData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("createIncident creates an incident", () => {
      const incident = createIncident({
        title: "Unauthorized access attempt",
        severity: "high",
        category: "unauthorized_access",
        userId: "admin",
      });
      expect(incident).toHaveProperty("id");
      expect(incident.title).toBe("Unauthorized access attempt");
      expect(incident.severity).toBe("high");
      expect(incident.status).toBe("open");
    });

    test("getIncidents returns incidents", () => {
      createIncident({ title: "i1" });
      createIncident({ title: "i2" });
      const result = getIncidents();
      expect(result.total).toBe(2);
    });

    test("getIncidents filters by severity", () => {
      createIncident({ title: "i1", severity: "high" });
      createIncident({ title: "i2", severity: "low" });
      const result = getIncidents({ severity: "high" });
      expect(result.total).toBe(1);
    });

    test("getIncidents filters by status", () => {
      createIncident({ title: "i1", status: "open" });
      createIncident({ title: "i2", status: "resolved" });
      const result = getIncidents({ status: "open" });
      expect(result.total).toBe(1);
    });

    test("getIncidents filters by category", () => {
      createIncident({ title: "i1", category: "ddos" });
      createIncident({ title: "i2", category: "malware" });
      const result = getIncidents({ category: "ddos" });
      expect(result.total).toBe(1);
    });

    test("getIncident returns specific incident", () => {
      const created = createIncident({ title: "test" });
      const found = getIncident(created.id);
      expect(found.title).toBe("test");
    });

    test("getIncident returns null for unknown", () => {
      expect(getIncident("unknown")).toBeNull();
    });

    test("updateIncident updates an incident", () => {
      const created = createIncident({ title: "old" });
      const updated = updateIncident(created.id, { title: "new", status: "investigating" }, "admin");
      expect(updated.title).toBe("new");
      expect(updated.status).toBe("investigating");
    });

    test("updateIncident tracks resolved timestamp", () => {
      const created = createIncident({ title: "test" });
      const updated = updateIncident(created.id, { status: "resolved" }, "admin");
      expect(updated.resolvedAt).toBeDefined();
    });

    test("updateIncident returns null for unknown", () => {
      expect(updateIncident("unknown", {})).toBeNull();
    });

    test("deleteIncident deletes an incident", () => {
      const created = createIncident({ title: "test" });
      expect(deleteIncident(created.id)).toBe(true);
      expect(getIncident(created.id)).toBeNull();
    });

    test("deleteIncident returns false for unknown", () => {
      expect(deleteIncident("unknown")).toBe(false);
    });

    test("addComment adds a comment", () => {
      const incident = createIncident({ title: "test" });
      const updated = addComment(incident.id, "Investigating the issue", "admin");
      expect(updated).toBeDefined();
    });

    test("addComment returns null for unknown", () => {
      expect(addComment("unknown", "test")).toBeNull();
    });

    test("getIncidentTimeline returns timeline", () => {
      const incident = createIncident({ title: "test" });
      const timeline = getIncidentTimeline(incident.id);
      expect(timeline.count).toBe(1); // created entry
    });

    test("getIncidentStats returns stats", () => {
      createIncident({ title: "i1", severity: "high", status: "open" });
      createIncident({ title: "i2", severity: "low", status: "resolved" });
      const stats = getIncidentStats();
      expect(stats.total).toBe(2);
      expect(stats.severityCounts.high).toBe(1);
      expect(stats.open).toBe(1);
    });

    test("clearIncidentData clears all data", () => {
      createIncident({ title: "test" });
      clearIncidentData();
      expect(getIncidents().total).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/incidents requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/incidents", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { title: "test" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/incidents creates incident for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/incidents", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { title: "DDoS Attack", severity: "critical" },
      });
      expect(status).toBe(201);
      expect(body.title).toBe("DDoS Attack");
    });

    test("GET /api/incidents returns incidents for admin", async () => {
      createIncident({ title: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/incidents", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("GET /api/incidents/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/incidents/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
    });

    test("DELETE /api/incidents/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/incidents/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/incidents/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/incidents/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });

    test("GET /api/incidents/:id returns incident for admin", async () => {
      const created = createIncident({ title: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/incidents/${created.id}`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.title).toBe("test");
    });

    test("GET /api/incidents/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/incidents/unknown", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("PUT /api/incidents/:id updates for admin", async () => {
      const created = createIncident({ title: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/incidents/${created.id}`, {
        method: "PUT",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { status: "investigating" },
      });
      expect(status).toBe(200);
      expect(body.status).toBe("investigating");
    });

    test("DELETE /api/incidents/:id deletes for admin", async () => {
      const created = createIncident({ title: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/incidents/${created.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("deleted");
    });

    test("DELETE /api/incidents/:id returns 404 for unknown", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/incidents/unknown", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });

    test("POST /api/incidents/:id/comments adds comment for admin", async () => {
      const created = createIncident({ title: "test" });
      const app = createTestApp();
      const { status } = await makeRequest(app, `/api/incidents/${created.id}/comments`, {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { comment: "Investigating" },
      });
      expect(status).toBe(200);
    });

    test("GET /api/incidents/:id/timeline returns timeline for admin", async () => {
      const created = createIncident({ title: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/incidents/${created.id}/timeline`, {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.count).toBe(1);
    });
  });
});
