import { describe, test, expect } from "@jest/globals";
import { checkPasswordStrength } from "../middleware/validation.js";

describe("Password Strength", () => {
  test("returns score 0 for empty password", () => {
    const result = checkPasswordStrength("");
    expect(result.score).toBe(0);
    expect(result.level).toBe("invalid");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("returns score 0 for non-string input", () => {
    const result = checkPasswordStrength(null);
    expect(result.score).toBe(0);
    expect(result.level).toBe("invalid");
  });

  test("rejects password shorter than 8 characters", () => {
    const result = checkPasswordStrength("Ab1!");
    expect(result.errors).toContain("At least 8 characters");
    expect(result.score).toBeLessThan(5);
  });

  test("rejects password without uppercase", () => {
    const result = checkPasswordStrength("abcdefgh1!");
    expect(result.errors).toContain("At least one uppercase letter");
    expect(result.score).toBeLessThan(5);
  });

  test("rejects password without lowercase", () => {
    const result = checkPasswordStrength("ABCDEFGH1!");
    expect(result.errors).toContain("At least one lowercase letter");
    expect(result.score).toBeLessThan(5);
  });

  test("rejects password without digit", () => {
    const result = checkPasswordStrength("Abcdefgh!");
    expect(result.errors).toContain("At least one digit");
    expect(result.score).toBeLessThan(5);
  });

  test("rejects password without special character", () => {
    const result = checkPasswordStrength("Abcdefgh1");
    expect(result.errors).toContain("At least one special character");
    expect(result.score).toBeLessThan(5);
  });

  test("accepts strong password with all criteria", () => {
    const result = checkPasswordStrength("Abcdef1!");
    expect(result.errors).toHaveLength(0);
    expect(result.score).toBe(5);
    expect(result.level).toBe("strong");
  });

  test("accepts password with various special characters", () => {
    const specials = "!@#$%^&*()_+-=[]{};':\"\\|,.<>/?`~";
    for (const ch of specials) {
      const result = checkPasswordStrength(`Abcdef1${ch}`);
      expect(result.errors).toHaveLength(0);
    }
  });

  test("returns correct levels for different scores", () => {
    // Score 0: no criteria met
    const s0 = checkPasswordStrength("");
    expect(s0.level).toBe("invalid");

    // Score 5: all criteria met
    const s5 = checkPasswordStrength("Abcdef1!");
    expect(s5.level).toBe("strong");
  });

  test("rejects password longer than 128 characters", () => {
    const longPw = "A".repeat(120) + "a1!xxxxxx";
    const result = checkPasswordStrength(longPw + "extra");
    expect(result.errors).toContain("At most 128 characters");
  });

  test("accepts password at exactly 128 characters", () => {
    const pw = "A".repeat(124) + "a1!@";
    const result = checkPasswordStrength(pw);
    expect(result.errors).not.toContain("At most 128 characters");
  });
});
