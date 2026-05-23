// User search profile routes — personalized search experience

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  buildUserProfile,
  getUserProfile,
  compareProfiles,
  getProfileStats,
} from "../utils/userSearchProfile.js";

const router = Router();

/**
 * GET /api/profile
 * Get the current user's search profile.
 */
router.get("/api/profile", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const profile = getUserProfile(userId);
  res.json(profile);
});

/**
 * POST /api/profile/rebuild
 * Force rebuild the user's search profile.
 */
router.post("/api/profile/rebuild", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const profile = buildUserProfile(userId);
  res.json(profile);
});

/**
 * GET /api/profile/compare
 * Compare profiles between two users.
 * Query: userId1, userId2
 */
router.get("/api/profile/compare", checkAuthenticated, (req, res) => {
  const { userId1, userId2 } = req.query;

  if (!userId1 || !userId2) {
    return res.status(400).json({ error: "userId1 and userId2 are required" });
  }

  const comparison = compareProfiles(userId1, userId2);

  if (!comparison) {
    return res.status(404).json({ error: "One or both profiles not found" });
  }

  res.json(comparison);
});

/**
 * GET /api/profile/stats
 * Get profile statistics (admin only).
 */
router.get("/api/profile/stats", checkAuthenticated, checkRole("admin"), (req, res) => {
  const stats = getProfileStats();
  res.json(stats);
});

export default router;
