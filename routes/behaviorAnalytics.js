// Behavior analytics — track user interactions with search results

import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "behavior_analytics.json");

const router = Router();

function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch { /* ignore */ }
  return { events: [], aggregates: {} };
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/**
 * POST /api/behavior/track
 * Track a user behavior event.
 * Body: { eventType, query, engine, resultUrl, resultPosition, metadata }
 * Event types: impression, click, bookmark, share
 */
router.post("/api/behavior/track", checkAuthenticated, (req, res) => {
  const { eventType, query, engine, resultUrl, resultPosition, metadata } = req.body;

  if (!eventType) {
    return res.status(400).json({ error: "eventType is required" });
  }

  const validTypes = ["impression", "click", "bookmark", "share", "search"];
  if (!validTypes.includes(eventType)) {
    return res.status(400).json({ error: `eventType must be: ${validTypes.join(", ")}` });
  }

  const data = readData();
  const event = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: req.session.user.id,
    eventType,
    query: query || null,
    engine: engine || null,
    resultUrl: resultUrl || null,
    resultPosition: resultPosition || null,
    metadata: metadata || {},
    timestamp: new Date().toISOString(),
  };

  data.events.push(event);

  // Keep last 10000 events
  if (data.events.length > 10000) {
    data.events = data.events.slice(-10000);
  }

  writeData(data);
  res.status(201).json({ success: true, eventId: event.id });
});

/**
 * GET /api/behavior/stats
 * Get aggregated behavior analytics for the current user.
 * Query: ?days=7 (default 7)
 */
router.get("/api/behavior/stats", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const days = parseInt(req.query.days) || 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const data = readData();
  const events = data.events.filter(
    (e) => e.userId === userId && new Date(e.timestamp) > cutoff
  );

  const totalSearches = events.filter((e) => e.eventType === "search").length;
  const totalClicks = events.filter((e) => e.eventType === "click").length;
  const totalImpressions = events.filter((e) => e.eventType === "impression").length;
  const totalBookmarks = events.filter((e) => e.eventType === "bookmark").length;

  // CTR = clicks / impressions
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100).toFixed(1) : 0;

  // Clicks by engine
  const clicksByEngine = {};
  events.filter((e) => e.eventType === "click").forEach((e) => {
    const engine = e.engine || "unknown";
    clicksByEngine[engine] = (clicksByEngine[engine] || 0) + 1;
  });

  // Click distribution by position
  const clicksByPosition = {};
  events.filter((e) => e.eventType === "click" && e.resultPosition).forEach((e) => {
    const pos = e.resultPosition;
    clicksByPosition[pos] = (clicksByPosition[pos] || 0) + 1;
  });

  // Top queries
  const queryCounts = {};
  events.filter((e) => e.query).forEach((e) => {
    queryCounts[e.query] = (queryCounts[e.query] || 0) + 1;
  });
  const topQueries = Object.entries(queryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([query, count]) => ({ query, count }));

  // Searches by day
  const searchesByDay = {};
  events.filter((e) => e.eventType === "search").forEach((e) => {
    const day = e.timestamp.split("T")[0];
    searchesByDay[day] = (searchesByDay[day] || 0) + 1;
  });

  res.json({
    period: `${days} days`,
    totalSearches,
    totalClicks,
    totalImpressions,
    totalBookmarks,
    ctr: parseFloat(ctr),
    clicksByEngine,
    clicksByPosition,
    topQueries,
    searchesByDay,
  });
});

/**
 * GET /api/behavior/global
 * Get system-wide behavior analytics (admin only).
 */
router.get("/api/behavior/global", checkAuthenticated, (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  const days = parseInt(req.query.days) || 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const data = readData();
  const events = data.events.filter((e) => new Date(e.timestamp) > cutoff);

  const uniqueUsers = new Set(events.map((e) => e.userId)).size;
  const totalEvents = events.length;

  // Events by type
  const eventsByType = {};
  events.forEach((e) => {
    eventsByType[e.eventType] = (eventsByType[e.eventType] || 0) + 1;
  });

  // Average position of clicked results
  const clickPositions = events
    .filter((e) => e.eventType === "click" && e.resultPosition)
    .map((e) => e.resultPosition);
  const avgClickPosition = clickPositions.length > 0
    ? (clickPositions.reduce((a, b) => a + b, 0) / clickPositions.length).toFixed(1)
    : 0;

  // Most active users
  const userCounts = {};
  events.forEach((e) => {
    userCounts[e.userId] = (userCounts[e.userId] || 0) + 1;
  });
  const mostActiveUsers = Object.entries(userCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([userId, count]) => ({ userId, count }));

  res.json({
    period: `${days} days`,
    uniqueUsers,
    totalEvents,
    eventsByType,
    avgClickPosition: parseFloat(avgClickPosition),
    mostActiveUsers,
  });
});

/**
 * DELETE /api/behavior/clear
 * Clear behavior data for the current user.
 */
router.delete("/api/behavior/clear", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const data = readData();
  const before = data.events.length;
  data.events = data.events.filter((e) => e.userId !== userId);
  writeData(data);
  res.json({ success: true, deleted: before - data.events.length });
});

export default router;
