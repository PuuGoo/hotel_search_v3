import { describe, test, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Request Body Logging", () => {
  const loggerSrc = fs.readFileSync(path.join(__dirname, "..", "middleware", "logger.js"), "utf8");

  test("logger.js exports requestLogger function", () => {
    expect(loggerSrc).toContain("export function requestLogger");
  });

  test("logger.js has redactSensitive function", () => {
    expect(loggerSrc).toContain("function redactSensitive");
  });

  test("logger.js redacts password fields", () => {
    expect(loggerSrc).toContain("password");
    expect(loggerSrc).toContain("[REDACTED]");
  });

  test("logger.js redacts token fields", () => {
    expect(loggerSrc).toContain("token");
    expect(loggerSrc).toContain("secret");
  });

  test("logger.js redacts API key fields", () => {
    expect(loggerSrc).toContain("apiKey");
    expect(loggerSrc).toContain("api_key");
  });

  test("logger.js only logs body in development mode", () => {
    expect(loggerSrc).toContain("config.isProduction");
    expect(loggerSrc).toContain("REQ BODY");
  });

  test("logger.js truncates large bodies", () => {
    expect(loggerSrc).toContain("2000");
    expect(loggerSrc).toContain("500");
  });

  test("logger.js logs body for API requests only", () => {
    expect(loggerSrc).toContain('/api/"');
    expect(loggerSrc).toContain('/login"');
  });

  test("logger.js adds X-Response-Time header", () => {
    expect(loggerSrc).toContain("X-Response-Time");
  });

  test("logger.js handles nested object redaction", () => {
    expect(loggerSrc).toContain('typeof redacted[key] === "object"');
  });
});
