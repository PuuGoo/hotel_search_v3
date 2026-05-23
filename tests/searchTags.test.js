import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
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
const DATA_FILE = path.join(__dirname, "..", "search_tags.json");

let originalUsers;
let adminCookie;
let server;
let baseUrl;

const { default: searchTagRoutes } = await import("../routes/searchTags.js");

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
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode, json: () => Promise.resolve(JSON.parse(body)) })
        );
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
  app.use(
    session({
      secret: "test",
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, maxAge: 86400000 },
    })
  );
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
  app.use(searchTagRoutes);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

async function loginAs(username, password) {
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}/login`);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => resolve(res.headers["set-cookie"]));
      }
    );
    req.write(JSON.stringify({ username, password }));
    req.end();
  });
}

describe("Search Tags", () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_USERS_FILE))
      originalUsers = fs.readFileSync(TEST_USERS_FILE, "utf8");
    fs.writeFileSync(
      TEST_USERS_FILE,
      JSON.stringify(
        [
          {
            id: 1,
            username: "admin",
            password: await bcrypt.hash("admin123", 10),
            displayName: "Admin",
            role: "admin",
            features: [],
            createdAt: new Date().toISOString(),
          },
        ],
        null,
        2
      )
    );
    const app = createTestApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
    adminCookie = await loginAs("admin", "admin123");
  });

  afterAll(() => {
    server?.close();
    if (originalUsers !== undefined) fs.writeFileSync(TEST_USERS_FILE, originalUsers);
    try {
      fs.unlinkSync(DATA_FILE);
    } catch {}
  });

  beforeEach(() => {
    try {
      fs.unlinkSync(DATA_FILE);
    } catch {}
  });

  test("GET /api/search-tags requires auth", async () => {
    const res = await makeRequest(`${baseUrl}/api/search-tags`);
    expect(res.status).toBe(401);
  });

  test("POST /api/search-tags creates a tag", async () => {
    const res = await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Beach Hotels", color: "#3ba55d" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Beach Hotels");
    expect(data.color).toBe("#3ba55d");
  });

  test("POST /api/search-tags rejects duplicate name", async () => {
    await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Beach" }),
    });
    const res = await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "beach" }),
    });
    expect(res.status).toBe(409);
  });

  test("POST /api/search-tags rejects empty name", async () => {
    const res = await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/search-tags returns user tags", async () => {
    await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tag 1" }),
    });
    await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tag 2" }),
    });

    const res = await makeRequest(`${baseUrl}/api/search-tags`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.length).toBe(2);
  });

  test("PUT /api/search-tags/:id updates a tag", async () => {
    const create = await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Old Name" }),
    });
    const { id } = await create.json();

    const res = await makeRequest(`${baseUrl}/api/search-tags/${id}`, {
      method: "PUT",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Name", color: "#ff4d4f" }),
    });
    const data = await res.json();
    expect(data.name).toBe("New Name");
    expect(data.color).toBe("#ff4d4f");
  });

  test("DELETE /api/search-tags/:id deletes a tag", async () => {
    const create = await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "To Delete" }),
    });
    const { id } = await create.json();

    const res = await makeRequest(`${baseUrl}/api/search-tags/${id}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);

    const list = await makeRequest(`${baseUrl}/api/search-tags`, {
      headers: { cookie: adminCookie },
    });
    const data = await list.json();
    expect(data.length).toBe(0);
  });

  test("POST /api/search-tags/tag tags a search query", async () => {
    const tagRes = await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Beach" }),
    });
    const { id: tagId } = await tagRes.json();

    const res = await makeRequest(`${baseUrl}/api/search-tags/tag`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hotel đà nẵng", tagIds: [tagId] }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.query).toBe("hotel đà nẵng");
    expect(data.tagIds).toContain(tagId);
  });

  test("GET /api/search-tags/:tagId/searches returns tagged searches", async () => {
    const tagRes = await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Tag" }),
    });
    const { id: tagId } = await tagRes.json();

    await makeRequest(`${baseUrl}/api/search-tags/tag`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "search 1", tagIds: [tagId] }),
    });
    await makeRequest(`${baseUrl}/api/search-tags/tag`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "search 2", tagIds: [tagId] }),
    });

    const res = await makeRequest(`${baseUrl}/api/search-tags/${tagId}/searches`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.length).toBe(2);
  });

  test("GET /api/search-tags/stats returns stats", async () => {
    const tagRes = await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Stats Tag" }),
    });
    const { id: tagId } = await tagRes.json();

    await makeRequest(`${baseUrl}/api/search-tags/tag`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "tagged search", tagIds: [tagId] }),
    });

    const res = await makeRequest(`${baseUrl}/api/search-tags/stats`, {
      headers: { cookie: adminCookie },
    });
    const data = await res.json();
    expect(data.totalTags).toBe(1);
    expect(data.totalTaggedSearches).toBe(1);
    expect(data.tagUsage[tagId]).toBe(1);
  });

  test("POST /api/search-tags/bulk/tag tags multiple queries", async () => {
    const tagRes = await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bulk Tag" }),
    });
    const { id: tagId } = await tagRes.json();

    const res = await makeRequest(`${baseUrl}/api/search-tags/bulk/tag`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ queries: ["query 1", "query 2", "query 3"], tagIds: [tagId] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.tagged).toBe(3);

    // Verify all queries are tagged
    const searches = await makeRequest(`${baseUrl}/api/search-tags/${tagId}/searches`, {
      headers: { cookie: adminCookie },
    });
    const searchData = await searches.json();
    expect(searchData.length).toBe(3);
  });

  test("POST /api/search-tags/bulk/tag merges with existing tags", async () => {
    const tag1Res = await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tag A" }),
    });
    const { id: tag1Id } = await tag1Res.json();

    const tag2Res = await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tag B" }),
    });
    const { id: tag2Id } = await tag2Res.json();

    // Tag with first tag
    await makeRequest(`${baseUrl}/api/search-tags/tag`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "existing query", tagIds: [tag1Id] }),
    });

    // Bulk tag same query with second tag
    const res = await makeRequest(`${baseUrl}/api/search-tags/bulk/tag`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ queries: ["existing query"], tagIds: [tag2Id] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tagged).toBe(1);

    // Verify both tags are present
    const data_file = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    const entry = data_file.taggedSearches.find((ts) => ts.query === "existing query");
    expect(entry.tagIds).toContain(tag1Id);
    expect(entry.tagIds).toContain(tag2Id);
  });

  test("POST /api/search-tags/bulk/untag removes tags from multiple queries", async () => {
    const tagRes = await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Remove Tag" }),
    });
    const { id: tagId } = await tagRes.json();

    // Tag multiple queries
    await makeRequest(`${baseUrl}/api/search-tags/bulk/tag`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ queries: ["q1", "q2", "q3"], tagIds: [tagId] }),
    });

    // Untag two of them
    const res = await makeRequest(`${baseUrl}/api/search-tags/bulk/untag`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ queries: ["q1", "q2"], tagIds: [tagId] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.untagged).toBe(2);

    // Only q3 should remain
    const searches = await makeRequest(`${baseUrl}/api/search-tags/${tagId}/searches`, {
      headers: { cookie: adminCookie },
    });
    const searchData = await searches.json();
    expect(searchData.length).toBe(1);
    expect(searchData[0].query).toBe("q3");
  });

  test("POST /api/search-tags/bulk/tag requires valid arrays", async () => {
    const res = await makeRequest(`${baseUrl}/api/search-tags/bulk/tag`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ queries: [], tagIds: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/search-tags/bulk/untag requires valid arrays", async () => {
    const res = await makeRequest(`${baseUrl}/api/search-tags/bulk/untag`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ queries: "not-array", tagIds: "not-array" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/search-tags/bulk/untag removes entry when no tags left", async () => {
    const tagRes = await makeRequest(`${baseUrl}/api/search-tags`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Only Tag" }),
    });
    const { id: tagId } = await tagRes.json();

    await makeRequest(`${baseUrl}/api/search-tags/tag`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "will be empty", tagIds: [tagId] }),
    });

    await makeRequest(`${baseUrl}/api/search-tags/bulk/untag`, {
      method: "POST",
      headers: { cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ queries: ["will be empty"], tagIds: [tagId] }),
    });

    const data_file = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    expect(data_file.taggedSearches.find((ts) => ts.query === "will be empty")).toBeUndefined();
  });
});
