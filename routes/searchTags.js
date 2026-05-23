import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "search_tags.json");

const router = Router();

function readTags() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading tags:", e.message);
  }
  return { tags: [], taggedSearches: [] };
}

function writeTags(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Get all tags for current user
router.get("/api/search-tags", checkAuthenticated, (req, res) => {
  const data = readTags();
  const userTags = data.tags.filter((t) => t.userId === req.session.user.id);
  res.json(userTags);
});

// Create a tag
router.post("/api/search-tags", checkAuthenticated, (req, res) => {
  const { name, color } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  const data = readTags();
  const existing = data.tags.find(
    (t) => t.userId === req.session.user.id && t.name.toLowerCase() === name.trim().toLowerCase()
  );
  if (existing) {
    return res.status(409).json({ error: "Tag already exists", existing });
  }

  const tag = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: req.session.user.id,
    name: name.trim(),
    color: color || "#667eea",
    createdAt: new Date().toISOString(),
  };

  data.tags.push(tag);
  writeTags(data);
  res.status(201).json(tag);
});

// Update a tag
router.put("/api/search-tags/:id", checkAuthenticated, (req, res) => {
  const data = readTags();
  const idx = data.tags.findIndex(
    (t) => t.id === req.params.id && t.userId === req.session.user.id
  );
  if (idx === -1) {
    return res.status(404).json({ error: "Tag not found" });
  }

  const { name, color } = req.body;
  if (name !== undefined) data.tags[idx].name = name.trim();
  if (color !== undefined) data.tags[idx].color = color;

  writeTags(data);
  res.json(data.tags[idx]);
});

// Delete a tag
router.delete("/api/search-tags/:id", checkAuthenticated, (req, res) => {
  const data = readTags();
  const idx = data.tags.findIndex(
    (t) => t.id === req.params.id && t.userId === req.session.user.id
  );
  if (idx === -1) {
    return res.status(404).json({ error: "Tag not found" });
  }

  data.tags.splice(idx, 1);
  // Remove tag from all tagged searches
  data.taggedSearches = data.taggedSearches.map((ts) => ({
    ...ts,
    tagIds: (ts.tagIds || []).filter((id) => id !== req.params.id),
  }));

  writeTags(data);
  res.json({ success: true });
});

// Tag a search query
router.post("/api/search-tags/tag", checkAuthenticated, (req, res) => {
  const { query, tagIds } = req.body;

  if (!query || !Array.isArray(tagIds)) {
    return res.status(400).json({ error: "query and tagIds required" });
  }

  const data = readTags();
  const idx = data.taggedSearches.findIndex(
    (ts) => ts.userId === req.session.user.id && ts.query.toLowerCase() === query.trim().toLowerCase()
  );

  if (idx >= 0) {
    // Merge tag IDs
    const existing = new Set(data.taggedSearches[idx].tagIds || []);
    for (const id of tagIds) existing.add(id);
    data.taggedSearches[idx].tagIds = Array.from(existing);
    data.taggedSearches[idx].updatedAt = new Date().toISOString();
    writeTags(data);
    res.json(data.taggedSearches[idx]);
  } else {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      userId: req.session.user.id,
      query: query.trim(),
      tagIds,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.taggedSearches.push(entry);
    writeTags(data);
    res.status(201).json(entry);
  }
});

// Remove tag from search
router.delete("/api/search-tags/tag/:query/:tagId", checkAuthenticated, (req, res) => {
  const data = readTags();
  const idx = data.taggedSearches.findIndex(
    (ts) =>
      ts.userId === req.session.user.id &&
      ts.query.toLowerCase() === req.params.query.toLowerCase()
  );

  if (idx === -1) {
    return res.status(404).json({ error: "Tagged search not found" });
  }

  data.taggedSearches[idx].tagIds = (data.taggedSearches[idx].tagIds || []).filter(
    (id) => id !== req.params.tagId
  );
  data.taggedSearches[idx].updatedAt = new Date().toISOString();

  writeTags(data);
  res.json({ success: true });
});

// Get searches by tag
router.get("/api/search-tags/:tagId/searches", checkAuthenticated, (req, res) => {
  const data = readTags();
  const tagged = data.taggedSearches.filter(
    (ts) => ts.userId === req.session.user.id && (ts.tagIds || []).includes(req.params.tagId)
  );
  res.json(tagged);
});

// Get tags stats
router.get("/api/search-tags/stats", checkAuthenticated, (req, res) => {
  const data = readTags();
  const userTags = data.tags.filter((t) => t.userId === req.session.user.id);
  const userSearches = data.taggedSearches.filter((ts) => ts.userId === req.session.user.id);

  const tagUsage = {};
  for (const ts of userSearches) {
    for (const tagId of ts.tagIds || []) {
      tagUsage[tagId] = (tagUsage[tagId] || 0) + 1;
    }
  }

  res.json({
    totalTags: userTags.length,
    totalTaggedSearches: userSearches.length,
    tagUsage,
  });
});

// Bulk tag multiple searches
router.post("/api/search-tags/bulk/tag", checkAuthenticated, (req, res) => {
  const { queries, tagIds } = req.body;

  if (!Array.isArray(queries) || !Array.isArray(tagIds) || queries.length === 0 || tagIds.length === 0) {
    return res.status(400).json({ error: "queries and tagIds arrays required" });
  }

  const data = readTags();
  const userId = req.session.user.id;
  let tagged = 0;

  for (const query of queries) {
    if (!query || !query.trim()) continue;

    const idx = data.taggedSearches.findIndex(
      (ts) => ts.userId === userId && ts.query.toLowerCase() === query.trim().toLowerCase()
    );

    if (idx >= 0) {
      const existing = new Set(data.taggedSearches[idx].tagIds || []);
      for (const id of tagIds) existing.add(id);
      data.taggedSearches[idx].tagIds = Array.from(existing);
      data.taggedSearches[idx].updatedAt = new Date().toISOString();
    } else {
      data.taggedSearches.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        userId,
        query: query.trim(),
        tagIds: [...tagIds],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    tagged++;
  }

  writeTags(data);
  res.json({ success: true, tagged });
});

// Bulk untag multiple searches
router.post("/api/search-tags/bulk/untag", checkAuthenticated, (req, res) => {
  const { queries, tagIds } = req.body;

  if (!Array.isArray(queries) || !Array.isArray(tagIds) || queries.length === 0 || tagIds.length === 0) {
    return res.status(400).json({ error: "queries and tagIds arrays required" });
  }

  const data = readTags();
  const userId = req.session.user.id;
  const tagIdSet = new Set(tagIds);
  let untagged = 0;

  for (const query of queries) {
    if (!query || !query.trim()) continue;

    const idx = data.taggedSearches.findIndex(
      (ts) => ts.userId === userId && ts.query.toLowerCase() === query.trim().toLowerCase()
    );

    if (idx >= 0) {
      const before = (data.taggedSearches[idx].tagIds || []).length;
      data.taggedSearches[idx].tagIds = (data.taggedSearches[idx].tagIds || []).filter(
        (id) => !tagIdSet.has(id)
      );
      if (data.taggedSearches[idx].tagIds.length < before) untagged++;
      data.taggedSearches[idx].updatedAt = new Date().toISOString();

      // Remove entry if no tags left
      if (data.taggedSearches[idx].tagIds.length === 0) {
        data.taggedSearches.splice(idx, 1);
      }
    }
  }

  writeTags(data);
  res.json({ success: true, untagged });
});

export default router;
