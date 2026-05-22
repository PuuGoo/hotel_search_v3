// Request logging middleware
export function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, url } = req;

  // Add response time header before response is sent
  const originalEnd = res.end;
  res.end = function (...args) {
    const duration = Date.now() - start;
    if (!res.headersSent) {
      res.setHeader("X-Response-Time", `${duration}ms`);
    }
    return originalEnd.apply(this, args);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const log = `[${new Date().toISOString()}] ${method} ${url} ${status} ${duration}ms`;

    if (status >= 400) {
      console.error(log);
    } else {
      console.log(log);
    }
  });

  next();
}
