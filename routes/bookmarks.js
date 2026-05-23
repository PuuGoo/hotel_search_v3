import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";
import { logAudit } from "./audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");
const FOLDERS_FILE = path.join(__dirname, "..", "bookmark_folders.json");
const MAX_BOOKMARKS_PER_USER = 200;
const MAX_FOLDERS_PER_USER = 50;

const router = Router();

function readBookmarks() {
  try {
    if (fs.existsSync(BOOKMARKS_FILE)) {
      return JSON.parse(fs.readFileSync(BOOKMARKS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading bookmarks:", e.message);
  }
  return {};
}

function writeBookmarks(data) {
  fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function readFolders() {
  try {
    if (fs.existsSync(FOLDERS_FILE)) {
      return JSON.parse(fs.readFileSync(FOLDERS_FILE, "utf8"));
    }
  } catch {}
  return {};
}

function writeFolders(data) {
  fs.writeFileSync(FOLDERS_FILE, JSON.stringify(data, null, 2), "utf8");
}

/**
 * @swagger
 * /api/bookmarks:
 *   get:
 *     summary: Get user bookmarks
 *     description: Returns the authenticated user's saved bookmarks
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number (1-based)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Max results per page
 *       - in: query
 *         name: engine
 *         schema:
 *           type: string
 *           enum: [tavily, google, ddg]
 *         description: Filter by search engine
 *       - in: query
 *         name: tag
 *         schema:
 *           type: string
 *         description: Filter by tag
 *     responses:
 *       200:
 *         description: Bookmarks list with pagination
 *       401:
 *         description: Not authenticated
 */
router.get("/api/bookmarks", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_BOOKMARKS_PER_USER);
  const engineFilter = req.query.engine;
  const tagFilter = req.query.tag;
  const folderFilter = req.query.folder;

  const allBookmarks = readBookmarks();
  let items = allBookmarks[userId] || [];

  if (engineFilter && ["tavily", "google", "ddg"].includes(engineFilter)) {
    items = items.filter((b) => b.engine === engineFilter);
  }

  if (tagFilter) {
    items = items.filter((b) => (b.tags || []).includes(tagFilter));
  }

  if (folderFilter !== undefined) {
    if (folderFilter === "" || folderFilter === "uncategorized") {
      items = items.filter((b) => !b.folder);
    } else {
      items = items.filter((b) => b.folder === folderFilter);
    }
  }

  items.sort((a, b) => b.timestamp - a.timestamp);

  const total = items.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const paged = items.slice(offset, offset + limit);

  res.json({
    bookmarks: paged,
    total,
    page,
    limit,
    totalPages,
    hasMore: page < totalPages,
  });
});

/**
 * @swagger
 * /api/bookmarks:
 *   post:
 *     summary: Add bookmark
 *     description: Save a search result as a bookmark
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, url, engine]
 *             properties:
 *               title:
 *                 type: string
 *               url:
 *                 type: string
 *               snippet:
 *                 type: string
 *               engine:
 *                 type: string
 *                 enum: [tavily, google, ddg]
 *               query:
 *                 type: string
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Bookmark saved
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Not authenticated
 */
router.post("/api/bookmarks", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { title, url, snippet, engine, query, tags, folder } = req.body;

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return res.status(400).json({ error: "Thiếu title" });
  }
  if (!url || typeof url !== "string" || url.trim().length === 0) {
    return res.status(400).json({ error: "Thiếu url" });
  }
  if (!engine || !["tavily", "google", "ddg"].includes(engine)) {
    return res.status(400).json({ error: "Engine không hợp lệ" });
  }

  const sanitizedTitle = title.replace(/[<>]/g, "").trim().slice(0, 500);
  const sanitizedUrl = url.trim().slice(0, 2000);
  const sanitizedSnippet = (snippet || "").replace(/[<>]/g, "").trim().slice(0, 1000);
  const sanitizedQuery = (query || "").replace(/[<>]/g, "").trim().slice(0, 500);

  const allBookmarks = readBookmarks();
  if (!allBookmarks[userId]) {
    allBookmarks[userId] = [];
  }

  // Check for duplicate URL
  const exists = allBookmarks[userId].find((b) => b.url === sanitizedUrl);
  if (exists) {
    return res.status(400).json({ error: "Đã bookmark URL này rồi" });
  }

  const entry = {
    id: Date.now(),
    title: sanitizedTitle,
    url: sanitizedUrl,
    snippet: sanitizedSnippet,
    engine,
    query: sanitizedQuery,
    tags: Array.isArray(tags) ? tags.filter((t) => typeof t === "string").slice(0, 10).map((t) => t.replace(/[<>]/g, "").trim().slice(0, 50)) : [],
    folder: (typeof folder === "string" && folder.trim()) ? folder.replace(/[<>]/g, "").trim().slice(0, 100) : "",
    timestamp: Date.now(),
  };

  allBookmarks[userId].unshift(entry);

  if (allBookmarks[userId].length > MAX_BOOKMARKS_PER_USER) {
    allBookmarks[userId].length = MAX_BOOKMARKS_PER_USER;
  }

  writeBookmarks(allBookmarks);
  res.json({ success: true, bookmark: entry });
});

