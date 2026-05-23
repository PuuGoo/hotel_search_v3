// Response streaming utilities for large JSON responses
// Streams large arrays to avoid loading everything into memory

/**
 * Stream a large JSON array response.
 * Writes items one by one to avoid memory spike.
 *
 * @param {Response} res - Express response object
 * @param {Array} items - Array of items to stream
 * @param {object} meta - Additional metadata to include
 */
export function streamJsonArray(res, items, meta = {}) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Write header
  res.write('{"data":[');

  for (let i = 0; i < items.length; i++) {
    if (i > 0) res.write(",");
    res.write(JSON.stringify(items[i]));
  }

  // Write footer with metadata
  res.write(`],"count":${items.length}`);
  for (const [key, value] of Object.entries(meta)) {
    res.write(`,"${key}":${JSON.stringify(value)}`);
  }
  res.write("}");
  res.end();
}

/**
 * Stream newline-delimited JSON (NDJSON).
 * Each item is a separate JSON line.
 */
export function streamNdjson(res, items) {
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("X-Content-Type-Options", "nosniff");

  for (const item of items) {
    res.write(JSON.stringify(item) + "\n");
  }

  res.end();
}
