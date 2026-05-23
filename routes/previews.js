// Preview routes — fetch and cache webpage previews for search results

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import crypto from "crypto";

const router = Router();

// Preview cache (URL -> { title, description, image, favicon, fetchedAt })
const previewCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const MAX_CACHE = 500;

function cleanCache() {
  const now = Date.now();
  for (const [key, val] of previewCache) {
    if (now - val.fetchedAt > CACHE_TTL) previewCache.delete(key);
  }
  if (previewCache.size > MAX_CACHE) {
    const entries = [...previewCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    for (let i = 0; i < entries.length - MAX_CACHE; i++) previewCache.delete(entries[i][0]);
  }
}

/**
 * Extract meta tags from HTML.
 */
function extractMeta(html) {
  const meta = {};

  // Title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) meta.title = titleMatch[1].trim().substring(0, 200);

  // Meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
  if (descMatch) meta.description = descMatch[1].trim().substring(0, 500);

  // OG image
  const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (ogMatch) meta.image = ogMatch[1].trim();

  // OG title
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogTitleMatch && !meta.title) meta.title = ogTitleMatch[1].trim().substring(0, 200);

  // Favicon
  const faviconMatch = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i);
  if (faviconMatch) meta.favicon = faviconMatch[1].trim();

  return meta;
}

/**
 * GET /api/preview?url=https://...
 * Get a preview of a webpage (title, description, image).
 */
router.get("/api/preview", checkAuthenticated, async (req, res) => {
  const url = (req.query.url || "").trim();

  if (!url) {
    return res.status(400).json({ error: "url parameter is required" });
  }

  // Validate URL
  let parsed;
  try {
    parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ error: "Only HTTP/HTTPS URLs are supported" });
    }
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  // Check cache
  const cacheKey = parsed.hostname + parsed.pathname;
  const cached = previewCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return res.json({ ...cached, cached: true });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HotelSearchBot/1.0)",
        "Accept": "text/html",
      },
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });

    if (!response.ok) {
      return res.json({ url, title: null, description: null, error: `HTTP ${response.status}` });
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return res.json({ url, title: null, description: null, error: "Not an HTML page" });
    }

    const html = await response.text();
    const meta = extractMeta(html);

    const preview = {
      url,
      title: meta.title || null,
      description: meta.description || null,
      image: meta.image || null,
      favicon: meta.favicon || null,
      fetchedAt: Date.now(),
    };

    previewCache.set(cacheKey, preview);
    cleanCache();

    res.json({ ...preview, cached: false });
  } catch (err) {
    res.json({ url, title: null, description: null, error: "Failed to fetch preview" });
  }
});

/**
 * POST /api/preview/batch
 * Get previews for multiple URLs (max 5).
 * Body: { urls: ["url1", "url2"] }
 */
router.post("/api/preview/batch", checkAuthenticated, async (req, res) => {
  const { urls } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "urls array is required" });
  }

  if (urls.length > 5) {
    return res.status(400).json({ error: "Maximum 5 URLs per batch" });
  }

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const cacheKey = new URL(url).hostname + new URL(url).pathname;
      const cached = previewCache.get(cacheKey);
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
        return { ...cached, cached: true };
      }

      try {
        const response = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; HotelSearchBot/1.0)" },
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) return { url, error: `HTTP ${response.status}` };

        const html = await response.text();
        const meta = extractMeta(html);
        const preview = { url, ...meta, fetchedAt: Date.now() };
        previewCache.set(cacheKey, preview);
        return { ...preview, cached: false };
      } catch {
        return { url, error: "Failed to fetch" };
      }
    })
  );

  res.json({
    results: results.map((r, i) => (r.status === "fulfilled" ? r.value : { url: urls[i], error: "Request failed" })),
  });
});

export default router;