/**
 * @swagger
 * /api/bookmarks/{id}:
 *   put:
 *     summary: Update bookmark
 *     description: Update bookmark tags or title
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Bookmark updated
 *       404:
 *         description: Bookmark not found
 */
router.put("/api/bookmarks/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const bookmarkId = Number(req.params.id);

  const allBookmarks = readBookmarks();
  const userBookmarks = allBookmarks[userId] || [];
  const bookmark = userBookmarks.find((b) => b.id === bookmarkId);

  if (!bookmark) {
    return res.status(404).json({ error: "Không tìm thấy bookmark" });
  }

  const { title, tags, folder } = req.body;
  if (title !== undefined) {
    if (typeof title !== "string" || title.length > 500) {
      return res.status(400).json({ error: "Title không hợp lệ" });
    }
    bookmark.title = title.replace(/[<>]/g, "").trim();
  }
  if (Array.isArray(tags)) {
    bookmark.tags = tags.filter((t) => typeof t === "string").slice(0, 10).map((t) => t.replace(/[<>]/g, "").trim().slice(0, 50));
  }
  if (folder !== undefined) {
    bookmark.folder = (typeof folder === "string" && folder.trim()) ? folder.replace(/[<>]/g, "").trim().slice(0, 100) : "";
  }

  writeBookmarks(allBookmarks);
  res.json({ success: true, bookmark });
});

/**
 * @swagger
 * /api/bookmarks/{id}:
 *   delete:
 *     summary: Delete bookmark
 *     description: Delete a specific bookmark
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Bookmark deleted
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Bookmark not found
 */
router.delete("/api/bookmarks/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const bookmarkId = Number(req.params.id);

  const allBookmarks = readBookmarks();
  const userBookmarks = allBookmarks[userId] || [];
  const idx = userBookmarks.findIndex((b) => b.id === bookmarkId);

  if (idx === -1) {
    return res.status(404).json({ error: "Không tìm thấy bookmark" });
  }

  userBookmarks.splice(idx, 1);
  allBookmarks[userId] = userBookmarks;
  writeBookmarks(allBookmarks);
  res.json({ success: true });
});

/**
 * @swagger
 * /api/bookmarks:
 *   delete:
 *     summary: Clear all bookmarks
 *     description: Clear all bookmarks for the authenticated user
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Bookmarks cleared
 *       401:
 *         description: Not authenticated
 */
