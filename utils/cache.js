/**
 * LRU in-memory cache with TTL for search results.
 * Evicts least-recently-used entries when maxSize is reached.
 */
export class SearchCache {
  constructor({ maxSize = 200, ttlMs = 5 * 60 * 1000 } = {}) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.hits = 0;
    this.misses = 0;
  }

  _key(engine, query) {
    return `${engine}:${query.toLowerCase().trim()}`;
  }

  get(engine, query) {
    const key = this._key(engine, query);
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
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    entry.hits++;
    this.hits++;
    return entry.data;
  }

  set(engine, query, data) {
    const key = this._key(engine, query);

    // If key exists, delete it first so re-insertion goes to end
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict LRU entries until we have room
    while (this.cache.size >= this.maxSize) {
      const lruKey = this.cache.keys().next().value;
      this.cache.delete(lruKey);
    }

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.ttlMs,
      hits: 0,
      createdAt: Date.now(),
    });
  }

  has(engine, query) {
    const key = this._key(engine, query);
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(engine, query) {
    return this.cache.delete(this._key(engine, query));
  }

  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  size() {
    // Clean expired entries on size check
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
    return this.cache.size;
  }

  stats() {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
    }
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      entryHits: totalHits,
      cacheHits: this.hits,
      cacheMisses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? ((this.hits / (this.hits + this.misses)) * 100).toFixed(1) + "%"
        : "0%",
    };
  }
}

export const searchCache = new SearchCache();
