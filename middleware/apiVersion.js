// API versioning middleware
// Supports both /api/* and /api/v1/* paths by stripping the version prefix
// Maintains backward compatibility while enabling versioned URLs

const SUPPORTED_VERSIONS = ["v1"];
const DEFAULT_VERSION = "v1";

export function apiVersion(req, _res, next) {
  // Match /api/vN/... pattern
  const match = req.path.match(/^\/api\/(v\d+)(\/.*)?$/);
  if (match) {
    const version = match[1];
    if (SUPPORTED_VERSIONS.includes(version)) {
      // Rewrite path to strip version prefix: /api/v1/foo -> /api/foo
      req.url = "/api" + (match[2] || "/");
      req.apiVersion = version;
    }
  } else if (req.path.startsWith("/api/")) {
    req.apiVersion = DEFAULT_VERSION;
  }
  next();
}

export function getApiVersion(req) {
  return req.apiVersion || DEFAULT_VERSION;
}
