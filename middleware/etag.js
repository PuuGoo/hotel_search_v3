import crypto from "crypto";

/**
 * ETag middleware for cacheable API endpoints.
 * Generates a strong ETag from response body hash.
 * Returns 304 Not Modified when If-None-Match matches.
 *
 * Usage: app.use("/api/cacheable-endpoint", etagMiddleware, routeHandler)
 */
export function etagMiddleware(req, res, next) {
  if (req.method !== "GET") return next();

  // Disable Express's default weak ETag to avoid conflicts
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

  const originalJson = res.json.bind(res);

  res.json = function (body) {
    const bodyStr = JSON.stringify(body);
    const hash = crypto.createHash("md5").update(bodyStr).digest("hex");
    const etag = `"${hash}"`;

    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch === etag) {
      res.status(304);
      res.removeHeader("Content-Length");
      res.removeHeader("Content-Type");
      return res.end();
    }

    res.setHeader("ETag", etag);
    return originalJson(body);
  };

  next();
}