router.delete("/api/bookmarks", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const engineFilter = req.query.engine;
  const tagFilter = req.query.tag;

  const allBookmarks = readBookmarks();
  let userBookmarks = allBookmarks[userId] || [];

  if (engineFilter && ["tavily", "google", "ddg"].includes(engineFilter)) {
    const before = userBookmarks.length;
    userBookmarks = userBookmarks.filter((b) => b.engine !== engineFilter);
    const deleted = before - userBookmarks.length;
    allBookmarks[userId] = userBookmarks;
    writeBookmarks(allBookmarks);
    logAudit("bookmarks_bulk_deleted", { userId, username: req.session.user?.username, ip: req.ip, detail: `engine=${engineFilter}, deleted=${deleted}` });
    return res.json({ success: true, deleted, remaining: userBookmarks.length });
  }

  if (tagFilter) {
    const before = userBookmarks.length;
    userBookmarks = userBookmarks.filter((b) => !(b.tags || []).includes(tagFilter));
    const deleted = before - userBookmarks.length;
    allBookmarks[userId] = userBookmarks;
    writeBookmarks(allBookmarks);
    logAudit("bookmarks_bulk_deleted", { userId, username: req.session.user?.username, ip: req.ip, detail: `tag=${tagFilter}, deleted=${deleted}` });
    return res.json({ success: true, deleted, remaining: userBookmarks.length });
  }

  // No filter = clear all
  allBookmarks[userId] = [];
  writeBookmarks(allBookmarks);
  logAudit("bookmarks_cleared", { userId, username: req.session.user?.username, ip: req.ip });
  res.json({ success: true, deleted: userBookmarks.length, remaining: 0 });
});

/**
 * @swagger
 * /api/bookmarks/export:
 *   get:
 *     summary: Export bookmarks as CSV
 *     description: Downloads the authenticated user's bookmarks as a CSV file
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: engine
 *         schema:
 *           type: string
 *           enum: [tavily, google, ddg]
 *         description: Filter by search engine
 *       - in: query
 *         name: tag
 *         schema:
 *           type: string
 *         description: Filter by tag
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *       401:
 *         description: Not authenticated
 */
router.get("/api/bookmarks/export", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const engineFilter = req.query.engine;
  const tagFilter = req.query.tag;

  const allBookmarks = readBookmarks();
  let items = allBookmarks[userId] || [];

  if (engineFilter && ["tavily", "google", "ddg"].includes(engineFilter)) {
    items = items.filter((b) => b.engine === engineFilter);
  }

  if (tagFilter) {
    items = items.filter((b) => (b.tags || []).includes(tagFilter));
  }

  items.sort((a, b) => b.timestamp - a.timestamp);

  const escapeCsv = (val) => {
    const str = String(val ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = "Title,URL,Snippet,Engine,Query,Tags,Timestamp";
  const rows = items.map((b) =>
    [
      escapeCsv(b.title),
      escapeCsv(b.url),
      escapeCsv(b.snippet),
      escapeCsv(b.engine),
      escapeCsv(b.query),
      escapeCsv((b.tags || []).join(";")),
      new Date(b.timestamp).toISOString(),
    ].join(",")
  );

  const csv = [header, ...rows].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="bookmarks-${Date.now()}.csv"`);
  res.send(csv);
});

/**
 * @swagger
 * /api/bookmarks/export-json:
 *   get:
 *     summary: Export bookmarks as JSON
 *     description: Downloads the authenticated user's bookmarks as a structured JSON file
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: engine
 *         schema:
 *           type: string
 *           enum: [tavily, google, ddg]
 *         description: Filter by search engine
 *       - in: query
 *         name: folder
 *         schema:
 *           type: string
 *         description: Filter by folder name
 *       - in: query
 *         name: tag
 *         schema:
 *           type: string
 *         description: Filter by tag
 *     responses:
 *       200:
 *         description: JSON file download
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Not authenticated
 */
router.get("/api/bookmarks/export-json", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const engineFilter = req.query.engine;
  const folderFilter = req.query.folder;
  const tagFilter = req.query.tag;

  const allBookmarks = readBookmarks();
  let items = allBookmarks[userId] || [];

  if (engineFilter && ["tavily", "google", "ddg"].includes(engineFilter)) {
    items = items.filter((b) => b.engine === engineFilter);
  }

  if (folderFilter !== undefined && folderFilter !== null) {
    items = items.filter((b) => (b.folder || "") === folderFilter);
  }

  if (tagFilter) {
    items = items.filter((b) => (b.tags || []).includes(tagFilter));
  }

  items.sort((a, b) => b.timestamp - a.timestamp);

  const exportData = {
    exportedAt: new Date().toISOString(),
    totalBookmarks: items.length,
    bookmarks: items.map((b) => ({
      title: b.title,
      url: b.url,
      snippet: b.snippet || "",
      engine: b.engine,
      query: b.query || "",
      tags: b.tags || [],
      folder: b.folder || "",
      timestamp: b.timestamp,
      date: new Date(b.timestamp).toISOString(),
    })),
  };

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="bookmarks-${Date.now()}.json"`);
  res.json(exportData);
});

