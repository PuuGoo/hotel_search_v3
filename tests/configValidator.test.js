import { describe, test, expect } from "@jest/globals";
import { validateConfig } from "../utils/configValidator.js";

describe("Configuration Validation", () => {
  test("validates default config as valid", () => {
    const result = validateConfig({});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("valid PORT passes", () => {
    const result = validateConfig({ PORT: "3000" });
    expect(result.valid).toBe(true);
  });

  test("invalid PORT fails", () => {
    const result = validateConfig({ PORT: "not-a-number" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("PORT");
  });

  test("PORT out of range fails", () => {
    const result = validateConfig({ PORT: "99999" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("65535");
  });

  test("invalid NODE_ENV fails", () => {
    const result = validateConfig({ NODE_ENV: "staging" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("NODE_ENV");
  });

  test("valid NODE_ENV passes", () => {
    const result = validateConfig({ NODE_ENV: "development" });
    expect(result.valid).toBe(true);
  });

  test("production with default SESSION_SECRET fails", () => {
    const result = validateConfig({
      NODE_ENV: "production",
      SESSION_SECRET: "dev-secret-change-in-production",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("SESSION_SECRET"))).toBe(true);
  });

  test("production with custom SESSION_SECRET passes", () => {
    const result = validateConfig({
      NODE_ENV: "production",
      SESSION_SECRET: "my-super-secret-key-that-is-long-enough",
    });
    expect(result.valid).toBe(true);
  });

  test("short SESSION_SECRET warns in development", () => {
    const result = validateConfig({
      NODE_ENV: "development",
      SESSION_SECRET: "short",
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test("invalid LOG_LEVEL fails", () => {
    const result = validateConfig({ LOG_LEVEL: "verbose" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("LOG_LEVEL");
  });

  test("valid LOG_LEVEL passes", () => {
    const result = validateConfig({ LOG_LEVEL: "info" });
    expect(result.valid).toBe(true);
  });

  test("RATE_LIMIT_LOGIN_MAX must be number", () => {
    const result = validateConfig({ RATE_LIMIT_LOGIN_MAX: "abc" });
    expect(result.valid).toBe(false);
  });

  test("SESSION_MAX_AGE too small fails", () => {
    const result = validateConfig({ SESSION_MAX_AGE: "1000" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("60000");
  });
});
