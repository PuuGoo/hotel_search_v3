// Result validation — verify URLs are accessible before returning results

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_FILE = path.join(__dirname, "..", "url_validation_cache.json");
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 5000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return {};
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

function getCache() {
  return readJSON(CACHE_FILE);
}

function saveCache(cache) {
  // Evict expired entries
  const now = Date.now();
  for (const [url, entry] of Object.entries(cache)) {
    if (now - entry.checkedAt > CACHE_TTL) {
      delete cache[url];
    }
  }

  // Evict oldest if over limit
  const entries = Object.entries(cache);
  if (entries.length > MAX_CACHE_SIZE) {
    entries.sort((a, b) => a[1].checkedAt - b[1].checkedAt);
    const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
    for (const [url] of toRemove) {
      delete cache[url];
    }
  }

  writeJSON(CACHE_FILE, cache);
}

/**
 * Validate a single URL by making an HTTP HEAD request.
 * Returns { url, accessible, statusCode, responseTime, error, cached }
 */
export async function validateUrl(url, options = {}) {
  const { timeout = 5000, forceRefresh = false, useCache = true } = options;

  // Check cache first
  if (useCache && !forceRefresh) {
    const cache = getCache();
    const cached = cache[url];
    if (cached && Date.now() - cached.checkedAt < CACHE_TTL) {
      return { ...cached, cached: true };
    }
  }

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "HotelSearchBot/1.0 (URL Validator)",
      },
    });

    clearTimeout(timeoutId);

    const result = {
      url,
      accessible: response.ok,
      statusCode: response.status,
      responseTime: Date.now() - startTime,
      finalUrl: response.url !== url ? response.url : undefined,
      contentType: response.headers.get("content-type") || undefined,
      checkedAt: Date.now(),
    };

    // Update cache
    if (useCache) {
      const cache = getCache();
      cache[url] = result;
      saveCache(cache);
    }

    return result;
  } catch (err) {
    const result = {
      url,
      accessible: false,
      statusCode: null,
      responseTime: Date.now() - startTime,
      error: err.name === "AbortError" ? "timeout" : err.message,
      checkedAt: Date.now(),
    };

    // Update cache (cache failures too, but with shorter TTL awareness)
    if (useCache) {
      const cache = getCache();
      cache[url] = result;
      saveCache(cache);
    }

    return result;
  }
}

/**
 * Validate multiple URLs concurrently.
 * @param {string[]} urls - array of URLs to validate
 * @param {Object} options - { timeout, concurrency, useCache }
 * @returns {Object[]} validation results
 */
export async function validateUrls(urls, options = {}) {
  const { concurrency = 5, ...restOptions } = options;

  const results = [];
  const chunks = [];

  // Split into chunks for concurrency control
  for (let i = 0; i < urls.length; i += concurrency) {
    chunks.push(urls.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
      chunk.map((url) => validateUrl(url, restOptions))
    );
    results.push(...chunkResults);
  }

  return results;
}

/**
 * Validate search results — add accessibility info to each result.
 * @param {Object[]} results - search results with url field
 * @param {Object} options - validation options
 * @returns {Object[]} results with validation info added
 */
export async function validateSearchResults(results, options = {}) {
  if (!Array.isArray(results) || results.length === 0) return results;

  const urls = results.map((r) => r.url).filter(Boolean);
  const validations = await validateUrls(urls, options);

  const validationMap = new Map(validations.map((v) => [v.url, v]));

  return results.map((result) => {
    const validation = validationMap.get(result.url);
    return {
      ...result,
      validation: validation
        ? {
            accessible: validation.accessible,
            statusCode: validation.statusCode,
            responseTime: validation.responseTime,
            error: validation.error,
            checkedAt: validation.checkedAt,
          }
        : null,
    };
  });
}

/**
 * Get validation statistics from cache.
 */
export function getValidationStats() {
  const cache = getCache();
  const entries = Object.values(cache);
  const now = Date.now();

  const accessible = entries.filter((e) => e.accessible).length;
  const inaccessible = entries.filter((e) => !e.accessible).length;
  const expired = entries.filter((e) => now - e.checkedAt > CACHE_TTL).length;

  const avgResponseTime = entries.length > 0
    ? Math.round(entries.reduce((sum, e) => sum + (e.responseTime || 0), 0) / entries.length)
    : 0;

  const statusCodes = {};
  for (const entry of entries) {
    if (entry.statusCode) {
      statusCodes[entry.statusCode] = (statusCodes[entry.statusCode] || 0) + 1;
    }
  }

  const errors = {};
  for (const entry of entries) {
    if (entry.error) {
      errors[entry.error] = (errors[entry.error] || 0) + 1;
    }
  }

  return {
    totalCached: entries.length,
    accessible,
    inaccessible,
    expired,
    avgResponseTime,
    statusCodes,
    errors,
    cacheTTL: CACHE_TTL,
    maxCacheSize: MAX_CACHE_SIZE,
  };
}

/**
 * Clear validation cache.
 */
export function clearValidationCache() {
  writeJSON(CACHE_FILE, {});
}
