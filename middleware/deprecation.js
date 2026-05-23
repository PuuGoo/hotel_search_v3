// API deprecation warnings — Sunset headers (RFC 8594)
// Warns clients about deprecated endpoints

/**
 * Mark a route as deprecated.
 * @param {object} options - { sunset: Date, message: string, alternative: string }
 */
export function deprecated(options = {}) {
  const sunsetDate = options.sunset || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days
  const sunsetStr = sunsetDate.toUTCString();

  return (req, res, next) => {
    // RFC 8594 Sunset header
    res.setHeader("Sunset", sunsetStr);

    // Deprecation warning
    const link = options.alternative
      ? `<${options.alternative}>; rel="successor-version"`
      : "";
    if (link) res.setHeader("Link", link);

    // Warning header (HTTP warning codes)
    res.setHeader("Warning", `299 - "${options.message || "This endpoint is deprecated"}"`);

    next();
  };
}
