// API usage analytics routes

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  recordUsage,
  getUsageRecords,
  getClients,
  getClient,
  getTopEndpoints,
  getTopClients,
  getUsageTimeline,
  getUsageStats,
  clearUsageData,
} from "../utils/apiUsageAnalytics.js";

const router = Router();

/**
 * POST /api/usage/record
 * Record an API usage event (admin only).
 */
router.post("/api/usage/record", checkAuthenticated, checkRole("admin"), (req, res) => {
  const record = recordUsage(req.body);
  res.status(201).json(record);
});

/**
 * GET /api/usage/records
 * Get usage records with optional filters (admin only).
 */
router.get("/api/usage/records", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { clientId, method, path, limit } = req.query;
  const result = getUsageRecords({
    clientId: clientId || null,
    method: method || null,
    path: path || null,
    limit: limit ? parseInt(limit) : 50,
  });
  res.json(result);
});

/**
 * GET /api/usage/clients
 * Get all clients (admin only).
 */
router.get("/api/usage/clients", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const clients = getClients();
  res.json({ clients, count: clients.length });
});

/**
 * GET /api/usage/endpoints
 * Get top endpoints by usage (admin only).
 */
router.get("/api/usage/endpoints", checkAuthenticated, checkRole("admin"), (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 10;
  const endpoints = getTopEndpoints(limit);
  res.json({ endpoints, count: endpoints.length });
});

/**
 * GET /api/usage/top-clients
 * Get top clients by usage (admin only).
 */
router.get("/api/usage/top-clients", checkAuthenticated, checkRole("admin"), (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 10;
  const clients = getTopClients(limit);
  res.json({ clients, count: clients.length });
});

/**
 * GET /api/usage/timeline
 * Get usage over time (admin only).
 */
router.get("/api/usage/timeline", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const timeline = getUsageTimeline();
  res.json({ timeline });
});

/**
 * GET /api/usage/stats
 * Get overall usage statistics (admin only).
 */
router.get("/api/usage/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getUsageStats();
  res.json(stats);
});

/**
 * DELETE /api/usage/clear
 * Clear usage data (admin only).
 */
router.delete("/api/usage/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearUsageData();
  res.json({ message: "Usage data cleared" });
});

/**
 * GET /api/usage/clients/:id
 * Get a specific client's stats (admin only).
 */
router.get("/api/usage/clients/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const client = getClient(req.params.id);
  if (!client) {
    return res.status(404).json({ error: "Client not found", code: 404 });
  }
  res.json(client);
});

export default router;
