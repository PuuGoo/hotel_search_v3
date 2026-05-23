// Geocoding routes — proxy Nominatim geocoding with caching

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";

const router = Router();

// In-memory cache for geocoding results (address -> {lat, lng, timestamp})
const geoCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 1000;

function cleanCache() {
  const now = Date.now();
  for (const [key, val] of geoCache) {
    if (now - val.timestamp > CACHE_TTL) geoCache.delete(key);
  }
  // Evict oldest if over limit
  if (geoCache.size > MAX_CACHE_SIZE) {
    const oldest = [...geoCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < oldest.length - MAX_CACHE_SIZE; i++) {
      geoCache.delete(oldest[i][0]);
    }
  }
}

/**
 * GET /api/geocode?q=address
 * Geocode an address using Nominatim with caching.
 */
router.get("/api/geocode", checkAuthenticated, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) {
    return res.status(400).json({ error: "q parameter is required" });
  }

  const cacheKey = q.toLowerCase();
  const cached = geoCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json({ lat: cached.lat, lng: cached.lng, cached: true });
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "HotelSearchApp/1.0" },
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      return res.status(502).json({ error: "Geocoding service unavailable" });
    }

    const data = await resp.json();
    if (data.length === 0) {
      return res.json({ lat: null, lng: null, found: false });
    }

    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);

    geoCache.set(cacheKey, { lat, lng, timestamp: Date.now() });
    cleanCache();

    res.json({ lat, lng, found: true, cached: false });
  } catch (err) {
    res.status(502).json({ error: "Geocoding request failed" });
  }
});

/**
 * POST /api/geocode/batch
 * Batch geocode multiple addresses.
 * Body: { addresses: ["addr1", "addr2", ...] }
 */
router.post("/api/geocode/batch", checkAuthenticated, async (req, res) => {
  const { addresses } = req.body;
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return res.status(400).json({ error: "addresses array is required" });
  }

  if (addresses.length > 20) {
    return res.status(400).json({ error: "Maximum 20 addresses per batch" });
  }

  const results = [];
  for (const addr of addresses) {
    const cacheKey = addr.toLowerCase().trim();
    const cached = geoCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      results.push({ address: addr, lat: cached.lat, lng: cached.lng, cached: true });
      continue;
    }

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "HotelSearchApp/1.0" },
        signal: AbortSignal.timeout(5000),
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.length > 0) {
          const lat = parseFloat(data[0].lat);
          const lng = parseFloat(data[0].lon);
          geoCache.set(cacheKey, { lat, lng, timestamp: Date.now() });
          results.push({ address: addr, lat, lng, found: true, cached: false });
        } else {
          results.push({ address: addr, lat: null, lng: null, found: false });
        }
      } else {
        results.push({ address: addr, lat: null, lng: null, error: "service unavailable" });
      }
    } catch {
      results.push({ address: addr, lat: null, lng: null, error: "request failed" });
    }

    // Rate limit between requests
    await new Promise((r) => setTimeout(r, 200));
  }

  cleanCache();
  res.json({ results, total: results.length });
});

/**
 * GET /api/geocode/stats
 * Get geocoding cache stats.
 */
router.get("/api/geocode/stats", checkAuthenticated, (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  res.json({ cacheSize: geoCache.size, maxCacheSize: MAX_CACHE_SIZE, ttl: CACHE_TTL });
});

export default router;
