import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const MAX_HISTORY_PER_USER = 100;

const router = Router();

function readHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
      if (data && typeof data === "object" && !Array.isArray(data)) return data;
    }
  } catch (e) {
    console.error("Error reading search history:", e.message);
  }
  return {};
}

function writeHistory(data) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), "utf8");
}

// Exported helper to log search history from other modules (e.g., search routes)
export function logSearchHistory(userId, query, engine, resultCount = 0) {
  try {
    const allHistory = readHistory();
    if (!Array.isArray(allHistory[userId])) {
      allHistory[userId] = [];
    }
    allHistory[userId].unshift({
      id: Date.now(),
      query: query.replace(/[<>]/g, "").trim().slice(0, 500),
      engine,
      resultCount,
      timestamp: Date.now(),
    });
    if (allHistory[userId].length > MAX_HISTORY_PER_USER) {
      allHistory[userId].length = MAX_HISTORY_PER_USER;
    }
    writeHistory(allHistory);
  } catch (e) {
    console.error("Error logging search history:", e.message);
  }
}

/**
 * @swagger
 * /api/search-history:
 *   get:
 *     summary: Get search history
 *     description: Returns the authenticated user's search history
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
 *     responses:
 *       200:
 *         description: Search history list with pagination
 *       401:
 *         description: Not authenticated
 */
router.get("/api/search-history", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_HISTORY_PER_USER);
  const engineFilter = req.query.engine;

  const allHistory = readHistory();
  let items = allHistory[userId] || [];

  if (engineFilter && ["tavily", "google", "ddg"].includes(engineFilter)) {
    items = items.filter((h) => h.engine === engineFilter);
  }

  // Sort by timestamp descending (newest first)
  items.sort((a, b) => b.timestamp - a.timestamp);

  const total = items.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const paged = items.slice(offset, offset + limit);

  res.json({
    history: paged,
    total,
    page,
    limit,
    totalPages,
    hasMore: page < totalPages,
  });
});

/**
 * @swagger
 * /api/search-history/export:
 *   get:
 *     summary: Export search history as CSV
 *     description: Downloads the authenticated user's search history as a CSV file
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: engine
 *         schema:
 *           type: string
 *           enum: [tavily, google, ddg]
 *         description: Filter by search engine
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
router.get("/api/search-history/export", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const engineFilter = req.query.engine;

  const allHistory = readHistory();
  let items = allHistory[userId] || [];

  if (engineFilter && ["tavily", "google", "ddg"].includes(engineFilter)) {
    items = items.filter((h) => h.engine === engineFilter);
  }

  items.sort((a, b) => b.timestamp - a.timestamp);

  const escapeCsv = (val) => {
    const str = String(val ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = "Query,Engine,Results,Timestamp";
  const rows = items.map((h) =>
    [escapeCsv(h.query), escapeCsv(h.engine), h.resultCount, new Date(h.timestamp).toISOString()].join(",")
  );

  const csv = [header, ...rows].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="search-history-${Date.now()}.csv"`);
  res.send(csv);
});

/**
 * @swagger
 * /api/search-history/export-json:
 *   get:
 *     summary: Export search history as JSON
 *     description: Downloads the authenticated user's search history as a JSON file
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: engine
 *         schema:
 *           type: string
 *           enum: [tavily, google, ddg]
 *         description: Filter by search engine
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
router.get("/api/search-history/export-json", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const engineFilter = req.query.engine;

  const allHistory = readHistory();
  let items = allHistory[userId] || [];

  if (engineFilter && ["tavily", "google", "ddg"].includes(engineFilter)) {
    items = items.filter((h) => h.engine === engineFilter);
  }

  items.sort((a, b) => b.timestamp - a.timestamp);

  const exportData = {
    exportedAt: new Date().toISOString(),
    totalEntries: items.length,
    history: items.map((h) => ({
      query: h.query,
      engine: h.engine,
      resultCount: h.resultCount,
      timestamp: h.timestamp,
      date: new Date(h.timestamp).toISOString(),
    })),
  };

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="search-history-${Date.now()}.json"`);
  res.json(exportData);
});

/**
 * @swagger
 * /api/search-history/import:
 *   post:
 *     summary: Import search history from CSV
 *     description: Import search history entries from a CSV file
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
 *                 description: CSV content with header row (Query,Engine,Results,Timestamp)
 *     responses:
 *       200:
 *         description: Import result
 *       400:
 *         description: Invalid CSV
 *       401:
 *         description: Not authenticated
 */
