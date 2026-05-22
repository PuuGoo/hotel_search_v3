// Circuit Breaker pattern for external API calls
const STATES = { CLOSED: "closed", OPEN: "open", HALF_OPEN: "half_open" };

export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 30000;
    this.monitorInterval = options.monitorInterval || 10000;
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
  }

  async execute(fn) {
    if (this.state === STATES.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
        this.state = STATES.HALF_OPEN;
      } else {
        throw new Error("Circuit breaker is open");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    if (this.state === STATES.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= 2) {
        this.reset();
      }
    } else {
      this.failureCount = 0;
    }
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = STATES.OPEN;
    }
  }

  reset() {
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
  }

  getState() {
    return this.state;
  }

  getStats() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}