/**
 * @swagger
 * /api/bookmarks/import:
 *   post:
 *     summary: Import bookmarks from CSV
 *     description: Import bookmarks from a CSV file (Title,URL,Engine,Query,Tags)
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [csv]
 *             properties:
 *               csv:
 *                 type: string
 *                 description: CSV content with header row
 *     responses:
 *       200:
 *         description: Import result
 *       400:
 *         description: Invalid CSV
 *       401:
 *         description: Not authenticated
 */
router.post("/api/bookmarks/import", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { csv } = req.body;

  if (!csv || typeof csv !== "string") {
    return res.status(400).json({ error: "Thiếu dữ liệu CSV" });
  }

  const lines = csv.trim().split("\n");
  if (lines.length < 2) {
    return res.status(400).json({ error: "CSV phải có ít nhất 1 dòng header và 1 dòng dữ liệu" });
  }

  // Parse header
  const header = lines[0].toLowerCase();
  if (!header.includes("title") || !header.includes("url")) {
    return res.status(400).json({ error: "CSV phải có cột Title và URL" });
  }

  const allBookmarks = readBookmarks();
  if (!allBookmarks[userId]) {
    allBookmarks[userId] = [];
  }

  const existingUrls = new Set(allBookmarks[userId].map((b) => b.url));
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      // Simple CSV parsing (handles quoted fields)
      const fields = [];
      let current = "";
      let inQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          if (inQuotes && line[j + 1] === '"') {
            current += '"';
            j++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === "," && !inQuotes) {
          fields.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      fields.push(current.trim());

      const [title, url, engine, query, tagsStr] = fields;

      if (!title || !url) {
        errors++;
        continue;
      }

      // Skip duplicate URLs
      if (existingUrls.has(url.trim())) {
        skipped++;
        continue;
      }

      const validEngine = ["tavily", "google", "ddg"].includes(engine?.toLowerCase())
        ? engine.toLowerCase()
        : "tavily";

      const tags = tagsStr
        ? tagsStr.split(";").map((t) => t.replace(/[<>]/g, "").trim().slice(0, 50)).filter(Boolean)
        : [];

      const entry = {
        id: Date.now() + i,
        title: title.replace(/[<>]/g, "").trim().slice(0, 500),
        url: url.trim().slice(0, 2000),
        snippet: "",
        engine: validEngine,
        query: (query || "").replace(/[<>]/g, "").trim().slice(0, 500),
        tags: tags.slice(0, 10),
        timestamp: Date.now(),
      };

      allBookmarks[userId].unshift(entry);
      existingUrls.add(entry.url);
      imported++;
    } catch {
      errors++;
    }
  }

  // Trim to max
  if (allBookmarks[userId].length > MAX_BOOKMARKS_PER_USER) {
    allBookmarks[userId].length = MAX_BOOKMARKS_PER_USER;
  }

  writeBookmarks(allBookmarks);

  logAudit("bookmarks_imported", {
    userId,
    username: req.session.user?.username,
    ip: req.ip,
    detail: `Imported ${imported}, skipped ${skipped}, errors ${errors}`,
  });

  res.json({
    success: true,
    imported,
    skipped,
    errors,
    total: allBookmarks[userId].length,
  });
});

/**
 * @swagger
 * /api/bookmarks/import-html:
 *   post:
 *     summary: Import bookmarks from browser HTML export
 *     description: Import bookmarks from Netscape Bookmark File Format (Chrome, Firefox, Edge export)
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [html]
 *             properties:
 *               html:
 *                 type: string
 *                 description: HTML content from browser bookmark export
 *     responses:
 *       200:
 *         description: Import result
 *       400:
 *         description: Invalid HTML
 *       401:
 *         description: Not authenticated
 */
