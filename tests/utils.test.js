import { describe, test, expect } from "@jest/globals";
import {
  ddgExtractDomain,
  ddgIsBlacklisted,
  ddgIsSuspicious,
  ddgNormalizeName,
  ddgExtractDomainName,
  ddgHotelMatchesDomain,
  ddgExtractActualUrl,
} from "../utils/ddg.js";

describe("ddgExtractDomain", () => {
  test("should extract domain from URL", () => {
    expect(ddgExtractDomain("https://www.example.com/path")).toBe("example.com");
  });

  test("should remove www prefix", () => {
    expect(ddgExtractDomain("https://www.hotel.com")).toBe("hotel.com");
  });

  test("should return empty string for invalid URL", () => {
    expect(ddgExtractDomain("not-a-url")).toBe("");
  });

  test("should lowercase domain", () => {
    expect(ddgExtractDomain("https://HOTEL.COM")).toBe("hotel.com");
  });
});

describe("ddgIsSuspicious", () => {
  test("should flag domains with multiple subdomains", () => {
    expect(ddgIsSuspicious("sub.domain.example.com")).toBe(true);
  });

  test("should flag domains with suspicious keywords", () => {
    expect(ddgIsSuspicious("tophotels-review.com")).toBe(true);
    expect(ddgIsSuspicious("besthotels24.com")).toBe(true);
    expect(ddgIsSuspicious("cheaphotels.com")).toBe(true);
  });

  test("should flag domains with numbers + hotel pattern", () => {
    expect(ddgIsSuspicious("24hotel.com")).toBe(true);
    expect(ddgIsSuspicious("hotel24.com")).toBe(true);
  });

  test("should not flag normal domains", () => {
    expect(ddgIsSuspicious("marriott.com")).toBe(false);
    expect(ddgIsSuspicious("hilton.com")).toBe(false);
  });
});

describe("ddgIsBlacklisted", () => {
  test("should blacklist known OTA domains", () => {
    expect(ddgIsBlacklisted("https://booking.com/hotel")).toBe(true);
    expect(ddgIsBlacklisted("https://www.agoda.com/hotel")).toBe(true);
    expect(ddgIsBlacklisted("https://expedia.com/hotel")).toBe(true);
  });

  test("should blacklist social media domains", () => {
    expect(ddgIsBlacklisted("https://facebook.com/page")).toBe(true);
    expect(ddgIsBlacklisted("https://instagram.com/hotel")).toBe(true);
  });

  test("should return true for null/undefined/empty", () => {
    expect(ddgIsBlacklisted(null)).toBe(true);
    expect(ddgIsBlacklisted(undefined)).toBe(true);
    expect(ddgIsBlacklisted("")).toBe(true);
  });

  test("should blacklist subdomains of blacklisted domains", () => {
    expect(ddgIsBlacklisted("https://hotels.booking.com/page")).toBe(true);
  });

  test("should not blacklist hotel official sites", () => {
    expect(ddgIsBlacklisted("https://marriott.com/hanoi")).toBe(false);
    expect(ddgIsBlacklisted("https://hilton.com/saigon")).toBe(false);
  });

  test("should not blacklist URLs with fewer domain parts than blacklisted entries", () => {
    // localhost has 1 part, all blacklist entries have 2+ parts
    expect(ddgIsBlacklisted("https://localhost")).toBe(false);
  });
});

describe("ddgNormalizeName", () => {
  test("should remove common articles", () => {
    expect(ddgNormalizeName("The Grand Hotel")).toBe("grand");
  });

  test("should remove hotel-related words", () => {
    expect(ddgNormalizeName("Grand Hotel")).toBe("grand");
    expect(ddgNormalizeName("Beach Resort")).toBe("beach");
    expect(ddgNormalizeName("Ocean Spa Inn")).toBe("ocean");
  });

  test("should remove special characters", () => {
    expect(ddgNormalizeName("Hotel-Luxury")).toBe("luxury");
    expect(ddgNormalizeName("The Grand & Spa")).toBe("grand");
  });

  test("should handle empty/null input", () => {
    expect(ddgNormalizeName("")).toBe("");
    expect(ddgNormalizeName(null)).toBe("");
    expect(ddgNormalizeName(undefined)).toBe("");
  });

  test("should lowercase", () => {
    expect(ddgNormalizeName("GRAND HOTEL")).toBe("grand");
  });
});

describe("ddgExtractDomainName", () => {
  test("should extract first part of domain", () => {
    expect(ddgExtractDomainName("https://marriott.com")).toBe("marriott");
  });

  test("should handle www prefix", () => {
    expect(ddgExtractDomainName("https://www.hilton.com")).toBe("hilton");
  });

  test("should return empty for invalid URL", () => {
    expect(ddgExtractDomainName("not-a-url")).toBe("");
  });
});

