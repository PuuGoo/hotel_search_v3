// Security incident tracker routes

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  createIncident,
  getIncidents,
  getIncident,
  updateIncident,
  deleteIncident,
  addComment,
  getIncidentTimeline,
  getIncidentStats,
  clearIncidentData,
} from "../utils/securityIncidents.js";

const router = Router();

/**
 * POST /api/incidents
 * Create a security incident (admin only).
 */
router.post("/api/incidents", checkAuthenticated, checkRole("admin"), (req, res) => {
  const incident = createIncident({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(incident);
});

/**
 * GET /api/incidents
 * Get incidents with optional filters.
 */
router.get("/api/incidents", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { severity, status, category, limit } = req.query;
  const result = getIncidents({
    severity: severity || null,
    status: status || null,
    category: category || null,
    limit: limit ? parseInt(limit) : 50,
  });
  res.json(result);
});

/**
 * GET /api/incidents/stats
 * Get incident statistics.
 */
router.get("/api/incidents/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getIncidentStats();
  res.json(stats);
});

/**
 * DELETE /api/incidents/clear
 * Clear incident data (admin only).
 */
router.delete("/api/incidents/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearIncidentData();
  res.json({ message: "Incident data cleared" });
});

/**
 * GET /api/incidents/:id
 * Get a specific incident.
 */
router.get("/api/incidents/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const incident = getIncident(req.params.id);
  if (!incident) {
    return res.status(404).json({ error: "Incident not found", code: 404 });
  }
  res.json(incident);
});

/**
 * PUT /api/incidents/:id
 * Update an incident (admin only).
 */
router.put("/api/incidents/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const incident = updateIncident(req.params.id, req.body, req.session.user?.id);
  if (!incident) {
    return res.status(404).json({ error: "Incident not found", code: 404 });
  }
  res.json(incident);
});

/**
 * DELETE /api/incidents/:id
 * Delete an incident (admin only).
 */
router.delete("/api/incidents/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteIncident(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Incident not found", code: 404 });
  }
  res.json({ message: "Incident deleted" });
});

/**
 * POST /api/incidents/:id/comments
 * Add a comment to an incident (admin only).
 */
router.post("/api/incidents/:id/comments", checkAuthenticated, checkRole("admin"), (req, res) => {
  const incident = addComment(req.params.id, req.body.comment, req.session.user?.id);
  if (!incident) {
    return res.status(404).json({ error: "Incident not found", code: 404 });
  }
  res.json(incident);
});

/**
 * GET /api/incidents/:id/timeline
 * Get timeline for an incident.
 */
router.get("/api/incidents/:id/timeline", checkAuthenticated, checkRole("admin"), (req, res) => {
  const timeline = getIncidentTimeline(req.params.id);
  res.json(timeline);
});

export default router;