router.post("/api/bookmarks/import-html", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { html } = req.body;

  if (!html || typeof html !== "string") {
    return res.status(400).json({ error: "Thiếu dữ liệu HTML" });
  }

  const allBookmarks = readBookmarks();
  if (!allBookmarks[userId]) {
    allBookmarks[userId] = [];
  }

  const existingUrls = new Set(allBookmarks[userId].map((b) => b.url));
  let imported = 0;
  let skipped = 0;

  // Parse <A HREF="..." ADD_DATE="...">Title</A> tags
  const linkRegex = /<A\s+[^>]*HREF="([^"]*)"[^>]*>([^<]*)<\/A>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1].trim();
    const title = match[2].trim();

    if (!url || !title || url.startsWith("place:") || url.startsWith("javascript:")) {
      continue;
    }

    // Skip duplicate URLs
    if (existingUrls.has(url)) {
      skipped++;
      continue;
    }

    // Extract ADD_DATE if present
    const addDateMatch = match[0].match(/ADD_DATE="(\d+)"/i);
    const timestamp = addDateMatch ? parseInt(addDateMatch[1]) * 1000 : Date.now();

    const entry = {
      id: Date.now() + imported,
      title: title.replace(/[<>]/g, "").trim().slice(0, 500),
      url: url.slice(0, 2000),
      snippet: "",
      engine: "tavily",
      query: "",
      tags: [],
      timestamp,
    };

    allBookmarks[userId].unshift(entry);
    existingUrls.add(entry.url);
    imported++;
  }

  // Sort by timestamp and trim to max
  allBookmarks[userId].sort((a, b) => b.timestamp - a.timestamp);
  if (allBookmarks[userId].length > MAX_BOOKMARKS_PER_USER) {
    allBookmarks[userId].length = MAX_BOOKMARKS_PER_USER;
  }

  writeBookmarks(allBookmarks);

  logAudit("bookmarks_html_imported", {
    userId,
    username: req.session.user?.username,
    ip: req.ip,
    detail: `Imported ${imported}, skipped ${skipped}`,
  });

  res.json({
    success: true,
    imported,
    skipped,
    total: allBookmarks[userId].length,
  });
});

/**
 * @swagger
 * /api/bookmarks/tags:
 *   get:
 *     summary: Get user's tags
 *     description: Returns all unique tags used by the user
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: List of tags
 */
router.get("/api/bookmarks/tags", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const allBookmarks = readBookmarks();
  const userBookmarks = allBookmarks[userId] || [];

  const tagSet = new Set();
  for (const b of userBookmarks) {
    for (const t of b.tags || []) {
      tagSet.add(t);
    }
  }

  res.json({ tags: [...tagSet].sort() });
});

// ---- Bookmark Folders ----

/**
 * @swagger
 * /api/bookmark-folders:
 *   get:
 *     summary: Get user's bookmark folders
 *     description: Returns all folders with bookmark counts
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Folders list
 */
router.get("/api/bookmark-folders", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const allFolders = readFolders();
  const folders = allFolders[userId] || [];

  // Count bookmarks per folder
  const allBookmarks = readBookmarks();
  const userBookmarks = allBookmarks[userId] || [];
  const counts = {};
  for (const b of userBookmarks) {
    const f = b.folder || "";
    counts[f] = (counts[f] || 0) + 1;
  }

  const result = folders.map((f) => ({
    ...f,
    bookmarkCount: counts[f.name] || 0,
  }));

  // Add uncategorized count
  const uncategorized = counts[""] || 0;

  res.json({ folders: result, uncategorized });
});

/**
 * @swagger
 * /api/bookmark-folders:
 *   post:
 *     summary: Create bookmark folder
 *     description: Create a new folder for organizing bookmarks
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Folder created
 *       400:
 *         description: Invalid input or duplicate name
 */
