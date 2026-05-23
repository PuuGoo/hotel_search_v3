// Task queue — async task processing with priority and retry

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "task_queue.json");
const MAX_TASKS = 1000;
const MAX_HISTORY = 2000;
const DEFAULT_MAX_RETRIES = 3;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { queue: [], history: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Add a task to the queue.
 */
export function enqueue(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.queue) data.queue = [];
  if (data.queue.length >= MAX_TASKS) {
    return { error: "Max queue size reached" };
  }

  const task = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: options.type || "generic",
    name: options.name || "Unnamed Task",
    payload: options.payload || {},
    priority: options.priority || 0, // Higher = more urgent
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    retryCount: 0,
    status: "pending",
    createdAt: Date.now(),
    scheduledAt: options.scheduledAt || null,
    startedAt: null,
    completedAt: null,
    error: null,
    createdBy: options.userId || "system",
  };

  data.queue.push(task);
  // Sort by priority (descending), then by creation time (ascending)
  data.queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);

  writeJSON(DATA_FILE, data);
  return task;
}

/**
 * Get next task from queue (peek without removing).
 */
export function peek() {
  const data = readJSON(DATA_FILE);
  const now = Date.now();
  const task = (data.queue || []).find((t) =>
    t.status === "pending" && (!t.scheduledAt || t.scheduledAt <= now)
  );
  return task || null;
}

/**
 * Dequeue (claim) the next task.
 */
export function dequeue() {
  const data = readJSON(DATA_FILE);
  const now = Date.now();
  const index = (data.queue || []).findIndex((t) =>
    t.status === "pending" && (!t.scheduledAt || t.scheduledAt <= now)
  );

  if (index === -1) return null;

  const task = data.queue[index];
  task.status = "processing";
  task.startedAt = Date.now();

  writeJSON(DATA_FILE, data);
  return task;
}

/**
 * Complete a task.
 */
export function complete(taskId, result = null) {
  const data = readJSON(DATA_FILE);
  const index = (data.queue || []).findIndex((t) => t.id === taskId);
  if (index === -1) return { error: "Task not found" };

  const task = data.queue[index];
  task.status = "completed";
  task.completedAt = Date.now();
  task.result = result;

  // Move to history
  if (!data.history) data.history = [];
  data.history.unshift({ ...task });
  if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY;

  data.queue.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return task;
}

/**
 * Fail a task (with optional retry).
 */
export function fail(taskId, error = "Unknown error") {
  const data = readJSON(DATA_FILE);
  const index = (data.queue || []).findIndex((t) => t.id === taskId);
  if (index === -1) return { error: "Task not found" };

  const task = data.queue[index];
  task.retryCount++;

  if (task.retryCount <= task.maxRetries) {
    // Retry: reset to pending with exponential backoff
    task.status = "pending";
    task.error = error;
    task.scheduledAt = Date.now() + Math.pow(2, task.retryCount) * 1000;
    task.startedAt = null;
    writeJSON(DATA_FILE, data);
    return { ...task, retried: true };
  }

  // Max retries exceeded: mark as failed
  task.status = "failed";
  task.completedAt = Date.now();
  task.error = error;

  // Move to history
  if (!data.history) data.history = [];
  data.history.unshift({ ...task });
  if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY;

  data.queue.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return task;
}

/**
 * Cancel a task.
 */
export function cancel(taskId) {
  const data = readJSON(DATA_FILE);
  const index = (data.queue || []).findIndex((t) => t.id === taskId);
  if (index === -1) return { error: "Task not found" };

  const task = data.queue[index];
  task.status = "cancelled";
  task.completedAt = Date.now();

  // Move to history
  if (!data.history) data.history = [];
  data.history.unshift({ ...task });
  if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY;

  data.queue.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return task;
}

/**
 * Get queue contents.
 */
export function getQueue(options = {}) {
  const { status = null, type = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let queue = data.queue || [];

  if (status) queue = queue.filter((t) => t.status === status);
  if (type) queue = queue.filter((t) => t.type === type);

  return { tasks: queue.slice(0, limit), total: queue.length };
}

/**
 * Get task history.
 */
export function getHistory(options = {}) {
  const { status = null, type = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let history = data.history || [];

  if (status) history = history.filter((t) => t.status === status);
  if (type) history = history.filter((t) => t.type === type);

  return { tasks: history.slice(0, limit), total: history.length };
}

/**
 * Get a specific task (from queue or history).
 */
export function getTask(taskId) {
  const data = readJSON(DATA_FILE);
  const queueTask = (data.queue || []).find((t) => t.id === taskId);
  if (queueTask) return queueTask;
  return (data.history || []).find((t) => t.id === taskId) || null;
}

/**
 * Get queue statistics.
 */
export function getQueueStats() {
  const data = readJSON(DATA_FILE);
  const queue = data.queue || [];
  const history = data.history || [];

  const queueStatusCounts = {};
  for (const task of queue) {
    queueStatusCounts[task.status] = (queueStatusCounts[task.status] || 0) + 1;
  }

  const historyStatusCounts = {};
  for (const task of history) {
    historyStatusCounts[task.status] = (historyStatusCounts[task.status] || 0) + 1;
  }

  return {
    queueSize: queue.length,
    queueStatusCounts,
    historySize: history.length,
    historyStatusCounts,
    totalProcessed: history.length,
  };
}

/**
 * Clear queue and history.
 */
export function clearQueueData() {
  writeJSON(DATA_FILE, { queue: [], history: [] });
}
