import { describe, test, expect, jest } from "@jest/globals";
import { CircuitBreaker } from "../utils/circuitBreaker.js";

describe("CircuitBreaker", () => {
  test("should start in closed state", () => {
    const breaker = new CircuitBreaker();
    expect(breaker.getState()).toBe("closed");
  });

  test("should execute function successfully", async () => {
    const breaker = new CircuitBreaker();
    const fn = jest.fn().mockResolvedValue("result");

    const result = await breaker.execute(fn);

    expect(result).toBe("result");
    expect(fn).toHaveBeenCalled();
    expect(breaker.getState()).toBe("closed");
  });

  test("should open after failure threshold", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    const fn = jest.fn().mockRejectedValue(new Error("fail"));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fn)).rejects.toThrow("fail");
    }

    expect(breaker.getState()).toBe("open");
  });

  test("should reject immediately when circuit is open", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000 });
    const fn = jest.fn().mockRejectedValue(new Error("fail"));

    await expect(breaker.execute(fn)).rejects.toThrow("fail");
    expect(breaker.getState()).toBe("open");

    // Should reject without calling fn
    fn.mockClear();
    await expect(breaker.execute(fn)).rejects.toThrow("Circuit breaker is open");
    expect(fn).not.toHaveBeenCalled();
  });

  test("should transition to half-open after reset timeout", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50 });
    const fn = jest.fn().mockRejectedValue(new Error("fail"));

    await expect(breaker.execute(fn)).rejects.toThrow("fail");
    expect(breaker.getState()).toBe("open");

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 60));

    const successFn = jest.fn().mockResolvedValue("ok");
    await breaker.execute(successFn);
    expect(breaker.getState()).toBe("half_open");
  });

  test("should reset to closed after successful calls in half-open", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50 });
    const failFn = jest.fn().mockRejectedValue(new Error("fail"));

    await expect(breaker.execute(failFn)).rejects.toThrow("fail");

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 60));

    const successFn = jest.fn().mockResolvedValue("ok");
    await breaker.execute(successFn);
    await breaker.execute(successFn);

    expect(breaker.getState()).toBe("closed");
  });

  test("should return stats", () => {
    const breaker = new CircuitBreaker();
    const stats = breaker.getStats();

    expect(stats.state).toBe("closed");
    expect(stats.failureCount).toBe(0);
    expect(stats.lastFailureTime).toBeNull();
  });

  test("should reset manually", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    const fn = jest.fn().mockRejectedValue(new Error("fail"));

    await expect(breaker.execute(fn)).rejects.toThrow("fail");
    expect(breaker.getState()).toBe("open");

    breaker.reset();
    expect(breaker.getState()).toBe("closed");
    expect(breaker.getStats().failureCount).toBe(0);
  });

  test("should track failure count", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    const fn = jest.fn().mockRejectedValue(new Error("fail"));

    await expect(breaker.execute(fn)).rejects.toThrow("fail");
    await expect(breaker.execute(fn)).rejects.toThrow("fail");

    expect(breaker.getStats().failureCount).toBe(2);
    expect(breaker.getState()).toBe("closed");
  });

  test("should reset failure count on success", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    const failFn = jest.fn().mockRejectedValue(new Error("fail"));
    const successFn = jest.fn().mockResolvedValue("ok");

    await expect(breaker.execute(failFn)).rejects.toThrow("fail");
    await expect(breaker.execute(failFn)).rejects.toThrow("fail");
    expect(breaker.getStats().failureCount).toBe(2);

    await breaker.execute(successFn);
    expect(breaker.getStats().failureCount).toBe(0);
  });
});
