import { logError } from "../routes/errorTracking.js";

// Error tracking middleware - place after all routes
export function errorTracker(err, req, res, next) {
  logError(err, {
    path: req.path,
    method: req.method,
    statusCode: err.status || err.statusCode || 500,
    userId: req.session?.user?.id,
    username: req.session?.user?.username,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });

  next(err);
}
