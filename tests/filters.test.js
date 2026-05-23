import { describe, test, expect } from "@jest/globals";
import { applyFilters, sortResults, extractDomains } from "../utils/filters.js";

describe("Filter Utilities", () => {
  const sampleResults = [
    { title: "Luxury Hotel", url: "https://booking.com/luxury", snippet: "5 star luxury hotel", score: 0.95 },
    { title: "Budget Inn", url: "https://hotels.com/budget", snippet: "affordable budget hotel", score: 0.7 },
    { title: "Beach Resort", url: "https://booking.com/beach", snippet: "beautiful beach resort", score: 0.85 },
    { title: "City Center Hotel", url: "https://agoda.com/city", snippet: "central location hotel", score: 0.6 },
    { title: "Mountain Lodge", url: "https://booking.com/mountain", snippet: "cozy mountain lodge", score: 0.8 },
  ];

  test("applyFilters returns all results when no filters", () => {
    const result = applyFilters(sampleResults, {});
    expect(result).toHaveLength(5);
  });

  test("applyFilters filters by text query", () => {
    const result = applyFilters(sampleResults, { q: "luxury" });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Luxury Hotel");
  });

  test("applyFilters filters by domain", () => {
    const result = applyFilters(sampleResults, { domain: "booking.com" });
    expect(result).toHaveLength(3);
  });

  test("applyFilters excludes domains", () => {
    const result = applyFilters(sampleResults, { excludeDomains: ["booking.com"] });
    expect(result).toHaveLength(2);
    expect(result.every((r) => !r.url.includes("booking.com"))).toBe(true);
  });

  test("applyFilters filters by minimum score", () => {
    const result = applyFilters(sampleResults, { minScore: 0.8 });
    expect(result).toHaveLength(3);
  });

  test("applyFilters handles null/undefined gracefully", () => {
    expect(applyFilters(null, {})).toBeNull();
    expect(applyFilters(sampleResults, null)).toEqual(sampleResults);
  });

  test("sortResults sorts by score descending", () => {
    const sorted = sortResults(sampleResults, "score", "desc");
    expect(sorted[0].score).toBe(0.95);
    expect(sorted[4].score).toBe(0.6);
  });

  test("sortResults sorts by score ascending", () => {
    const sorted = sortResults(sampleResults, "score", "asc");
    expect(sorted[0].score).toBe(0.6);
    expect(sorted[4].score).toBe(0.95);
  });

  test("sortResults sorts by title", () => {
    const sorted = sortResults(sampleResults, "title", "asc");
    expect(sorted[0].title).toBe("Beach Resort");
  });

  test("extractDomains returns domains with counts", () => {
    const domains = extractDomains(sampleResults);
    expect(domains).toContainEqual({ domain: "booking.com", count: 3 });
    expect(domains).toContainEqual({ domain: "hotels.com", count: 1 });
  });

  test("extractDomains handles empty array", () => {
    expect(extractDomains([])).toEqual([]);
    expect(extractDomains(null)).toEqual([]);
  });
});
