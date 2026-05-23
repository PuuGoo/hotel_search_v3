import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import queryExpansionRoutes from "../routes/queryExpansion.js";
import {
  expandQueryTerms,
  generateAlternatives,
  addCustomRule,
  getCustomRulesList,
  deleteCustomRule,
  getExpansionStats,
} from "../utils/queryExpansion.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RULES_FILE = path.join(__dirname, "..", "query_expansion_rules.json");

let rulesBackup;

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
  app.use(queryExpansionRoutes);
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

describe("Query Expansion", () => {
  beforeEach(() => {
    try { rulesBackup = fs.readFileSync(RULES_FILE, "utf8"); } catch { rulesBackup = null; }
  });

  afterEach(() => {
    if (rulesBackup) fs.writeFileSync(RULES_FILE, rulesBackup);
    else { try { fs.unlinkSync(RULES_FILE); } catch { /* ignore */ } }
  });

  describe("Utility functions", () => {
    test("expandQueryTerms expands abbreviations", () => {
      const result = expandQueryTerms("hotel in NYC");
      expect(result.expanded).toContain("new york city");
      expect(result.expansions.some((e) => e.type === "abbreviation")).toBe(true);
      expect(result.changed).toBe(true);
    });

    test("expandQueryTerms expands multiple abbreviations", () => {
      const result = expandQueryTerms("hotels in SF and LA");
      expect(result.expanded).toContain("san francisco");
      expect(result.expanded).toContain("los angeles");
    });

    test("expandQueryTerms fixes misspellings", () => {
      const result = expandQueryTerms("cheap hotle in parsi");
      expect(result.expanded).toContain("hotel");
      expect(result.corrections.some((c) => c.type === "misspelling")).toBe(true);
    });

    test("expandQueryTerms expands synonyms", () => {
      const result = expandQueryTerms("luxury hotel", { maxExpansions: 2 });
      expect(result.expansions.some((e) => e.type === "synonym")).toBe(true);
    });

    test("expandQueryTerms expands amenities when enabled", () => {
      const result = expandQueryTerms("hotel with pool", { expandAmenities: true, expandSynonyms: false });
      expect(result.expanded).toContain("swimming pool");
      expect(result.expansions.some((e) => e.type === "amenity")).toBe(true);
    });

    test("expandQueryTerms respects maxExpansions", () => {
      const result = expandQueryTerms("luxury hotel resort", { maxExpansions: 1 });
      const synonymExpansions = result.expansions.filter((e) => e.type === "synonym");
      expect(synonymExpansions.length).toBeLessThanOrEqual(1);
    });

    test("expandQueryTerms handles null input", () => {
      const result = expandQueryTerms(null);
      expect(result.original).toBeNull();
      expect(result.expanded).toBeNull();
      expect(result.changed).toBe(false);
    });

    test("expandQueryTerms handles empty string", () => {
      const result = expandQueryTerms("");
      expect(result.expanded).toBe("");
      expect(result.changed).toBe(false);
    });

    test("expandQueryTerms applies custom rules", () => {
      addCustomRule({ pattern: "testpattern", replacement: "testreplacement", type: "test" });
      const result = expandQueryTerms("find testpattern hotel");
      expect(result.expanded).toContain("testreplacement");
      expect(result.expansions.some((e) => e.type === "test")).toBe(true);
    });

    test("expandQueryTerms skips expansion when disabled", () => {
      const result = expandQueryTerms("hotel in NYC", {
        expandAbbreviations: false,
        expandSynonyms: false,
        fixMisspellings: false,
      });
      expect(result.expanded).toBe("hotel in nyc");
      expect(result.changed).toBe(false);
    });

    test("generateAlternatives generates alternatives", () => {
      const alternatives = generateAlternatives("luxury hotel");
      expect(alternatives.length).toBeGreaterThan(0);
      expect(alternatives).not.toContain("luxury hotel");
    });

    test("generateAlternatives includes expanded version", () => {
      const alternatives = generateAlternatives("hotel in NYC");
      expect(alternatives.some((a) => a.includes("new york city"))).toBe(true);
    });

    test("generateAlternatives respects maxAlternatives", () => {
      const alternatives = generateAlternatives("luxury hotel with pool spa gym", 2);
      expect(alternatives.length).toBeLessThanOrEqual(2);
    });

    test("generateAlternatives handles null input", () => {
      expect(generateAlternatives(null)).toEqual([]);
    });

    test("addCustomRule adds rule", () => {
      const rule = addCustomRule({ pattern: "test", replacement: "replacement", type: "custom" });
      expect(rule).toHaveProperty("pattern");
      expect(rule).toHaveProperty("replacement");

      const rules = getCustomRulesList();
      expect(rules.some((r) => r.pattern === "test")).toBe(true);
    });

    test("addCustomRule requires pattern and replacement", () => {
      expect(() => addCustomRule({})).toThrow("pattern and replacement are required");
    });

    test("deleteCustomRule deletes rule", () => {
      addCustomRule({ pattern: "toDelete", replacement: "deleted" });
      const rules = getCustomRulesList();
      const index = rules.length - 1;

      const deleted = deleteCustomRule(index);
      expect(deleted).toBe(true);
      expect(getCustomRulesList().length).toBe(index);
    });

    test("deleteCustomRule returns false for invalid index", () => {
      expect(deleteCustomRule(-1)).toBe(false);
      expect(deleteCustomRule(999)).toBe(false);
    });

    test("getExpansionStats returns statistics", () => {
      const stats = getExpansionStats();
      expect(stats).toHaveProperty("builtinAbbreviations");
      expect(stats).toHaveProperty("builtinSynonyms");
      expect(stats).toHaveProperty("builtinMisspellings");
      expect(stats).toHaveProperty("builtinAmenities");
      expect(stats).toHaveProperty("customRules");
      expect(stats.builtinAbbreviations).toBeGreaterThan(0);
    });
  });

  describe("API Routes", () => {
    test("POST /api/expansion/expand requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/expansion/expand", {
        method: "POST",
        body: { query: "hotel" },
      });
      expect(status).toBe(401);
    });

    test("POST /api/expansion/expand requires query", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/expansion/expand", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/expansion/expand expands query", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/expansion/expand", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { query: "hotel in NYC" },
      });
      expect(status).toBe(200);
      expect(body.expanded).toContain("new york city");
      expect(body.changed).toBe(true);
    });

    test("POST /api/expansion/alternatives requires query", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/expansion/alternatives", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/expansion/alternatives generates alternatives", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/expansion/alternatives", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { query: "luxury hotel" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("alternatives");
      expect(body).toHaveProperty("count");
      expect(body.count).toBeGreaterThan(0);
    });

    test("GET /api/expansion/stats returns statistics", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/expansion/stats", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("builtinAbbreviations");
      expect(body).toHaveProperty("builtinSynonyms");
    });

    test("GET /api/expansion/rules requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/expansion/rules", {
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("GET /api/expansion/rules returns rules for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/expansion/rules", {
        headers: { "x-test-user": "admin1", "x-test-role": "admin" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("rules");
      expect(body).toHaveProperty("count");
    });

    test("POST /api/expansion/rules requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/expansion/rules", {
        method: "POST",
        headers: { "x-test-user": "user1", "x-test-role": "user", "content-type": "application/json" },
        body: { pattern: "test", replacement: "replacement" },
      });
      expect(status).toBe(403);
    });

    test("POST /api/expansion/rules adds rule for admin", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/expansion/rules", {
        method: "POST",
        headers: { "x-test-user": "admin1", "x-test-role": "admin", "content-type": "application/json" },
        body: { pattern: "newrule", replacement: "newreplacement" },
      });
      expect(status).toBe(201);
      expect(body.message).toContain("added");
    });

    test("POST /api/expansion/rules requires pattern and replacement", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/expansion/rules", {
        method: "POST",
        headers: { "x-test-user": "admin1", "x-test-role": "admin", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("DELETE /api/expansion/rules/:index requires admin", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/expansion/rules/0", {
        method: "DELETE",
        headers: { "x-test-user": "user1", "x-test-role": "user" },
      });
      expect(status).toBe(403);
    });

    test("DELETE /api/expansion/rules/:index returns 404 for invalid index", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/expansion/rules/999", {
        method: "DELETE",
        headers: { "x-test-user": "admin1", "x-test-role": "admin" },
      });
      expect(status).toBe(404);
    });
  });
});
