import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";
import { logAudit } from "./audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COLLECTIONS_FILE = path.join(__dirname, "..", "bookmark_collections.json");
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");
const MAX_COLLECTIONS_PER_USER = 30;
const MAX_ITEMS_PER_COLLECTION = 100;
const SHARE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const router = Router();

function readCollections() {
  try {
    if (fs.existsSync(COLLECTIONS_FILE)) {
      return JSON.parse(fs.readFileSync(COLLECTIONS_FILE, "utf8"));
    }
  } catch {}
  return {};
}

function writeCollections(data) {
  fs.writeFileSync(COLLECTIONS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function readBookmarks() {
  try {
    if (fs.existsSync(BOOKMARKS_FILE)) {
      return JSON.parse(fs.readFileSync(BOOKMARKS_FILE, "utf8"));
    }
  } catch {}
  return {};
}

function generateToken() {
  return crypto.randomBytes(10).toString("hex");
}

function sanitize(str, maxLen = 200) {
  return (str || "").replace(/[<>]/g, "").trim().slice(0, maxLen);
}

// List user's collections
router.get("/api/collections", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const all = readCollections();
  const userCollections = (all[userId] || []).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    bookmarkCount: (c.bookmarkIds || []).length,
    shareToken: c.shareToken || null,
    shared: !!c.shareToken,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
  res.json({ collections: userCollections });
});

// Create a collection
router.post("/api/collections", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { name, description, bookmarkIds } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: "Collection name is required" });
  }

  const sanitizedName = sanitize(name, 150);
  const sanitizedDesc = sanitize(description, 500);

  const all = readCollections();
  if (!all[userId]) all[userId] = [];

  if (all[userId].length >= MAX_COLLECTIONS_PER_USER) {
    return res.status(400).json({ error: `Maximum ${MAX_COLLECTIONS_PER_USER} collections allowed` });
  }

  // Validate bookmark IDs exist and belong to user
  let validBookmarkIds = [];
  if (Array.isArray(bookmarkIds) && bookmarkIds.length > 0) {
    const bookmarks = readBookmarks();
    const userBookmarks = bookmarks[userId] || [];
    const userBookmarkIds = new Set(userBookmarks.map((b) => b.id));
    validBookmarkIds = bookmarkIds
      .filter((id) => userBookmarkIds.has(Number(id)))
      .map(Number)
      .slice(0, MAX_ITEMS_PER_COLLECTION);
  }

  const collection = {
    id: Date.now(),
    name: sanitizedName,
    description: sanitizedDesc,
    bookmarkIds: validBookmarkIds,
    shareToken: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  all[userId].push(collection);
  writeCollections(all);

  logAudit("collection_created", {
    userId,
    username: req.session.user?.username,
    ip: req.ip,
    detail: `collection=${sanitizedName}, bookmarks=${validBookmarkIds.length}`,
  });

  res.json({ success: true, collection });
});

// Get collection detail with bookmark data
router.get("/api/collections/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const collectionId = Number(req.params.id);

  const all = readCollections();
  const userCollections = all[userId] || [];
  const collection = userCollections.find((c) => c.id === collectionId);

  if (!collection) {
    return res.status(404).json({ error: "Collection not found" });
  }

  // Resolve bookmark details
  const bookmarks = readBookmarks();
  const userBookmarks = bookmarks[userId] || [];
  const bookmarkMap = new Map(userBookmarks.map((b) => [b.id, b]));

  const items = (collection.bookmarkIds || [])
    .map((id) => bookmarkMap.get(id))
    .filter(Boolean)
    .map((b) => ({
      id: b.id,
      title: b.title,
      url: b.url,
      snippet: b.snippet || "",
      engine: b.engine,
      tags: b.tags || [],
    }));

  res.json({
    id: collection.id,
    name: collection.name,
    description: collection.description,
    bookmarkCount: items.length,
    shareToken: collection.shareToken || null,
    shared: !!collection.shareToken,
    bookmarks: items,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  });
});

