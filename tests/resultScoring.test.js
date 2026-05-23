import { describe, test, expect } from "@jest/globals";
import {
  scoreResult,
  scoreAndRank,
  mergeResults,
  getScoringStats,
} from "../utils/resultScoring.js";

describe("Result Scoring", () => {
  describe("scoreResult", () => {
    test("returns score between 0 and 100", () => {
      const result = { title: "Hotel Paris", description: "A luxury hotel", engine: "tavily", position: 1 };
      const scored = scoreResult(result, "hotel paris");
      expect(scored.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(scored.relevanceScore).toBeLessThanOrEqual(100);
    });

    test("top position scores higher than lower position", () => {
      const top = scoreResult({ title: "Hotel", engine: "tavily", position: 1 }, "hotel");
      const bottom = scoreResult({ title: "Hotel", engine: "tavily", position: 10 }, "hotel");
      expect(top.relevanceScore).toBeGreaterThan(bottom.relevanceScore);
    });

    test("keyword match in title scores higher", () => {
      const withMatch = scoreResult({ title: "Grand Hotel Paris", description: "", engine: "ddg", position: 1 }, "hotel paris");
      const noMatch = scoreResult({ title: "Luxury Resort", description: "", engine: "ddg", position: 1 }, "hotel paris");
      expect(withMatch.relevanceScore).toBeGreaterThan(noMatch.relevanceScore);
    });

    test("keyword match in description adds score", () => {
      const withDesc = scoreResult({ title: "Hotel", description: "beautiful pool and spa", engine: "ddg", position: 1 }, "pool");
      const noDesc = scoreResult({ title: "Hotel", description: "no amenities", engine: "ddg", position: 1 }, "pool");
      expect(withDesc.relevanceScore).toBeGreaterThan(noDesc.relevanceScore);
    });

    test("higher engine weight scores higher", () => {
      const tavily = scoreResult({ title: "Hotel", engine: "tavily", position: 1 }, "hotel");
      const unknown = scoreResult({ title: "Hotel", engine: "unknown", position: 1 }, "hotel");
      expect(tavily.relevanceScore).toBeGreaterThan(unknown.relevanceScore);
    });

    test("URL bonus adds points", () => {
      const withUrl = scoreResult({ title: "Hotel", engine: "ddg", position: 1, url: "https://example.com" }, "hotel");
      const noUrl = scoreResult({ title: "Hotel", engine: "ddg", position: 1 }, "hotel");
      expect(withUrl.relevanceScore).toBeGreaterThan(noUrl.relevanceScore);
    });

    test("fresh results score higher", () => {
      const fresh = scoreResult({
        title: "Hotel", engine: "ddg", position: 1,
        timestamp: new Date().toISOString(),
      }, "hotel");
      const old = scoreResult({
        title: "Hotel", engine: "ddg", position: 1,
        timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      }, "hotel");
      expect(fresh.relevanceScore).toBeGreaterThanOrEqual(old.relevanceScore);
    });

    test("preserves original result properties", () => {
      const result = { title: "Hotel", url: "https://example.com", engine: "tavily", position: 1 };
      const scored = scoreResult(result, "hotel");
      expect(scored.title).toBe("Hotel");
      expect(scored.url).toBe("https://example.com");
      expect(scored.engine).toBe("tavily");
    });
  });

  describe("scoreAndRank", () => {
    test("sorts results by relevance score descending", () => {
      const results = [
        { title: "Low relevance", engine: "ddg", position: 10 },
        { title: "High relevance hotel paris", engine: "tavily", position: 1 },
        { title: "Medium hotel", engine: "google", position: 5 },
      ];
      const ranked = scoreAndRank(results, "hotel paris");
      expect(ranked[0].relevanceScore).toBeGreaterThanOrEqual(ranked[1].relevanceScore);
      expect(ranked[1].relevanceScore).toBeGreaterThanOrEqual(ranked[2].relevanceScore);
    });

    test("handles empty array", () => {
      expect(scoreAndRank([], "query")).toEqual([]);
    });

    test("handles null input", () => {
      expect(scoreAndRank(null, "query")).toEqual([]);
    });

    test("assigns position if missing", () => {
      const results = [
        { title: "Hotel A", engine: "tavily" },
        { title: "Hotel B", engine: "tavily" },
      ];
      const ranked = scoreAndRank(results, "hotel");
      expect(ranked[0].position).toBeDefined();
    });
  });

  describe("mergeResults", () => {
    test("merges results from multiple engines", () => {
      const engineResults = {
        tavily: [{ title: "Hotel A", url: "https://a.com" }],
        ddg: [{ title: "Hotel B", url: "https://b.com" }],
      };
      const merged = mergeResults(engineResults, "hotel");
      expect(merged.length).toBe(2);
    });

    test("deduplicates by URL", () => {
      const engineResults = {
        tavily: [{ title: "Hotel A", url: "https://example.com/hotel" }],
        ddg: [{ title: "Hotel A", url: "https://example.com/hotel/" }],
      };
      const merged = mergeResults(engineResults, "hotel");
      expect(merged.length).toBe(1);
    });

    test("keeps highest scoring duplicate", () => {
      const engineResults = {
        tavily: [{ title: "Hotel A (tavily)", url: "https://example.com", position: 1 }],
        ddg: [{ title: "Hotel A (ddg)", url: "https://example.com", position: 10 }],
      };
      const merged = mergeResults(engineResults, "hotel");
      expect(merged.length).toBe(1);
      expect(merged[0].engine).toBe("tavily");
    });

    test("handles empty engines", () => {
      const merged = mergeResults({}, "hotel");
      expect(merged).toEqual([]);
    });

    test("handles null results in engine", () => {
      const merged = mergeResults({ tavily: null, ddg: [{ title: "Hotel" }] }, "hotel");
      expect(merged.length).toBe(1);
    });
  });

  describe("getScoringStats", () => {
    test("returns stats for scored results", () => {
      const results = [
        { relevanceScore: 80, engine: "tavily" },
        { relevanceScore: 60, engine: "ddg" },
        { relevanceScore: 40, engine: "tavily" },
      ];
      const stats = getScoringStats(results);
      expect(stats.count).toBe(3);
      expect(stats.avgScore).toBe(60);
      expect(stats.minScore).toBe(40);
      expect(stats.maxScore).toBe(80);
    });

    test("groups by engine", () => {
      const results = [
        { relevanceScore: 80, engine: "tavily" },
        { relevanceScore: 60, engine: "tavily" },
        { relevanceScore: 50, engine: "ddg" },
      ];
      const stats = getScoringStats(results);
      expect(stats.byEngine.tavily.count).toBe(2);
      expect(stats.byEngine.tavily.avgScore).toBe(70);
      expect(stats.byEngine.ddg.count).toBe(1);
    });

    test("handles empty results", () => {
      const stats = getScoringStats([]);
      expect(stats.count).toBe(0);
      expect(stats.avgScore).toBe(0);
    });

    test("handles null input", () => {
      const stats = getScoringStats(null);
      expect(stats.count).toBe(0);
    });
  });
});
