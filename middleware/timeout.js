// Request timeout middleware
const DEFAULT_TIMEOUT = 30000; // 30 seconds

export function requestTimeout(ms = DEFAULT_TIMEOUT) {
  return (req, res, next) => {
    req.setTimeout(ms, () => {
      if (!res.headersSent) {
        res.status(408).json({ error: "Request timeout" });
      }
    });
    next();
  };
}
