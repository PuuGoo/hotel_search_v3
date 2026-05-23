// Event sourcing routes — track all state changes as immutable events

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  appendEvent,
  getEvents,
  getAllEvents,
  getEvent,
  saveSnapshot,
  getSnapshot,
  replayEvents,
  getEventStats,
  clearEventData,
} from "../utils/eventSourcing.js";

const router = Router();

/**
 * POST /api/events
 * Append an event to the store.
 */
router.post("/api/events", checkAuthenticated, (req, res) => {
  const event = appendEvent({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(event);
});

/**
 * GET /api/events
 * Get all events (admin only).
 * Query: type, userId, after, before, limit, offset
 */
router.get("/api/events", checkAuthenticated, checkRole("admin"), (req, res) => {
  const options = {
    type: req.query.type || null,
    userId: req.query.userId || null,
    after: req.query.after ? parseInt(req.query.after) : null,
    before: req.query.before ? parseInt(req.query.before) : null,
    limit: parseInt(req.query.limit) || 100,
    offset: parseInt(req.query.offset) || 0,
  };
  const result = getAllEvents(options);
  res.json(result);
});

/**
 * GET /api/events/stats
 * Get event store statistics (admin only).
 */
router.get("/api/events/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getEventStats();
  res.json(stats);
});

/**
 * GET /api/events/stream/:streamId
 * Get events for a stream.
 */
router.get("/api/events/stream/:streamId", checkAuthenticated, (req, res) => {
  const options = {
    after: req.query.after ? parseInt(req.query.after) : null,
    type: req.query.type || null,
    limit: parseInt(req.query.limit) || 100,
  };
  const result = getEvents(req.params.streamId, options);
  res.json(result);
});

/**
 * GET /api/events/stream/:streamId/snapshot
 * Get snapshot for a stream.
 */
router.get("/api/events/stream/:streamId/snapshot", checkAuthenticated, (req, res) => {
  const snapshot = getSnapshot(req.params.streamId);
  if (!snapshot) {
    return res.status(404).json({ error: "Snapshot not found", code: 404 });
  }
  res.json(snapshot);
});

/**
 * POST /api/events/stream/:streamId/snapshot
 * Save a snapshot for a stream.
 */
router.post("/api/events/stream/:streamId/snapshot", checkAuthenticated, (req, res) => {
  const { state, version } = req.body;
  const snapshot = saveSnapshot(req.params.streamId, state, version);
  res.status(201).json(snapshot);
});

/**
 * GET /api/events/stream/:streamId/replay
 * Replay events to rebuild state.
 */
router.get("/api/events/stream/:streamId/replay", checkAuthenticated, (req, res) => {
  const snapshot = getSnapshot(req.params.streamId);
  const initialState = snapshot?.state || {};
  const state = replayEvents(req.params.streamId, (state, event) => {
    // Default replay: merge payload into state
    return { ...state, ...event.payload, lastEvent: event.type };
  }, initialState);
  res.json({ streamId: req.params.streamId, state });
});

/**
 * GET /api/events/:id
 * Get a specific event (admin only).
 */
router.get("/api/events/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) {
    return res.status(404).json({ error: "Event not found", code: 404 });
  }
  res.json(event);
});

/**
 * DELETE /api/events/clear
 * Clear event store (admin only).
 */
router.delete("/api/events/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearEventData();
  res.json({ message: "Event store cleared" });
});

export default router;
