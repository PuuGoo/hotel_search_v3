// Pipeline trace — track middleware execution order for debugging
// Records which middleware ran, in what order, and how long each took

import crypto from "crypto";

const traces = new Map();
const MAX_TRACES = 100;

/**
 * Middleware that traces the execution pipeline.
 * Add this early in the middleware chain.
 */
export function pipelineTrace(req, res, next) {
  const traceId = crypto.randomBytes(8).toString("hex");
  req._traceId = traceId;
  req._pipelineStart = process.hrtime.bigint();
  req._pipelineSteps = [];

  // Record each middleware step
  const originalNext = next;
  let stepIndex = 0;

  // Set trace header before response is sent
  res.setHeader("X-Pipeline-Trace", traceId);

  // Hook into response finish to store trace
  res.on("finish", () => {
    const totalMs = Number(process.hrtime.bigint() - req._pipelineStart) / 1e6;
    const trace = {
      id: traceId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      totalMs: Math.round(totalMs * 100) / 100,
      steps: req._pipelineSteps,
      timestamp: new Date().toISOString(),
    };

    traces.set(traceId, trace);
    if (traces.size > MAX_TRACES) {
      const oldest = traces.keys().next().value;
      traces.delete(oldest);
    }
  });

  next();
}

/**
 * Record a middleware step in the pipeline.
 * Call this at the start of a middleware you want to trace.
 * @param {object} req
 * @param {string} name - middleware name
 */
export function traceStep(req, name) {
  if (!req._pipelineSteps) return;

  const now = process.hrtime.bigint();
  const prevStep = req._pipelineSteps[req._pipelineSteps.length - 1];
  const startMs = prevStep
    ? prevStep.startMs + prevStep.durationMs
    : 0;

  req._pipelineSteps.push({
    name,
    startMs: Math.round(startMs * 100) / 100,
    durationMs: 0, // Will be set when next step starts
    order: req._pipelineSteps.length,
  });

  // Update previous step's duration
  if (prevStep) {
    const elapsed = Number(now - req._pipelineStart) / 1e6;
    prevStep.durationMs = Math.round((elapsed - prevStep.startMs) * 100) / 100;
  }
}

/**
 * Get a trace by ID.
 */
export function getTrace(traceId) {
  return traces.get(traceId);
}

/**
 * Get recent traces.
 */
export function getRecentTraces(limit = 20) {
  const all = [...traces.values()].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return all.slice(0, limit);
}

/**
 * Get trace statistics.
 */
export function getTraceStats() {
  const all = [...traces.values()];
  if (all.length === 0) return { count: 0, avgDuration: 0, slowest: null };

  const durations = all.map((t) => t.totalMs);
  const slowest = all.reduce((a, b) => (a.totalMs > b.totalMs ? a : b));

  return {
    count: all.length,
    avgDuration: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    minDuration: Math.round(Math.min(...durations)),
    maxDuration: Math.round(Math.max(...durations)),
    slowest: { id: slowest.id, method: slowest.method, path: slowest.path, duration: slowest.totalMs },
  };
}

/**
 * Clear all traces.
 */
export function clearTraces() {
  traces.clear();
}
