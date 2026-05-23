import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import autocompleteRoutes from "../routes/autocompleteDictionary.js";
import {
  rebuildDictionary,
  getSuggestions,
  addTerm,
  removeTerm,
  getDictionaryStats,
  clearDictionary,
} from "../utils/autocompleteDictionary.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DICTIONARY_FILE = path.join(__dirname, "..", "autocomplete_dictionary.json");
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");

let dictionaryBackup;
let historyBackup;

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
  app.use(autocompleteRoutes);
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

describe("Auto-complete Dictionary", () => {
  beforeEach(() => {
    try { dictionaryBackup = fs.readFileSync(DICTIONARY_FILE, "utf8"); } catch { dictionaryBackup = null; }
    try { historyBackup = fs.readFileSync(HISTORY_FILE, "utf8"); } catch { historyBackup = null; }
    clearDictionary();
  });

  afterEach(() => {
    if (dictionaryBackup) saveWithRetry(DICTIONARY_FILE, dictionaryBackup);
    else { try { fs.unlinkSync(DICTIONARY_FILE); } catch {} }
    if (historyBackup) saveWithRetry(HISTORY_FILE, historyBackup);
  });

  describe("Utility functions", () => {
    test("rebuildDictionary builds from history", () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "u1", query: "hotel paris", timestamp: new Date().toISOString() },
        { userId: "u1", query: "hotel paris", timestamp: new Date().toISOString() },
        { userId: "u1", query: "hotel london", timestamp: new Date().toISOString() },
        { userId: "u1", query: "resort", timestamp: new Date().toISOString() },
      ]));

      const result = rebuildDictionary({ minOccurrences: 1 });
      expect(result.termCount).toBeGreaterThan(0);
      expect(result.phraseCount).toBeGreaterThan(0);
    });

    test("getSuggestions returns matching suggestions", () => {
      addTerm("hotel", 10);
      addTerm("hostel", 5);
      addTerm("resort", 3);

      const suggestions = getSuggestions("ho");
      expect(suggestions.length).toBe(2);
      expect(suggestions[0].text).toBe("hotel");
    });

    test("getSuggestions limits results", () => {
      for (let i = 0; i < 20; i++) {
        addTerm(`hotel${i}`, i);
      }

      const suggestions = getSuggestions("hotel", { limit: 5 });
      expect(suggestions.length).toBe(5);
    });

    test("getSuggestions returns empty for empty prefix", () => {
      expect(getSuggestions("")).toEqual([]);
      expect(getSuggestions(null)).toEqual([]);
    });

    test("addTerm adds a term", () => {
      const result = addTerm("hotel", 5);
      expect(result.term).toBe("hotel");
      expect(result.count).toBe(5);
    });

    test("addTerm increments existing term", () => {
      addTerm("hotel", 3);
      const result = addTerm("hotel", 2);
      expect(result.count).toBe(5);
    });

    test("removeTerm removes a term", () => {
      addTerm("hotel");
      expect(removeTerm("hotel")).toBe(true);
      expect(getSuggestions("hotel").length).toBe(0);
    });

    test("removeTerm returns false for unknown term", () => {
      expect(removeTerm("nonexistent")).toBe(false);
    });

    test("getDictionaryStats returns stats", () => {
      addTerm("hotel", 10);
      addTerm("resort", 5);
      const stats = getDictionaryStats();
      expect(stats.totalTerms).toBe(2);
      expect(stats.topTerms.length).toBe(2);
      expect(stats.topTerms[0].term).toBe("hotel");
    });

    test("clearDictionary clears all", () => {
      addTerm("hotel");
      clearDictionary();
      const stats = getDictionaryStats();
      expect(stats.totalTerms).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("GET /api/autocomplete/suggest requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/autocomplete/suggest?q=hotel");
      expect(status).toBe(401);
    });

    test("GET /api/autocomplete/suggest returns suggestions", async () => {
      addTerm("hotel", 10);
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/autocomplete/suggest?q=hot", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body.suggestions.length).toBeGreaterThan(0);
    });

    test("POST /api/autocomplete/rebuild requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/autocomplete/rebuild", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(403);
    });

    test("POST /api/autocomplete/rebuild rebuilds dictionary", async () => {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([
        { userId: "u1", query: "hotel paris", timestamp: new Date().toISOString() },
        { userId: "u1", query: "hotel paris", timestamp: new Date().toISOString() },
      ]));
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/autocomplete/rebuild", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { minOccurrences: 1 },
      });
      expect(status).toBe(200);
      expect(body.termCount).toBeGreaterThan(0);
    });

    test("POST /api/autocomplete/term requires term", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/autocomplete/term", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/autocomplete/term adds term for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/autocomplete/term", {
        method: "POST",
        headers: { "x-test-user": "admin", "x-test-role": "admin", "content-type": "application/json" },
        body: { term: "hotel", count: 5 },
      });
      expect(status).toBe(201);
      expect(body.term).toBe("hotel");
    });

    test("DELETE /api/autocomplete/term/:term requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/autocomplete/term/hotel", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/autocomplete/term/:term removes term", async () => {
      addTerm("hotel");
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/autocomplete/term/hotel", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("removed");
    });

    test("GET /api/autocomplete/stats requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/autocomplete/stats", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/autocomplete/stats returns stats for admin", async () => {
      addTerm("hotel");
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/autocomplete/stats", {
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("totalTerms");
    });

    test("DELETE /api/autocomplete/clear requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/autocomplete/clear", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/autocomplete/clear clears for admin", async () => {
      addTerm("hotel");
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/autocomplete/clear", {
        method: "DELETE",
        headers: { "x-test-user": "admin", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body.message).toContain("cleared");
    });
  });
});
