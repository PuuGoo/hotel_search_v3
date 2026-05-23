// API response caching middleware — cache GET responses at middleware level
// Uses LRU eviction with configurable TTL per route

const DEFAULT_TTL_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX_SIZE = 500;

class ResponseCache {
  constructor({ maxSize = DEFAULT_MAX_SIZE, ttlMs = DEFAULT_TTL_MS } = {}) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTtlMs = ttlMs;
    this.hits = 0;
    this.misses = 0;
  }

  _makeKey(req) {
    const user = req.session?.user?.id || "anon";
    return `${user}:${req.method}:${req.originalUrl}`;
  }

  get(req) {
    const key = this._makeKey(req);
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    // LRU: move to end
    this.cache.delete(key);
    this.cache.set(key, entry);
    entry.hits++;
    this.hits++;
    return entry.data;
  }

  set(req, statusCode, headers, body) {
    const key = this._makeKey(req);

    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    while (this.cache.size >= this.maxSize) {
      const lruKey = this.cache.keys().next().value;
      this.cache.delete(lruKey);
    }

    this.cache.set(key, {
      data: { statusCode, headers, body },
      expiresAt: Date.now() + this.defaultTtlMs,
      hits: 0,
      createdAt: Date.now(),
    });
  }

  invalidate(req) {
    const prefix = `${req.session?.user?.id || "anon"}:${req.method}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix) && key.includes(req.path)) {
        this.cache.delete(key);
      }
    }
  }

  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      cacheHits: this.hits,
      cacheMisses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? ((this.hits / (this.hits + this.misses)) * 100).toFixed(1) + "%"
        : "0%",
    };
  }
}

const globalCache = new ResponseCache();

export function responseCache(options = {}) {
  const cache = options.cache || globalCache;
  const ttlMs = options.ttlMs;
  const skipPaths = options.skipPaths || [];

  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== "GET") {
      return next();
    }

    // Skip specified paths
    if (skipPaths.some((p) => req.path.startsWith(p))) {
      return next();
    }

    // Skip if user opts out
    if (req.headers["cache-control"] === "no-cache") {
      res.setHeader("X-Cache", "BYPASS");
      return next();
    }

    // Check cache
    const cached = cache.get(req);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("X-Cache-Hits", String(cached.hits || 0));
      for (const [key, value] of Object.entries(cached.headers || {})) {
        if (key.toLowerCase() !== "x-cache") {
          res.setHeader(key, value);
        }
      }
      return res.status(cached.statusCode).json(cached.body);
    }

    // Cache miss — intercept res.json()
    res.setHeader("X-Cache", "MISS");
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const headers = {};
        for (const key of ["content-type", "etag", "cache-control"]) {
          const val = res.getHeader(key);
          if (val) headers[key] = val;
        }
        cache.set(req, res.statusCode, headers, body);
      }
      return originalJson(body);
    };

    next();
  };
}

export function getCacheStats() {
  return globalCache.stats();
}

export function clearCache() {
  globalCache.clear();
}

export { ResponseCache };
