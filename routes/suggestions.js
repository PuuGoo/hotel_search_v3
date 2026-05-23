import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");

const router = Router();

function readHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading history:", e.message);
  }
  return [];
}

// Get search suggestions based on prefix
router.get("/api/suggestions", checkAuthenticated, (req, res) => {
  const { q, limit } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json([]);
  }

  const query = q.trim().toLowerCase();
  const maxResults = Math.min(parseInt(limit) || 10, 20);
  const history = readHistory();
  const userHistory = history.filter((h) => h.userId === req.session.user.id);

  // Find matching queries
  const matches = new Map();
  for (const h of userHistory) {
    const hQuery = (h.query || "").toLowerCase();
    if (hQuery.includes(query) && !matches.has(hQuery)) {
      matches.set(hQuery, {
        text: h.query,
        engine: h.engine || "tavily",
        lastUsed: h.timestamp,
        count: 1,
      });
    } else if (matches.has(hQuery)) {
      matches.get(hQuery).count++;
    }
  }

  // Sort by relevance (starts-with first, then by count)
  const results = Array.from(matches.values()).sort((a, b) => {
    const aStarts = a.text.toLowerCase().startsWith(query) ? 0 : 1;
    const bStarts = b.text.toLowerCase().startsWith(query) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return b.count - a.count;
  });

  res.json(results.slice(0, maxResults));
});

// Get popular searches across all users
router.get("/api/suggestions/popular", checkAuthenticated, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 20);
  const history = readHistory();

  // Count queries across all users
  const queryCount = new Map();
  for (const h of history) {
    const q = (h.query || "").toLowerCase().trim();
    if (q.length >= 2) {
      queryCount.set(q, (queryCount.get(q) || 0) + 1);
    }
  }

  const popular = Array.from(queryCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([query, count]) => ({ query, count }));

  res.json(popular);
});

/**
 * @swagger
 * /api/suggestions/smart:
 *   get:
 *     summary: Get smart search suggestions
 *     description: Returns AI-powered suggestions based on search patterns, recent trends, and related queries
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Current search query for context
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 8
 *         description: Max results
 *     responses:
 *       200:
 *         description: Smart suggestions
 *       401:
 *         description: Not authenticated
 */
router.get("/api/suggestions/smart", checkAuthenticated, (req, res) => {
  const { q, limit } = req.query;
  const maxResults = Math.min(parseInt(limit) || 8, 15);
  const history = readHistory();
  const userId = req.session.user.id;
  const userHistory = history.filter((h) => h.userId === userId);
  const now = Date.now();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;

  const suggestions = [];
  const seen = new Set();

  function addSuggestion(text, reason, score) {
    const key = text.toLowerCase().trim();
    if (key.length < 2) return;
    if (seen.has(key)) {
      const existing = suggestions.find((s) => s.text.toLowerCase().trim() === key);
      if (existing && score > existing.score) {
        existing.reason = reason;
        existing.score = score;
      }
      return;
    }
    seen.add(key);
    suggestions.push({ text: text.trim(), reason, score });
  }

  // 1. Recent unique queries (last 7 days, high score)
  const recentQueries = userHistory
    .filter((h) => now - h.timestamp < oneWeek)
    .sort((a, b) => b.timestamp - a.timestamp);

  for (const h of recentQueries.slice(0, 5)) {
    addSuggestion(h.query, "recent", 10);
  }

  // 2. Frequent queries (personal top queries)
  const queryFreq = {};
  for (const h of userHistory) {
    const key = (h.query || "").toLowerCase().trim();
    if (key.length >= 2) {
      queryFreq[key] = (queryFreq[key] || 0) + 1;
    }
  }

  const frequent = Object.entries(queryFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  for (const [query, count] of frequent) {
    addSuggestion(query, "frequent", 5 + Math.min(count, 10));
  }

  // 3. If query provided, find related queries (same engine, similar terms)
  if (q && q.trim().length >= 2) {
    const queryLower = q.trim().toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length >= 2);

    // Find queries that share words with the input
    const related = new Map();
    for (const h of userHistory) {
      const hQuery = (h.query || "").toLowerCase();
      if (hQuery === queryLower) continue;

      const hWords = hQuery.split(/\s+/);
      let matchScore = 0;
      for (const word of queryWords) {
        if (hWords.some((w) => w.includes(word) || word.includes(w))) {
          matchScore++;
        }
      }

      if (matchScore > 0 && !related.has(hQuery)) {
        related.set(hQuery, { query: h.query, score: matchScore, engine: h.engine });
      }
    }

    const relatedSorted = Array.from(related.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    for (const r of relatedSorted) {
      addSuggestion(r.query, "related", 3 + r.score);
    }

    // Popular queries that match
    const allQueryFreq = {};
    for (const h of history) {
      const key = (h.query || "").toLowerCase().trim();
      if (key.length >= 2) {
        allQueryFreq[key] = (allQueryFreq[key] || 0) + 1;
      }
    }

    const popularMatching = Object.entries(allQueryFreq)
      .filter(([query]) => {
        const qWords = query.split(/\s+/);
        return queryWords.some((w) => qWords.some((qw) => qw.includes(w) || w.includes(qw)));
      })
      .filter(([query]) => query !== queryLower)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    for (const [query, count] of popularMatching) {
      addSuggestion(query, "popular", 2 + Math.min(count, 5));
    }
  }

  // 4. Trending (queries from last 24h across all users)
  const oneDay = 24 * 60 * 60 * 1000;
  const recentAll = history.filter((h) => now - h.timestamp < oneDay);
  const trendingFreq = {};
  for (const h of recentAll) {
    const key = (h.query || "").toLowerCase().trim();
    if (key.length >= 2) {
      trendingFreq[key] = (trendingFreq[key] || 0) + 1;
    }
  }

  const trending = Object.entries(trendingFreq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  for (const [query, count] of trending) {
    addSuggestion(query, "trending", 1 + Math.min(count, 5));
  }

  // Sort by score and return
  suggestions.sort((a, b) => b.score - a.score);
  res.json(suggestions.slice(0, maxResults));
});

export default router;
