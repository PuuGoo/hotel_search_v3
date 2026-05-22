import { describe, test, expect, jest, beforeEach, afterEach } from "@jest/globals";

describe("Config Module", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("should load default config in development", async () => {
    process.env.NODE_ENV = "development";
    const { default: config } = await import("../utils/config.js");

    expect(config.nodeEnv).toBe("development");
    expect(config.isDevelopment).toBe(true);
    expect(config.isProduction).toBe(false);
    expect(config.port).toBe(3000);
    expect(config.session.secret).toBe("dev-secret-change-in-production");
    expect(config.session.maxAge).toBe(24 * 60 * 60 * 1000);
    expect(config.cors.origins).toEqual([]);
    expect(config.rateLimit.loginMax).toBe(5);
    expect(config.rateLimit.searchMax).toBe(30);
    expect(config.logging.level).toBe("debug");
    expect(config.ddg.serverUrl).toBe("http://localhost:5001");
  });

  test("should use custom PORT", async () => {
    process.env.PORT = "8080";
    const { default: config } = await import("../utils/config.js");
    expect(config.port).toBe(8080);
  });

  test("should parse CORS_ORIGINS", async () => {
    process.env.CORS_ORIGINS = "https://example.com, https://app.example.com";
    const { default: config } = await import("../utils/config.js");
    expect(config.cors.origins).toEqual(["https://example.com", "https://app.example.com"]);
  });

  test("should use info log level in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "test-secret";
    const { default: config } = await import("../utils/config.js");
    expect(config.logging.level).toBe("info");
    expect(config.isProduction).toBe(true);
  });

  test("should allow custom rate limit config", async () => {
    process.env.RATE_LIMIT_LOGIN_MAX = "10";
    process.env.RATE_LIMIT_SEARCH_MAX = "60";
    const { default: config } = await import("../utils/config.js");
    expect(config.rateLimit.loginMax).toBe(10);
    expect(config.rateLimit.searchMax).toBe(60);
  });

  test("should allow custom session config", async () => {
    process.env.SESSION_SECRET = "custom-secret";
    process.env.SESSION_MAX_AGE = "3600000";
    const { default: config } = await import("../utils/config.js");
    expect(config.session.secret).toBe("custom-secret");
    expect(config.session.maxAge).toBe(3600000);
  });

  test("should allow custom DDG server URL", async () => {
    process.env.DDG_SERVER_URL = "http://custom-host:9000";
    const { default: config } = await import("../utils/config.js");
    expect(config.ddg.serverUrl).toBe("http://custom-host:9000");
  });
});
