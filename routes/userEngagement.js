// User engagement routes — track feature usage and adoption

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  recordEvent,
  getFeatureStats,
  getEngagementOverview,
  getUserEngagement,
  getAdoptionMetrics,
  clearEngagementData,
} from "../utils/userEngagement.js";

const router = Router();

/**
 * POST /api/engagement/record
 * Record a user engagement event.
 * Body: { feature, action, metadata }
 */
router.post("/api/engagement/record", checkAuthenticated, (req, res) => {
  const record = recordEvent({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(record);
});

/**
 * GET /api/engagement/features
 * Get feature usage statistics (admin only).
 * Query: hours
 */
router.get("/api/engagement/features", checkAuthenticated, checkRole("admin"), (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const stats = getFeatureStats({ hours });
  res.json(stats);
});

/**
 * GET /api/engagement/overview
 * Get engagement overview (admin only).
 * Query: hours
 */
router.get("/api/engagement/overview", checkAuthenticated, checkRole("admin"), (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const overview = getEngagementOverview({ hours });
  res.json(overview);
});

/**
 * GET /api/engagement/user/:userId
 * Get user-specific engagement (admin only).
 * Query: hours
 */
router.get("/api/engagement/user/:userId", checkAuthenticated, checkRole("admin"), (req, res) => {
  const hours = parseInt(req.query.hours) || 168;
  const engagement = getUserEngagement(req.params.userId, { hours });
  res.json(engagement);
});

/**
 * GET /api/engagement/adoption
 * Get feature adoption metrics (admin only).
 * Query: hours
 */
router.get("/api/engagement/adoption", checkAuthenticated, checkRole("admin"), (req, res) => {
  const hours = parseInt(req.query.hours) || 168;
  const adoption = getAdoptionMetrics({ hours });
  res.json(adoption);
});

/**
 * DELETE /api/engagement/clear
 * Clear engagement data (admin only).
 */
router.delete("/api/engagement/clear", checkAuthenticated, checkRole("admin"), (req, res) => {
  clearEngagementData();
  res.json({ message: "Engagement data cleared" });
});

export default router;
