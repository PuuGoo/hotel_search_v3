// Request retry middleware with exponential backoff
// Retries failed HTTP requests for transient errors (5xx, timeouts, network errors)

const DEFAULT_OPTIONS = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  retryableErrors: ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a fetch call with exponential backoff.
 *
 * @param {string|URL} url - URL to fetch
 * @param {RequestInit} options - fetch options
 * @param {object} retryOptions - retry configuration
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const config = { ...DEFAULT_OPTIONS, ...retryOptions };
  let lastError;
  let lastResponse;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(30000),
      });

      // Success or non-retryable status
      if (response.ok || !config.retryableStatuses.includes(response.status)) {
        return response;
      }

      // Retryable status — save and retry
      lastResponse = response;

      // Respect Retry-After header
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) {
        const retryMs = parseInt(retryAfter) * 1000;
        if (!isNaN(retryMs) && retryMs < config.maxDelayMs) {
          await sleep(retryMs);
          continue;
        }
      }
    } catch (err) {
      lastError = err;

      // Non-retryable error
      if (!config.retryableErrors.includes(err.code) && err.name !== "TimeoutError") {
        throw err;
      }
    }

    // Don't delay after last attempt
    if (attempt < config.maxRetries) {
      // Exponential backoff with jitter
      const delay = Math.min(
        config.baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
        config.maxDelayMs
      );
      await sleep(delay);
    }
  }

  // All retries exhausted
  if (lastResponse) {
    return lastResponse;
  }
  throw lastError;
}

/**
 * Express middleware that adds a retry helper to the request.
 * Usage: req.fetchWithRetry(url, options)
 */
export function retryMiddleware(req, _res, next) {
  req.fetchWithRetry = (url, options, retryOptions) =>
    fetchWithRetry(url, options, retryOptions);
  next();
}
