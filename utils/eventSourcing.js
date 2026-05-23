// Event sourcing — track all state changes as immutable events

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "event_store.json");
const MAX_EVENTS = 10000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { events: [], snapshots: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Append an event to the store.
 */
export function appendEvent(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.events) data.events = [];

  const event = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    streamId: options.streamId, // Aggregate/entity ID
    type: options.type, // Event type (e.g., "user.created", "order.placed")
    payload: options.payload || {},
    metadata: {
      userId: options.userId || "system",
      correlationId: options.correlationId || null,
      causationId: options.causationId || null,
      version: options.version || 1,
    },
    timestamp: Date.now(),
    sequence: data.events.length + 1,
  };

  data.events.push(event);
  if (data.events.length > MAX_EVENTS) {
    data.events = data.events.slice(-MAX_EVENTS);
  }

  writeJSON(DATA_FILE, data);
  return event;
}

/**
 * Get events for a stream.
 */
export function getEvents(streamId, options = {}) {
  const data = readJSON(DATA_FILE);
  let events = (data.events || []).filter((e) => e.streamId === streamId);

  if (options.after) events = events.filter((e) => e.sequence > options.after);
  if (options.type) events = events.filter((e) => e.type === options.type);

  return { events: events.slice(0, options.limit || 100), total: events.length };
}

/**
 * Get all events (with filters).
 */
export function getAllEvents(options = {}) {
  const data = readJSON(DATA_FILE);
  let events = data.events || [];

  if (options.type) events = events.filter((e) => e.type === options.type);
  if (options.userId) events = events.filter((e) => e.metadata.userId === options.userId);
  if (options.after) events = events.filter((e) => e.timestamp > options.after);
  if (options.before) events = events.filter((e) => e.timestamp < options.before);

  const limit = options.limit || 100;
  const offset = options.offset || 0;
  return { events: events.slice(offset, offset + limit), total: events.length };
}

/**
 * Get a specific event.
 */
export function getEvent(eventId) {
  const data = readJSON(DATA_FILE);
  return (data.events || []).find((e) => e.id === eventId) || null;
}

/**
 * Save a snapshot of aggregate state.
 */
export function saveSnapshot(streamId, state, version) {
  const data = readJSON(DATA_FILE);
  if (!data.snapshots) data.snapshots = {};

  data.snapshots[streamId] = {
    state,
    version,
    timestamp: Date.now(),
  };

  writeJSON(DATA_FILE, data);
  return data.snapshots[streamId];
}

/**
 * Get snapshot for a stream.
 */
export function getSnapshot(streamId) {
  const data = readJSON(DATA_FILE);
  return (data.snapshots || {})[streamId] || null;
}

/**
 * Replay events to rebuild state.
 */
export function replayEvents(streamId, applyFn, initialState = {}) {
  const { events } = getEvents(streamId, { limit: MAX_EVENTS });
  let state = { ...initialState };

  for (const event of events) {
    state = applyFn(state, event);
  }

  return state;
}

/**
 * Get event store statistics.
 */
export function getEventStats() {
  const data = readJSON(DATA_FILE);
  const events = data.events || [];
  const snapshots = data.snapshots || {};

  const typeCounts = {};
  const streamCounts = {};
  for (const event of events) {
    typeCounts[event.type] = (typeCounts[event.type] || 0) + 1;
    streamCounts[event.streamId] = (streamCounts[event.streamId] || 0) + 1;
  }

  return {
    totalEvents: events.length,
    totalStreams: Object.keys(streamCounts).length,
    totalSnapshots: Object.keys(snapshots).length,
    typeCounts,
    oldestEvent: events.length > 0 ? events[0].timestamp : null,
    newestEvent: events.length > 0 ? events[events.length - 1].timestamp : null,
  };
}

/**
 * Clear event store.
 */
export function clearEventData() {
  writeJSON(DATA_FILE, { events: [], snapshots: {} });
}
