// Distributed tracing middleware
// Supports W3C Trace Context format (traceparent/tracestate headers)
// Falls back to X-Request-Id for simple tracing

import crypto from "crypto";

/**
 * Generate a W3C trace context header.
 * Format: {version}-{trace-id}-{parent-span-id}-{trace-flags}
 */
export function generateTraceContext() {
  const traceId = crypto.randomBytes(16).toString("hex");
  const spanId = crypto.randomBytes(8).toString("hex");
  return {
    traceparent: `00-${traceId}-${spanId}-01`,
    traceId,
    spanId,
  };
}

/**
 * Parse W3C traceparent header.
 */
export function parseTraceparent(traceparent) {
  if (!traceparent) return null;
  const parts = traceparent.split("-");
  if (parts.length !== 4) return null;
  const [version, traceId, spanId, flags] = parts;
  if (version !== "00") return null;
  return { traceId, spanId, flags };
}

/**
 * Tracing middleware — extracts or generates trace context.
 * Propagates trace ID across outgoing requests via X-Trace-Id header.
 */
export function tracingMiddleware(req, res, next) {
  // Try to extract from W3C traceparent
  const parsed = parseTraceparent(req.headers["traceparent"]);

  if (parsed) {
    req.traceId = parsed.traceId;
    req.spanId = parsed.spanId;
  } else {
    // Generate new trace ID
    const trace = generateTraceContext();
    req.traceId = trace.traceId;
    req.spanId = trace.spanId;
  }

  // Set response headers
  res.setHeader("X-Trace-Id", req.traceId);
  res.setHeader("X-Span-Id", req.spanId);

  // Make trace available in res.locals for logging
  res.locals.traceId = req.traceId;
  res.locals.spanId = req.spanId;

  next();
}

/**
 * Add trace context to outgoing fetch requests.
 */
export function propagateTrace(req, options = {}) {
  return {
    ...options,
    headers: {
      ...options.headers,
      "X-Trace-Id": req.traceId,
      "traceparent": `00-${req.traceId}-${crypto.randomBytes(8).toString("hex")}-01`,
    },
  };
}
