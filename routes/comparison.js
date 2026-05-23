import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";
import { validateSearchQuery } from "../middleware/validation.js";
import { rateLimitSearch } from "../middleware/rateLimit.js";
import { searchCache } from "../utils/cache.js";
import { logSearchHistory } from "./history.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "comparison_history.json");
const MAX_HISTORY = 30;

const router = Router();

function readHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading comparison history:", e.message);
  }
  return {};
}

function writeHistory(data) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), "utf8");
}

// Comparison API: search across multiple engines in parallel
router.get("/api/compare", checkAuthenticated, rateLimitSearch, validateSearchQuery, async (req, res) => {
  const query = req.query.q;
  const engines = (req.query.engines || "tavily,google,ddg").split(",").map(e => e.trim().toLowerCase());

  const results = {};
  const errors = {};

  const fetchEngine = async (engine) => {
    try {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      let url;
      switch (engine) {
        case "tavily":
          url = `${baseUrl}/searchApiTavily?q=${encodeURIComponent(query)}`;
          break;
        case "google":
          url = `${baseUrl}/searchApiGo?q=${encodeURIComponent(query)}`;
          break;
        case "ddg":
          url = `${baseUrl}/searchApiDDG?q=${encodeURIComponent(query)}`;
          break;
        default:
          errors[engine] = "Unknown engine";
          return;
      }

      const resp = await fetch(url, {
        headers: { cookie: req.headers.cookie },
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        errors[engine] = `HTTP ${resp.status}`;
        return;
      }

      const data = await resp.json();

      // Normalize results across engines
      let items = [];
      if (engine === "tavily") {
        items = (data.results || []).map(r => ({
          title: r.title || "",
          url: r.url || "",
          snippet: r.content || "",
          score: r.score || 0,
        }));
      } else if (engine === "google") {
        items = (data.items || []).map(r => ({
          title: r.title || "",
          url: r.link || "",
          snippet: r.snippet || "",
          score: 0,
        }));
      } else if (engine === "ddg") {
        items = (data.results || []).map(r => ({
          title: r.title || "",
          url: r.url || "",
          snippet: r.content || "",
          score: r.match_percentage || 0,
        }));
      }

      results[engine] = { items, total: items.length };
      logSearchHistory(req.session.user.id, query, engine, items.length);
    } catch (err) {
      errors[engine] = err.message || "Search failed";
    }
  };

  await Promise.all(engines.map(fetchEngine));

  res.json({ query, engines: engines.length, results, errors });
});

// Save comparison to history
router.post("/api/compare/save", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { query, engines, results, errors } = req.body;

  if (!query || !results) {
    return res.status(400).json({ error: "Missing query or results" });
  }

  const sanitizedQuery = (query || "").toString().replace(/[<>]/g, "").trim().slice(0, 500);
  const allHistory = readHistory();
  if (!allHistory[userId]) allHistory[userId] = [];

  const entry = {
    id: Date.now(),
    query: sanitizedQuery,
    engines: Array.isArray(engines) ? engines.map(e => String(e).slice(0, 20)) : [],
    results: results || {},
    errors: errors || {},
    timestamp: Date.now(),
  };

  allHistory[userId].unshift(entry);
  if (allHistory[userId].length > MAX_HISTORY) {
    allHistory[userId].length = MAX_HISTORY;
  }

  writeHistory(allHistory);
  res.json({ success: true, comparison: entry });
});

// List comparison history
router.get("/api/compare/history", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const allHistory = readHistory();
  const userHistory = allHistory[userId] || [];

  const summaries = userHistory.map((h) => {
    let totalResults = 0;
    if (h.results && typeof h.results === "object") {
      for (const engine of Object.values(h.results)) {
        if (engine && engine.items) totalResults += engine.items.length;
      }
    }
    return {
      id: h.id,
      query: h.query,
      engines: h.engines,
      resultCount: totalResults,
      hasErrors: h.errors && Object.keys(h.errors).length > 0,
      timestamp: h.timestamp,
    };
  });

  res.json(summaries);
});

// Get single comparison detail
router.get("/api/compare/history/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const id = Number(req.params.id);
  const allHistory = readHistory();
  const userHistory = allHistory[userId] || [];
  const comparison = userHistory.find((h) => h.id === id);

  if (!comparison) {
    return res.status(404).json({ error: "Comparison not found" });
  }

  res.json(comparison);
});

// Delete comparison from history
router.delete("/api/compare/history/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const id = Number(req.params.id);
  const allHistory = readHistory();
  const userHistory = allHistory[userId] || [];
  const index = userHistory.findIndex((h) => h.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Comparison not found" });
  }

  userHistory.splice(index, 1);
  allHistory[userId] = userHistory;
  writeHistory(allHistory);
  res.json({ success: true });
});

export default router;
