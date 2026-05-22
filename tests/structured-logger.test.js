import { describe, test, expect, jest, beforeEach, afterEach } from "@jest/globals";

describe("Structured Logger", () => {
  let originalEnv;
  let logger;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    // Re-import to get fresh module
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("should export logger with error, warn, info, debug methods", async () => {
    const mod = await import("../utils/logger.js");
    logger = mod.logger;
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  test("should log info messages in development", async () => {
    process.env.NODE_ENV = "development";
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const mod = await import("../utils/logger.js");
    logger = mod.logger;

    logger.info("test message");

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("INFO"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("test message"));
    consoleSpy.mockRestore();
  });

  test("should log JSON in production", async () => {
    process.env.NODE_ENV = "production";
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const mod = await import("../utils/logger.js");
    logger = mod.logger;

    logger.info("production message", { userId: 123 });

    const logged = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(logged);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("production message");
    expect(parsed.userId).toBe(123);
    expect(parsed.timestamp).toBeDefined();
    consoleSpy.mockRestore();
  });

  test("should log error messages", async () => {
    process.env.NODE_ENV = "development";
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("../utils/logger.js");
    logger = mod.logger;

    logger.error("error message", { code: 500 });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("ERROR"));
    consoleSpy.mockRestore();
  });

  test("should log warn messages", async () => {
    process.env.NODE_ENV = "development";
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../utils/logger.js");
    logger = mod.logger;

    logger.warn("warning message");

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("WARN"));
    consoleSpy.mockRestore();
  });

  test("should respect LOG_LEVEL env var", async () => {
    process.env.NODE_ENV = "development";
    process.env.LOG_LEVEL = "error";
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const mod = await import("../utils/logger.js");
    logger = mod.logger;

    logger.debug("should not appear");
    logger.info("should not appear");

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