router.post("/api/search-history/import", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { csv } = req.body;

  if (!csv || typeof csv !== "string") {
    return res.status(400).json({ error: "Thiếu dữ liệu CSV" });
  }

  const lines = csv.trim().split("\n");
  if (lines.length < 2) {
    return res.status(400).json({ error: "CSV phải có ít nhất 1 dòng header và 1 dòng dữ liệu" });
  }

  const header = lines[0].toLowerCase();
  if (!header.includes("query") || !header.includes("engine")) {
    return res.status(400).json({ error: "CSV phải có cột Query và Engine" });
  }

  const allHistory = readHistory();
  if (!Array.isArray(allHistory[userId])) {
    allHistory[userId] = [];
  }

  let imported = 0;
  let errors = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
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

      const [query, engine, resultCount, timestamp] = fields;

      if (!query || !engine) {
        errors++;
        continue;
      }

      const validEngine = ["tavily", "google", "ddg"].includes(engine?.toLowerCase())
        ? engine.toLowerCase()
        : "tavily";

      const entry = {
        id: Date.now() + i,
        query: query.replace(/[<>]/g, "").trim().slice(0, 500),
        engine: validEngine,
        resultCount: parseInt(resultCount, 10) || 0,
        timestamp: timestamp ? new Date(timestamp).getTime() || Date.now() : Date.now(),
      };

      allHistory[userId].unshift(entry);
      imported++;
    } catch {
      errors++;
    }
  }

  if (allHistory[userId].length > MAX_HISTORY_PER_USER) {
    allHistory[userId].length = MAX_HISTORY_PER_USER;
  }

  writeHistory(allHistory);

  res.json({
    success: true,
    imported,
    errors,
    total: allHistory[userId].length,
  });
});

/**
 * @swagger
 * /api/search-history:
 *   post:
 *     summary: Save search to history
 *     description: Save a search query to the user's history
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [query, engine]
 *             properties:
 *               query:
 *                 type: string
 *               engine:
 *                 type: string
 *                 enum: [tavily, google, ddg]
 *               resultCount:
 *                 type: integer
 *     responses:
 *       200:
 *         description: History entry saved
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Not authenticated
 */
router.post("/api/search-history", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { query, engine, resultCount } = req.body;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return res.status(400).json({ error: "Thiếu query" });
  }
  if (!engine || !["tavily", "google", "ddg"].includes(engine)) {
    return res.status(400).json({ error: "Engine không hợp lệ" });
  }

  const sanitizedQuery = query.replace(/[<>]/g, "").trim().slice(0, 500);

  const allHistory = readHistory();
  if (!Array.isArray(allHistory[userId])) {
    allHistory[userId] = [];
  }

  const entry = {
    id: Date.now(),
    query: sanitizedQuery,
    engine,
    resultCount: typeof resultCount === "number" ? resultCount : 0,
    timestamp: Date.now(),
  };

  allHistory[userId].unshift(entry);

  // Trim to max history
  if (allHistory[userId].length > MAX_HISTORY_PER_USER) {
    allHistory[userId].length = MAX_HISTORY_PER_USER;
  }

  writeHistory(allHistory);
  res.json({ success: true, entry });
});

/**
 * @swagger
 * /api/search-history/{id}:
 *   delete:
 *     summary: Delete history entry
 *     description: Delete a specific search history entry
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
 *         description: Entry deleted
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Entry not found
 */
router.delete("/api/search-history/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const entryId = Number(req.params.id);

  const allHistory = readHistory();
  const userHistory = allHistory[userId] || [];
  const idx = userHistory.findIndex((h) => h.id === entryId);

  if (idx === -1) {
    return res.status(404).json({ error: "Không tìm thấy" });
  }

  userHistory.splice(idx, 1);
  allHistory[userId] = userHistory;
  writeHistory(allHistory);
  res.json({ success: true });
});

/**
 * @swagger
 * /api/search-history:
 *   delete:
 *     summary: Clear search history
 *     description: Clear all search history for the authenticated user
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: History cleared
 *       401:
 *         description: Not authenticated
 */
router.delete("/api/search-history", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const allHistory = readHistory();
  allHistory[userId] = [];
  writeHistory(allHistory);
  res.json({ success: true });
});

/**
 * @swagger
 * /api/admin/search-history:
 *   get:
 *     summary: Get all search history (admin)
 *     description: Returns search history for all users (admin only)
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: All search history
 *       403:
 *         description: Not an admin
 */
router.get("/api/admin/search-history", checkRole("admin"), (req, res) => {
  const allHistory = readHistory();
  const summary = {};

  for (const [userId, entries] of Object.entries(allHistory)) {
    summary[userId] = {
      count: entries.length,
      latest: entries.length > 0 ? entries[0].timestamp : null,
      engines: [...new Set(entries.map((e) => e.engine))],
    };
  }

  res.json({ users: summary, totalEntries: Object.values(allHistory).reduce((sum, e) => sum + e.length, 0) });
});

export default router;
