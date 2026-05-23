// Graceful degradation middleware — serve cached results when external APIs fail
// Wraps route handlers to catch errors and fall back to cached data

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, "..", "result_cache.json");

function readCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    }
  } catch {
    // ignore
  }
  return {};
}

function makeCacheKey(query, engine) {
  const normalized = `${(query || "").trim().toLowerCase()}|${engine || "tavily"}`;
  return crypto.createHash("md5").update(normalized).digest("hex");
}

/**
 * Wrap a route handler with graceful degradation.
 * If the handler throws or returns an error, fall back to cached results.
 *
 * Usage:
 *   router.get("/api/search", gracefulDegradation(async (req, res) => {
 *     const results = await fetchFromExternalAPI(req.query.q);
 *     res.json({ results });
 *   }));
 */
export function gracefulDegradation(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      console.warn(`API error, attempting graceful degradation: ${err.message}`);

      // Try to serve from cache
      const query = req.query.q || req.query.query || req.body?.query;
      const engine = req.query.engine || req.body?.engine;

      if (query) {
        const key = makeCacheKey(query, engine);
        const cache = readCache();
        const entry = cache[key];

        if (entry) {
          // Allow stale cache up to 24 hours
          const age = Date.now() - new Date(entry.timestamp).getTime();
          const maxStale = 24 * 60 * 60 * 1000;

          if (age < maxStale) {
            console.warn(`Serving stale cache for query "${query}" (age: ${Math.round(age / 60000)}min)`);
            return res.json({
              results: entry.results,
              query: entry.query,
              engine: entry.engine,
              resultCount: entry.results.length,
              stale: true,
              cacheAge: age,
              error: "External API unavailable — showing cached results",
            });
          }
        }
      }

      // No cache available — propagate error
      next(err);
    }
  };
}

/**
 * Middleware that adds cache-fallback headers to responses.
 * Use after a successful response to indicate the data was fresh.
 */
export function freshDataHeader(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (body && !body.stale) {
      res.setHeader("X-Data-Freshness", "fresh");
    }
    return originalJson(body);
  };
  next();
}