// Update collection
router.put("/api/collections/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const collectionId = Number(req.params.id);
  const { name, description, addBookmarkIds, removeBookmarkIds } = req.body;

  const all = readCollections();
  const userCollections = all[userId] || [];
  const collection = userCollections.find((c) => c.id === collectionId);

  if (!collection) {
    return res.status(404).json({ error: "Collection not found" });
  }

  if (name !== undefined) {
    const sanitized = sanitize(name, 150);
    if (!sanitized) return res.status(400).json({ error: "Invalid name" });
    collection.name = sanitized;
  }

  if (description !== undefined) {
    collection.description = sanitize(description, 500);
  }

  // Add bookmarks
  if (Array.isArray(addBookmarkIds) && addBookmarkIds.length > 0) {
    const bookmarks = readBookmarks();
    const userBookmarks = bookmarks[userId] || [];
    const userBookmarkIds = new Set(userBookmarks.map((b) => b.id));
    const existing = new Set(collection.bookmarkIds || []);

    for (const id of addBookmarkIds) {
      const numId = Number(id);
      if (userBookmarkIds.has(numId) && !existing.has(numId)) {
        if (existing.size >= MAX_ITEMS_PER_COLLECTION) break;
        existing.add(numId);
      }
    }
    collection.bookmarkIds = [...existing];
  }

  // Remove bookmarks
  if (Array.isArray(removeBookmarkIds) && removeBookmarkIds.length > 0) {
    const removeSet = new Set(removeBookmarkIds.map(Number));
    collection.bookmarkIds = (collection.bookmarkIds || []).filter((id) => !removeSet.has(id));
  }

  collection.updatedAt = new Date().toISOString();
  writeCollections(all);

  res.json({ success: true, collection });
});

// Delete collection
router.delete("/api/collections/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const collectionId = Number(req.params.id);

  const all = readCollections();
  const userCollections = all[userId] || [];
  const idx = userCollections.findIndex((c) => c.id === collectionId);

  if (idx === -1) {
    return res.status(404).json({ error: "Collection not found" });
  }

  userCollections.splice(idx, 1);
  all[userId] = userCollections;
  writeCollections(all);

  logAudit("collection_deleted", {
    userId,
    username: req.session.user?.username,
    ip: req.ip,
  });

  res.json({ success: true });
});

// Generate share token for collection
router.post("/api/collections/:id/share", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const collectionId = Number(req.params.id);

  const all = readCollections();
  const userCollections = all[userId] || [];
  const collection = userCollections.find((c) => c.id === collectionId);

  if (!collection) {
    return res.status(404).json({ error: "Collection not found" });
  }

  // Revoke existing token if requested
  if (req.body.revoke) {
    collection.shareToken = null;
    collection.shareExpiry = null;
    writeCollections(all);
    return res.json({ success: true, revoked: true });
  }

  const token = generateToken();
  collection.shareToken = token;
  collection.shareExpiry = Date.now() + SHARE_EXPIRY_MS;
  writeCollections(all);

  logAudit("collection_shared", {
    userId,
    username: req.session.user?.username,
    ip: req.ip,
    detail: `collection=${collection.name}`,
  });

  res.json({ success: true, token, url: `/collections/view/${token}` });
});

// Public: view shared collection (no auth required)
router.get("/api/collections/view/:token", (req, res) => {
  const { token } = req.params;
  const all = readCollections();
  const now = Date.now();

  for (const [userId, userCollections] of Object.entries(all)) {
    const collection = userCollections.find((c) => c.shareToken === token);
    if (collection) {
      if (collection.shareExpiry && now >= collection.shareExpiry) {
        return res.status(404).json({ error: "Share link expired" });
      }

      // Resolve bookmarks
      const bookmarks = readBookmarks();
      const userBookmarks = bookmarks[userId] || [];
      const bookmarkMap = new Map(userBookmarks.map((b) => [b.id, b]));

      const items = (collection.bookmarkIds || [])
        .map((id) => bookmarkMap.get(id))
        .filter(Boolean)
        .map((b) => ({
          title: b.title,
          url: b.url,
          snippet: b.snippet || "",
          engine: b.engine,
        }));

      return res.json({
        name: collection.name,
        description: collection.description,
        bookmarkCount: items.length,
        bookmarks: items,
        createdAt: collection.createdAt,
      });
    }
  }

  res.status(404).json({ error: "Collection not found" });
});

export default router;
