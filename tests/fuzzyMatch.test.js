import { describe, test, expect } from "@jest/globals";
import {
  normalize,
  levenshtein,
  similarity,
  isDuplicate,
  findDuplicates,
  mergeDuplicates,
} from "../utils/fuzzyMatch.js";

describe("Fuzzy Matching", () => {
  describe("normalize", () => {
    test("lowercases string", () => {
      expect(normalize("HOTEL PARIS")).toBe("hotel paris");
    });

    test("removes accents", () => {
      expect(normalize("Hôtél París")).toBe("hotel paris");
    });

    test("removes special characters", () => {
      expect(normalize("Hotel-Paris!")).toBe("hotel paris");
    });

    test("collapses whitespace", () => {
      expect(normalize("Hotel   Paris")).toBe("hotel paris");
    });

    test("handles null/empty", () => {
      expect(normalize(null)).toBe("");
      expect(normalize("")).toBe("");
    });
  });

  describe("levenshtein", () => {
    test("identical strings have distance 0", () => {
      expect(levenshtein("hotel", "hotel")).toBe(0);
    });

    test("empty vs string", () => {
      expect(levenshtein("", "hotel")).toBe(5);
      expect(levenshtein("hotel", "")).toBe(5);
    });

    test("single character difference", () => {
      expect(levenshtein("hotel", "hotels")).toBe(1);
    });

    test("completely different", () => {
      expect(levenshtein("abc", "xyz")).toBe(3);
    });

    test("handles null", () => {
      expect(levenshtein(null, "test")).toBe(4);
    });
  });

  describe("similarity", () => {
    test("identical strings have similarity 1", () => {
      expect(similarity("Hilton Paris", "Hilton Paris")).toBe(1);
    });

    test("similar hotel names have high similarity", () => {
      const sim = similarity("Hilton Paris", "Hilton Hotel Paris");
      expect(sim).toBeGreaterThan(0.6);
    });

    test("different hotels have low similarity", () => {
      const sim = similarity("Hilton Paris", "Marriott Tokyo");
      expect(sim).toBeLessThan(0.4);
    });

    test("empty strings", () => {
      expect(similarity("", "")).toBe(1);
      expect(similarity("test", "")).toBe(0);
    });

    test("handles null", () => {
      expect(similarity(null, null)).toBe(1);
      expect(similarity("test", null)).toBe(0);
    });
  });

  describe("isDuplicate", () => {
    test("identical names are duplicates", () => {
      expect(isDuplicate("Hilton Paris", "Hilton Paris")).toBe(true);
    });

    test("similar names are duplicates", () => {
      expect(isDuplicate("Grand Hotel Paris", "Grand Hotel in Paris", 0.6)).toBe(true);
    });

    test("different names are not duplicates", () => {
      expect(isDuplicate("Hilton Paris", "Marriott Tokyo")).toBe(false);
    });

    test("respects threshold", () => {
      expect(isDuplicate("Hotel A", "Hotel B", 0.99)).toBe(false);
      expect(isDuplicate("Hotel A", "Hotel B", 0.3)).toBe(true);
    });
  });

  describe("findDuplicates", () => {
    test("finds duplicate groups", () => {
      const items = [
        { name: "Hilton Paris", url: "https://hilton.com/paris" },
        { name: "Hilton Hotel Paris", url: "https://hilton.com/paris/" },
        { name: "Marriott Tokyo", url: "https://marriott.com/tokyo" },
      ];
      const groups = findDuplicates(items);
      expect(groups.length).toBe(1);
      expect(groups[0].length).toBe(2);
    });

    test("finds duplicates by fuzzy name match", () => {
      const items = [
        { name: "Grand Hotel Paris" },
        { name: "Grand Hotel in Paris" },
        { name: "Marriott Tokyo" },
      ];
      const groups = findDuplicates(items, { threshold: 0.6 });
      expect(groups.length).toBeGreaterThan(0);
    });

    test("returns empty for no duplicates", () => {
      const items = [
        { name: "Hilton" },
        { name: "Marriott" },
        { name: "Hyatt" },
      ];
      const groups = findDuplicates(items);
      expect(groups.length).toBe(0);
    });

    test("handles empty input", () => {
      expect(findDuplicates([])).toEqual([]);
      expect(findDuplicates(null)).toEqual([]);
    });
  });

  describe("mergeDuplicates", () => {
    test("keeps item with most data", () => {
      const group = [
        { name: "Hilton", url: null },
        { name: "Hilton Hotel Paris", url: "https://example.com", tags: ["luxury"] },
      ];
      const merged = mergeDuplicates(group);
      expect(merged.name).toBe("Hilton Hotel Paris");
      expect(merged.url).toBe("https://example.com");
    });

    test("merges tags from all items", () => {
      const group = [
        { name: "Hilton", tags: ["luxury"] },
        { name: "Hilton Hotel", tags: ["paris"] },
      ];
      const merged = mergeDuplicates(group);
      expect(merged.tags).toContain("luxury");
      expect(merged.tags).toContain("paris");
    });

    test("tracks merge count", () => {
      const group = [
        { name: "A", id: 1 },
        { name: "A Hotel", id: 2 },
      ];
      const merged = mergeDuplicates(group);
      expect(merged._mergedFrom).toBe(2);
      expect(merged._mergedIds).toEqual([1, 2]);
    });

    test("single item returns as-is", () => {
      const item = { name: "Hilton" };
      expect(mergeDuplicates([item])).toEqual(item);
    });

    test("null returns null", () => {
      expect(mergeDuplicates(null)).toBeNull();
      expect(mergeDuplicates([])).toBeNull();
    });
  });
});