router.post("/api/bookmark-folders", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { name } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: "Folder name is required" });
  }

  const sanitizedName = name.replace(/[<>]/g, "").trim().slice(0, 100);
  if (sanitizedName.length === 0) {
    return res.status(400).json({ error: "Invalid folder name" });
  }

  const allFolders = readFolders();
  if (!allFolders[userId]) {
    allFolders[userId] = [];
  }

  if (allFolders[userId].length >= MAX_FOLDERS_PER_USER) {
    return res.status(400).json({ error: `Maximum ${MAX_FOLDERS_PER_USER} folders allowed` });
  }

  if (allFolders[userId].find((f) => f.name === sanitizedName)) {
    return res.status(400).json({ error: "Folder already exists" });
  }

  const folder = {
    id: Date.now(),
    name: sanitizedName,
    createdAt: new Date().toISOString(),
  };

  allFolders[userId].push(folder);
  writeFolders(allFolders);

  res.json({ success: true, folder });
});

/**
 * @swagger
 * /api/bookmark-folders/{id}:
 *   put:
 *     summary: Rename bookmark folder
 *     description: Rename an existing folder
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Folder renamed
 *       404:
 *         description: Folder not found
 */
router.put("/api/bookmark-folders/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const folderId = Number(req.params.id);
  const { name } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: "Folder name is required" });
  }

  const sanitizedName = name.replace(/[<>]/g, "").trim().slice(0, 100);

  const allFolders = readFolders();
  const userFolders = allFolders[userId] || [];
  const folder = userFolders.find((f) => f.id === folderId);

  if (!folder) {
    return res.status(404).json({ error: "Folder not found" });
  }

  if (userFolders.find((f) => f.name === sanitizedName && f.id !== folderId)) {
    return res.status(400).json({ error: "Folder name already exists" });
  }

  const oldName = folder.name;
  folder.name = sanitizedName;
  writeFolders(allFolders);

  // Update bookmarks that reference the old folder name
  const allBookmarks = readBookmarks();
  const userBookmarks = allBookmarks[userId] || [];
  for (const b of userBookmarks) {
    if (b.folder === oldName) {
      b.folder = sanitizedName;
    }
  }
  writeBookmarks(allBookmarks);

  res.json({ success: true, folder });
});

/**
 * @swagger
 * /api/bookmark-folders/{id}:
 *   delete:
 *     summary: Delete bookmark folder
 *     description: Delete a folder and uncategorize its bookmarks
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Folder deleted
 *       404:
 *         description: Folder not found
 */
router.delete("/api/bookmark-folders/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const folderId = Number(req.params.id);

  const allFolders = readFolders();
  const userFolders = allFolders[userId] || [];
  const idx = userFolders.findIndex((f) => f.id === folderId);

  if (idx === -1) {
    return res.status(404).json({ error: "Folder not found" });
  }

  const folderName = userFolders[idx].name;
  userFolders.splice(idx, 1);
  allFolders[userId] = userFolders;
  writeFolders(allFolders);

  // Move bookmarks from deleted folder to uncategorized
  const allBookmarks = readBookmarks();
  const userBookmarks = allBookmarks[userId] || [];
  let moved = 0;
  for (const b of userBookmarks) {
    if (b.folder === folderName) {
      b.folder = "";
      moved++;
    }
  }
  writeBookmarks(allBookmarks);

  res.json({ success: true, movedBookmarks: moved });
});

/**
 * @swagger
 * /api/bookmarks/move:
 *   post:
 *     summary: Move bookmarks to folder
 *     description: Move multiple bookmarks to a folder
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bookmarkIds, folder]
 *             properties:
 *               bookmarkIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *               folder:
 *                 type: string
 *     responses:
 *       200:
 *         description: Bookmarks moved
 */
router.post("/api/bookmarks/move", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { bookmarkIds, folder } = req.body;

  if (!Array.isArray(bookmarkIds) || bookmarkIds.length === 0) {
    return res.status(400).json({ error: "bookmarkIds array is required" });
  }

  const targetFolder = (typeof folder === "string" && folder.trim()) ? folder.replace(/[<>]/g, "").trim().slice(0, 100) : "";

  const allBookmarks = readBookmarks();
  const userBookmarks = allBookmarks[userId] || [];
  let moved = 0;

  for (const id of bookmarkIds) {
    const bookmark = userBookmarks.find((b) => b.id === Number(id));
    if (bookmark) {
      bookmark.folder = targetFolder;
      moved++;
    }
  }

  writeBookmarks(allBookmarks);
  res.json({ success: true, moved });
});

