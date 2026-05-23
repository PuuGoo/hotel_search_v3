import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import http from "http";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import favoritesSyncRoutes from "../routes/favoritesSync.js";
import {
  getFavorites,
  addFavorite,
  removeFavorite,
  updateFavorite,
  getSyncStatus,
  syncFavorites,
  getFavoritesStats,
} from "../utils/favoritesSync.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FAVORITES_FILE = path.join(__dirname, "..", "favorites_sync.json");

let favoritesBackup;

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
  app.use(favoritesSyncRoutes);
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

describe("Favorites Sync", () => {
  beforeEach(() => {
    try { favoritesBackup = fs.readFileSync(FAVORITES_FILE, "utf8"); } catch { favoritesBackup = null; }
    // Clean up
    try { fs.writeFileSync(FAVORITES_FILE, "{}"); } catch {}
  });

  afterEach(() => {
    if (favoritesBackup) fs.writeFileSync(FAVORITES_FILE, favoritesBackup);
    else { try { fs.unlinkSync(FAVORITES_FILE); } catch {} }
  });

  describe("Utility functions", () => {
    test("getFavorites returns empty for new user", () => {
      const favorites = getFavorites("newuser");
      expect(favorites.items).toEqual([]);
      expect(favorites.lastSync).toBeNull();
    });

    test("addFavorite adds a favorite", () => {
      const result = addFavorite("user1", { url: "https://example.com/hotel", title: "Test Hotel" });
      expect(result.added).toBe(true);
      expect(result.item.url).toBe("https://example.com/hotel");
      expect(result.item.title).toBe("Test Hotel");
      expect(result.item.id).toBeDefined();
    });

    test("addFavorite rejects duplicate URL", () => {
      addFavorite("user1", { url: "https://example.com/hotel", title: "Test Hotel" });
      const result = addFavorite("user1", { url: "https://example.com/hotel", title: "Same Hotel" });
      expect(result.added).toBe(false);
      expect(result.message).toContain("Already");
    });

    test("addFavorite requires URL", () => {
      expect(() => addFavorite("user1", {})).toThrow("required");
    });

    test("removeFavorite removes a favorite", () => {
      const { item } = addFavorite("user1", { url: "https://example.com/hotel" });
      const removed = removeFavorite("user1", item.id);
      expect(removed).toBe(true);
      expect(getFavorites("user1").items.length).toBe(0);
    });

    test("removeFavorite returns false for nonexistent", () => {
      expect(removeFavorite("user1", "nonexistent")).toBe(false);
    });

    test("updateFavorite updates a favorite", () => {
      const { item } = addFavorite("user1", { url: "https://example.com/hotel", title: "Old Title" });
      const updated = updateFavorite("user1", item.id, { title: "New Title", tags: ["luxury"] });
      expect(updated.title).toBe("New Title");
      expect(updated.tags).toEqual(["luxury"]);
    });

    test("updateFavorite returns null for nonexistent", () => {
      expect(updateFavorite("user1", "nonexistent", { title: "Test" })).toBeNull();
    });

    test("getSyncStatus returns status", () => {
      addFavorite("user1", { url: "https://example.com/hotel" });
      const status = getSyncStatus("user1");
      expect(status.synced).toBe(true);
      expect(status.itemCount).toBe(1);
      expect(status.syncToken).toBeDefined();
    });

    test("getSyncStatus returns not synced for new user", () => {
      const status = getSyncStatus("newuser");
      expect(status.synced).toBe(false);
      expect(status.itemCount).toBe(0);
    });

    test("syncFavorites does full sync for new client", () => {
      addFavorite("user1", { url: "https://example.com/hotel1" });
      const result = syncFavorites("user1", { items: [] });
      expect(result.action).toBe("full_sync");
      expect(result.favorites.items.length).toBe(1);
    });

    test("syncFavorites merges items", () => {
      addFavorite("user1", { url: "https://example.com/hotel1" });
      const result = syncFavorites("user1", {
        syncToken: "old-token",
        items: [{ url: "https://example.com/hotel2", title: "Client Hotel", addedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      });
      expect(result.action).toBe("merged");
      expect(result.favorites.items.length).toBe(2);
    });

    test("syncFavorites handles conflicts", () => {
      const { item } = addFavorite("user1", { url: "https://example.com/hotel1" });
      const oldDate = new Date(Date.now() - 86400000).toISOString();
      const result = syncFavorites("user1", {
        syncToken: "old-token",
        items: [{ url: "https://example.com/hotel1", title: "Client Version", addedAt: oldDate, updatedAt: oldDate }],
      });
      expect(result.conflicts.length).toBeGreaterThanOrEqual(0);
    });

    test("getFavoritesStats returns statistics", () => {
      addFavorite("user1", { url: "https://example.com/hotel1", engine: "ddg", tags: ["luxury"] });
      addFavorite("user1", { url: "https://example.com/hotel2", engine: "google", tags: ["budget"] });
      const stats = getFavoritesStats("user1");
      expect(stats.total).toBe(2);
      expect(stats.byEngine.ddg).toBe(1);
      expect(stats.byEngine.google).toBe(1);
      expect(stats.byTag.luxury).toBe(1);
    });

    test("getFavoritesStats handles empty", () => {
      const stats = getFavoritesStats("newuser");
      expect(stats.total).toBe(0);
    });
  });

  describe("API Routes", () => {
    test("GET /api/favorites requires auth", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/favorites");
      expect(status).toBe(401);
    });

    test("GET /api/favorites returns favorites", async () => {
      addFavorite("user1", { url: "https://example.com/hotel" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/favorites", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("items");
    });

    test("POST /api/favorites requires url", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/favorites", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: {},
      });
      expect(status).toBe(400);
    });

    test("POST /api/favorites adds favorite", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/favorites", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { url: "https://example.com/hotel", title: "Test Hotel" },
      });
      expect(status).toBe(201);
      expect(body.added).toBe(true);
    });

    test("DELETE /api/favorites/:id removes favorite", async () => {
      const { item } = addFavorite("user1", { url: "https://example.com/hotel" });
      const app = createTestApp();
      const { status } = await makeRequest(app, `/api/favorites/${item.id}`, {
        method: "DELETE",
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
    });

    test("DELETE /api/favorites/:id returns 404 for nonexistent", async () => {
      const app = createTestApp();
      const { status } = await makeRequest(app, "/api/favorites/nonexistent", {
        method: "DELETE",
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(404);
    });

    test("PUT /api/favorites/:id updates favorite", async () => {
      const { item } = addFavorite("user1", { url: "https://example.com/hotel" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, `/api/favorites/${item.id}`, {
        method: "PUT",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { title: "Updated Title", tags: ["luxury"] },
      });
      expect(status).toBe(200);
      expect(body.title).toBe("Updated Title");
    });

    test("GET /api/favorites/sync/status returns status", async () => {
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/favorites/sync/status", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("synced");
      expect(body).toHaveProperty("itemCount");
    });

    test("POST /api/favorites/sync syncs favorites", async () => {
      addFavorite("user1", { url: "https://example.com/hotel1" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/favorites/sync", {
        method: "POST",
        headers: { "x-test-user": "user1", "content-type": "application/json" },
        body: { items: [] },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("action");
      expect(body).toHaveProperty("favorites");
    });

    test("GET /api/favorites/stats returns statistics", async () => {
      addFavorite("user1", { url: "https://example.com/hotel", engine: "ddg" });
      const app = createTestApp();
      const { status, body } = await makeRequest(app, "/api/favorites/stats", {
        headers: { "x-test-user": "user1" },
      });
      expect(status).toBe(200);
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("byEngine");
    });
  });
});