describe("ddgHotelMatchesDomain", () => {
  test("should match hotel name to its domain", () => {
    expect(ddgHotelMatchesDomain("Marriott Hotel", "https://marriott.com")).toBe(true);
  });

  test("should match partial name to domain", () => {
    expect(ddgHotelMatchesDomain("Marriott Hanoi Hotel", "https://marriott.com")).toBe(true);
  });

  test("should not match unrelated domains", () => {
    expect(ddgHotelMatchesDomain("Grand Hotel", "https://randomblog.com")).toBe(false);
  });

  test("should return false for short domain names", () => {
    expect(ddgHotelMatchesDomain("Hotel", "https://ab.com")).toBe(false);
  });

  test("should return false for null/undefined", () => {
    expect(ddgHotelMatchesDomain(null, "https://marriott.com")).toBe(false);
    expect(ddgHotelMatchesDomain("Hotel", null)).toBe(false);
  });

  test("should match via 2-word combination prefix (domain starts with 6-char prefix)", () => {
    // normalized("Hampton Grand Resort") = "hamptongrand"
    // words = ["hampton", "grand"] (after removing "resort")
    // No individual word matches: "hamptoxyz".startsWith("hampton") = false
    // combined2 = "hamptongrand", domain "hamptoxyz" starts with "hampto" (first 6 chars)
    expect(ddgHotelMatchesDomain("Hampton Grand Resort", "https://hamptoxyz.com")).toBe(true);
  });

  test("should match via 3-word combined includes (domain is substring of 3-word combo but not 2-word)", () => {
    // words = ["abcd", "efgh", "ijkl"] after removing "hotel"
    // combined2 = "abcdefgh", combined3 = "abcdefghijkl"
    // domain "bcdefghi" is a substring of combined3 but NOT combined2
    expect(ddgHotelMatchesDomain("Abcd Efgh Ijkl Hotel", "https://bcdefghi.com")).toBe(true);
  });

  test("should not match when no combination works", () => {
    expect(ddgHotelMatchesDomain("Sienna Nordic Azure Hotel", "https://xyzrandom.com")).toBe(false);
  });

  test("should match via word prefix when domain is not substring of normalized", () => {
    // normalized = "alphagamma", domain = "alphax"
    // "alphagamma".includes("alphax") = false, "alphax".includes("alphagamma") = false
    // But words = ["alpha", "gamma"], "alphax".startsWith("alpha") = true
    expect(ddgHotelMatchesDomain("Alpha Gamma Hotel", "https://alphax.com")).toBe(true);
  });

  test("should return false for empty string hotel name", () => {
    expect(ddgHotelMatchesDomain("", "https://hotel.com")).toBe(false);
  });

  test("should return false when hotel name has no words with 4+ chars", () => {
    // "The Inn" → words filtered to length >= 4 → empty array
    expect(ddgHotelMatchesDomain("The Inn", "https://theinn.com")).toBe(false);
  });
});

describe("ddgExtractActualUrl", () => {
  test("should extract actual URL from DDG redirect", () => {
    const ddgUrl = "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fhotel&rut=abc";
    expect(ddgExtractActualUrl(ddgUrl)).toBe("https://example.com/hotel");
  });

  test("should return original URL if not DDG redirect", () => {
    expect(ddgExtractActualUrl("https://example.com")).toBe("https://example.com");
  });

  test("should handle invalid URLs gracefully", () => {
    expect(ddgExtractActualUrl("not-a-url")).toBe("not-a-url");
  });

  test("should return original DDG URL on decode error (catch block)", () => {
    // Construct a DDG URL with malformed uddg param that will fail decodeURIComponent
    const malformedUrl = "https://duckduckgo.com/l/?uddg=%E0%A4%A";
    expect(ddgExtractActualUrl(malformedUrl)).toBe(malformedUrl);
  });

  test("should return DDG URL when uddg param is missing", () => {
    const ddgUrl = "https://duckduckgo.com/l/?rut=abc";
    expect(ddgExtractActualUrl(ddgUrl)).toBe(ddgUrl);
  });
});

describe("ddgExtractDomainName edge cases", () => {
  test("should return empty string for empty input", () => {
    expect(ddgExtractDomainName("")).toBe("");
  });

  test("should return first part of multi-part domain from full URL", () => {
    expect(ddgExtractDomainName("https://hotel.example.com/path")).toBe("hotel");
  });

  test("should return full domain for single-part after www strip", () => {
    // "localhost" has no dots after www removal, parts.length < 2, returns domain
    expect(ddgExtractDomainName("http://localhost")).toBe("localhost");
  });
});

describe("ddgIsBlacklisted edge cases", () => {
  test("should return true for null/undefined/falsy URLs", () => {
    expect(ddgIsBlacklisted(null)).toBe(true);
    expect(ddgIsBlacklisted(undefined)).toBe(true);
    expect(ddgIsBlacklisted("")).toBe(true);
  });

  test("should return false for clean hotel domains", () => {
    expect(ddgIsBlacklisted("https://mariott.com")).toBe(false);
    expect(ddgIsBlacklisted("https://hiltonhotels.com")).toBe(false);
  });
});
