import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "shared_searches.json");

const router = Router();

function readShared() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading shared searches:", e.message);
  }
  return [];
}

function writeShared(shared) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(shared, null, 2));
}

// Create a shared search
router.post("/api/shared-searches", checkAuthenticated, (req, res) => {
  const { query, engine, results, title } = req.body;

  if (!query || !Array.isArray(results)) {
    return res.status(400).json({ error: "query and results array required" });
  }

  const token = crypto.randomBytes(8).toString("hex");
  const shared = readShared();

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    token,
    userId: req.session.user.id,
    username: req.session.user.username,
    title: title || `Search: ${query}`,
    query,
    engine: engine || "tavily",
    results,
    viewCount: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
  };

  shared.push(entry);
  writeShared(shared);

  res.status(201).json({
    token,
    url: `/shared-search/${token}`,
    expiresAt: entry.expiresAt,
  });
});

// Get shared search by token (public)
router.get("/api/shared-searches/:token", (req, res) => {
  const shared = readShared();
  const entry = shared.find((s) => s.token === req.params.token);

  if (!entry) {
    return res.status(404).json({ error: "Shared search not found" });
  }

  if (new Date(entry.expiresAt) < new Date()) {
    return res.status(410).json({ error: "Shared search has expired" });
  }

  entry.viewCount = (entry.viewCount || 0) + 1;
  writeShared(shared);

  res.json({
    title: entry.title,
    query: entry.query,
    engine: entry.engine,
    results: entry.results,
    sharedBy: entry.username,
    createdAt: entry.createdAt,
    viewCount: entry.viewCount,
  });
});

// List user's shared searches
router.get("/api/shared-searches", checkAuthenticated, (req, res) => {
  const shared = readShared();
  const userShared = shared
    .filter((s) => s.userId === req.session.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((s) => ({
      id: s.id,
      token: s.token,
      title: s.title,
      query: s.query,
      engine: s.engine,
      resultCount: s.results.length,
      viewCount: s.viewCount,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      url: `/shared-search/${s.token}`,
    }));
  res.json(userShared);
});

// Delete a shared search
router.delete("/api/shared-searches/:id", checkAuthenticated, (req, res) => {
  const shared = readShared();
  const idx = shared.findIndex(
    (s) => s.id === req.params.id && s.userId === req.session.user.id
  );
  if (idx === -1) {
    return res.status(404).json({ error: "Not found" });
  }
  shared.splice(idx, 1);
  writeShared(shared);
  res.json({ success: true });
});

export default router;
