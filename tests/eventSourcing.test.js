import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import eventRoutes from "../routes/eventSourcing.js";
import {
  appendEvent,
  getEvents,
  getAllEvents,
  getEvent,
  saveSnapshot,
  getSnapshot,
  replayEvents,
  getEventStats,
  clearEventData,
} from "../utils/eventSourcing.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "event_store.json");

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
  app.use(eventRoutes);
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

describe("Event Sourcing", () => {
  beforeEach(() => {
    try { dataBackup = fs.readFileSync(DATA_FILE, "utf8"); } catch { dataBackup = null; }
    clearEventData();
  });

  afterEach(() => {
    if (dataBackup) saveWithRetry(DATA_FILE, dataBackup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("appendEvent appends an event", () => {
      const event = appendEvent({
        streamId: "user-1",
        type: "user.created",
        payload: { name: "Alice" },
        userId: "admin",
      });
      expect(event).toHaveProperty("id");
      expect(event.streamId).toBe("user-1");
      expect(event.type).toBe("user.created");
      expect(event.sequence).toBe(1);
    });

    test("events have sequential numbers", () => {
      appendEvent({ streamId: "s1", type: "a" });
      appendEvent({ streamId: "s1", type: "b" });
      appendEvent({ streamId: "s1", type: "c" });
      const { events } = getEvents("s1");
      expect(events[0].sequence).toBe(1);
      expect(events[1].sequence).toBe(2);
      expect(events[2].sequence).toBe(3);
    });

    test("getEvents returns events for a stream", () => {
      appendEvent({ streamId: "s1", type: "a" });
      appendEvent({ streamId: "s1", type: "b" });
      appendEvent({ streamId: "s2", type: "c" });
      const result = getEvents("s1");
      expect(result.total).toBe(2);
    });

    test("getEvents filters by type", () => {
      appendEvent({ streamId: "s1", type: "created" });
      appendEvent({ streamId: "s1", type: "updated" });
      const result = getEvents("s1", { type: "created" });
      expect(result.total).toBe(1);
    });

    test("getEvents filters by after", () => {
      appendEvent({ streamId: "s1", type: "a" });
      appendEvent({ streamId: "s1", type: "b" });
      const result = getEvents("s1", { after: 1 });
      expect(result.total).toBe(1);
    });

    test("getAllEvents returns all events", () => {
      appendEvent({ streamId: "s1", type: "a" });
      appendEvent({ streamId: "s2", type: "b" });
      expect(getAllEvents().total).toBe(2);
    });

    test("getAllEvents filters by type", () => {
      appendEvent({ streamId: "s1", type: "created" });
      appendEvent({ streamId: "s2", type: "updated" });
      expect(getAllEvents({ type: "created" }).total).toBe(1);
    });

    test("getEvent returns specific event", () => {
      const event = appendEvent({ streamId: "s1", type: "test" });
      expect(getEvent(event.id).type).toBe("test");
    });

    test("getEvent returns null for unknown", () => {
      expect(getEvent("unknown")).toBeNull();
    });

    test("saveSnapshot saves a snapshot", () => {
      const snapshot = saveSnapshot("s1", { count: 5 }, 3);
      expect(snapshot.state.count).toBe(5);
      expect(snapshot.version).toBe(3);
    });

    test("getSnapshot returns snapshot", () => {
      saveSnapshot("s1", { count: 5 }, 3);
      const snapshot = getSnapshot("s1");
      expect(snapshot.state.count).toBe(5);
    });

    test("getSnapshot returns null for unknown", () => {
      expect(getSnapshot("unknown")).toBeNull();
    });

    test("replayEvents rebuilds state", () => {
      appendEvent({ streamId: "order-1", type: "created", payload: { status: "new" } });
      appendEvent({ streamId: "order-1", type: "updated", payload: { status: "processing" } });
      appendEvent({ streamId: "order-1", type: "updated", payload: { status: "completed" } });

      const state = replayEvents("order-1", (state, event) => {
        return { ...state, ...event.payload };
      });
      expect(state.status).toBe("completed");
    });

    test("replayEvents uses snapshot as initial state", () => {
      saveSnapshot("s1", { base: true, count: 10 }, 5);
      appendEvent({ streamId: "s1", type: "increment", payload: { count: 11 } });

      const snapshot = getSnapshot("s1");
      const state = replayEvents("s1", (state, event) => {
        return { ...state, ...event.payload };
      }, snapshot.state);
      expect(state.base).toBe(true);
      expect(state.count).toBe(11);
    });

    test("getEventStats returns stats", () => {
      appendEvent({ streamId: "s1", type: "created" });
      appendEvent({ streamId: "s2", type: "updated" });
      const stats = getEventStats();
      expect(stats.totalEvents).toBe(2);
      expect(stats.totalStreams).toBe(2);
    });

    test("clearEventData clears all data", () => {
      appendEvent({ streamId: "s1", type: "test" });
      clearEventData();
      expect(getAllEvents().total).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/events requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/events", {
        method: "POST",
        body: { streamId: "s1", type: "test" },
      });
      expect(status).toBe(401);
    });

    test("POST /api/events appends event", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/events", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { streamId: "s1", type: "test", payload: { data: 1 } },
      });
      expect(status).toBe(201);
      expect(body.type).toBe("test");
    });

    test("GET /api/events requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/events", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/events returns events for admin", async () => {
      appendEvent({ streamId: "s1", type: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/events", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("GET /api/events/stats returns stats for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/events/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalEvents");
    });

    test("GET /api/events/stream/:streamId returns stream events", async () => {
      appendEvent({ streamId: "s1", type: "test" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/events/stream/s1", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.total).toBe(1);
    });

    test("POST /api/events/stream/:streamId/snapshot saves snapshot", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/events/stream/s1/snapshot", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { state: { count: 5 }, version: 3 },
      });
      expect(status).toBe(201);
      expect(body.state.count).toBe(5);
    });

    test("GET /api/events/stream/:streamId/replay replays events", async () => {
      appendEvent({ streamId: "s1", type: "a", payload: { x: 1 } });
      appendEvent({ streamId: "s1", type: "b", payload: { x: 2 } });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/events/stream/s1/replay", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.state.x).toBe(2);
    });

    test("DELETE /api/events/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/events/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/events/clear clears for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/events/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