/**
 * @swagger
 * /api/bookmarks/bulk-tag:
 *   post:
 *     summary: Add tags to multiple bookmarks
 *     description: Add tags to multiple bookmarks at once
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bookmarkIds, tags]
 *             properties:
 *               bookmarkIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Tags added
 */
router.post("/api/bookmarks/bulk-tag", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { bookmarkIds, tags } = req.body;

  if (!Array.isArray(bookmarkIds) || bookmarkIds.length === 0) {
    return res.status(400).json({ error: "bookmarkIds array is required" });
  }
  if (!Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: "tags array is required" });
  }

  const sanitizedTags = tags
    .filter((t) => typeof t === "string")
    .map((t) => t.replace(/[<>]/g, "").trim().slice(0, 50))
    .filter(Boolean)
    .slice(0, 10);

  const allBookmarks = readBookmarks();
  const userBookmarks = allBookmarks[userId] || [];
  let updated = 0;

  for (const id of bookmarkIds) {
    const bookmark = userBookmarks.find((b) => b.id === Number(id));
    if (bookmark) {
      const existingTags = bookmark.tags || [];
      bookmark.tags = [...new Set([...existingTags, ...sanitizedTags])].slice(0, 10);
      updated++;
    }
  }

  writeBookmarks(allBookmarks);
  res.json({ success: true, updated });
});

/**
 * @swagger
 * /api/bookmarks/duplicates:
 *   get:
 *     summary: Find duplicate bookmarks
 *     description: Find bookmarks with duplicate URLs
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Duplicate bookmarks grouped by URL
 */
router.get("/api/bookmarks/duplicates", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const allBookmarks = readBookmarks();
  const userBookmarks = allBookmarks[userId] || [];

  // Group by URL
  const urlMap = {};
  for (const b of userBookmarks) {
    const url = (b.url || "").trim();
    if (!url) continue;
    if (!urlMap[url]) urlMap[url] = [];
    urlMap[url].push(b);
  }

  // Find duplicates
  const duplicates = {};
  for (const [url, bookmarks] of Object.entries(urlMap)) {
    if (bookmarks.length > 1) {
      duplicates[url] = bookmarks;
    }
  }

  const duplicateCount = Object.values(duplicates).reduce((sum, arr) => sum + arr.length - 1, 0);

  res.json({
    duplicates,
    duplicateCount,
    totalUrls: Object.keys(duplicates).length,
  });
});

/**
 * @swagger
 * /api/bookmarks/merge-duplicates:
 *   post:
 *     summary: Merge duplicate bookmarks
 *     description: Keep the first bookmark for each URL and delete the rest, merging tags
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Duplicates merged
 */
router.post("/api/bookmarks/merge-duplicates", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const allBookmarks = readBookmarks();
  const userBookmarks = allBookmarks[userId] || [];

  // Group by URL
  const urlMap = {};
  for (const b of userBookmarks) {
    const url = (b.url || "").trim();
    if (!url) continue;
    if (!urlMap[url]) urlMap[url] = [];
    urlMap[url].push(b);
  }

  let merged = 0;
  const kept = [];

  for (const [url, bookmarks] of Object.entries(urlMap)) {
    if (bookmarks.length === 1) {
      kept.push(bookmarks[0]);
      continue;
    }

    // Keep the first (most recent) bookmark, merge tags from all
    const primary = bookmarks[0];
    const allTags = new Set();
    for (const b of bookmarks) {
      for (const t of b.tags || []) {
        allTags.add(t);
      }
    }
    primary.tags = [...allTags].slice(0, 10);
    kept.push(primary);
    merged += bookmarks.length - 1;
  }

  // Sort by timestamp descending
  kept.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  allBookmarks[userId] = kept;
  writeBookmarks(allBookmarks);

  logAudit("bookmarks_duplicates_merged", {
    userId,
    username: req.session.user?.username,
    ip: req.ip,
    detail: `Merged ${merged} duplicate bookmarks`,
  });

  res.json({ success: true, merged, remaining: kept.length });
});

export default router;
