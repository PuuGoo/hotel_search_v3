import { describe, test, expect, beforeEach } from "@jest/globals";
import { SearchCache } from "../utils/cache.js";

describe("LRU Cache", () => {
  let cache;

  beforeEach(() => {
    cache = new SearchCache({ maxSize: 3, ttlMs: 5000 });
  });

  test("Stores and retrieves entries", () => {
    cache.set("tavily", "hotel hanoi", { results: [1] });
    const data = cache.get("tavily", "hotel hanoi");
    expect(data).toEqual({ results: [1] });
  });

  test("Returns null for missing entries", () => {
    expect(cache.get("tavily", "missing")).toBeNull();
  });

  test("Returns null for expired entries", () => {
    const shortTtl = new SearchCache({ maxSize: 10, ttlMs: 1 });
    shortTtl.set("tavily", "test", { ok: true });
    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 5) {} // busy wait 5ms
    expect(shortTtl.get("tavily", "test")).toBeNull();
  });

  test("LRU eviction removes least recently used entry", () => {
    cache.set("tavily", "a", { n: 1 });
    cache.set("tavily", "b", { n: 2 });
    cache.set("tavily", "c", { n: 3 });

    // Access "a" to make it recently used
    cache.get("tavily", "a");

    // Add "d" — should evict "b" (least recently used)
    cache.set("tavily", "d", { n: 4 });

    expect(cache.get("tavily", "a")).toEqual({ n: 1 }); // still present
    expect(cache.get("tavily", "b")).toBeNull(); // evicted
    expect(cache.get("tavily", "c")).toEqual({ n: 3 }); // still present
    expect(cache.get("tavily", "d")).toEqual({ n: 4 }); // newly added
  });

  test("Overwriting existing key updates value and moves to end", () => {
    cache.set("tavily", "a", { n: 1 });
    cache.set("tavily", "b", { n: 2 });
    cache.set("tavily", "c", { n: 3 });

    // Overwrite "a" — should move to end
    cache.set("tavily", "a", { n: 10 });

    // Add "d" — should evict "b" (now LRU)
    cache.set("tavily", "d", { n: 4 });

    expect(cache.get("tavily", "a")).toEqual({ n: 10 }); // updated, still present
    expect(cache.get("tavily", "b")).toBeNull(); // evicted
  });

  test("has() checks existence without affecting LRU order", () => {
    cache.set("tavily", "a", { n: 1 });
    cache.set("tavily", "b", { n: 2 });
    cache.set("tavily", "c", { n: 3 });

    // has() should NOT move "a" to end
    expect(cache.has("tavily", "a")).toBe(true);

    // Add "d" — should evict "a" (still LRU since has() doesn't reorder)
    cache.set("tavily", "d", { n: 4 });
    expect(cache.get("tavily", "a")).toBeNull(); // evicted
  });

  test("delete() removes specific entry", () => {
    cache.set("tavily", "a", { n: 1 });
    cache.set("tavily", "b", { n: 2 });

    cache.delete("tavily", "a");

    expect(cache.get("tavily", "a")).toBeNull();
    expect(cache.get("tavily", "b")).toEqual({ n: 2 });
    expect(cache.size()).toBe(1);
  });

  test("clear() removes all entries and resets stats", () => {
    cache.set("tavily", "a", { n: 1 });
    cache.get("tavily", "a");
    cache.get("tavily", "missing");

    cache.clear();

    expect(cache.size()).toBe(0);
    const stats = cache.stats();
    expect(stats.cacheHits).toBe(0);
    expect(stats.cacheMisses).toBe(0);
  });

  test("stats() returns hit rate", () => {
    cache.set("tavily", "a", { n: 1 });
    cache.get("tavily", "a"); // hit
    cache.get("tavily", "a"); // hit
    cache.get("tavily", "missing"); // miss

    const stats = cache.stats();
    expect(stats.cacheHits).toBe(2);
    expect(stats.cacheMisses).toBe(1);
    expect(stats.hitRate).toBe("66.7%");
  });

  test("size() cleans expired entries", () => {
    const shortTtl = new SearchCache({ maxSize: 10, ttlMs: 1 });
    shortTtl.set("tavily", "a", { n: 1 });
    shortTtl.set("tavily", "b", { n: 2 });

    const start = Date.now();
    while (Date.now() - start < 5) {} // busy wait

    expect(shortTtl.size()).toBe(0);
  });

  test("Case-insensitive query matching", () => {
    cache.set("tavily", "Hotel Hanoi", { results: [1] });
    expect(cache.get("tavily", "hotel hanoi")).toEqual({ results: [1] });
    expect(cache.get("tavily", "HOTEL HANOI")).toEqual({ results: [1] });
  });
});
