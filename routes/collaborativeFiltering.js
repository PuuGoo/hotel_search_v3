// Collaborative filtering routes — recommend based on similar users

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  findSimilarUsers,
  getRecommendations,
  getCollaborativeStats,
} from "../utils/collaborativeFiltering.js";

const router = Router();

/**
 * GET /api/collaborative/similar
 * Find similar users based on search patterns.
 * Query: maxSimilar
 */
router.get("/api/collaborative/similar", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const maxSimilar = parseInt(req.query.maxSimilar) || 5;

  const similarUsers = findSimilarUsers(userId, maxSimilar);
  res.json({ users: similarUsers, count: similarUsers.length });
});

/**
 * GET /api/collaborative/recommendations
 * Get collaborative filtering recommendations.
 * Query: maxRecommendations, minSimilarity
 */
router.get("/api/collaborative/recommendations", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const maxRecommendations = parseInt(req.query.maxRecommendations) || 10;
  const minSimilarity = parseFloat(req.query.minSimilarity) || 0.1;

  const recommendations = getRecommendations(userId, { maxRecommendations, minSimilarity });
  res.json(recommendations);
});

/**
 * GET /api/collaborative/stats
 * Get collaborative filtering statistics (admin only).
 */
router.get("/api/collaborative/stats", checkAuthenticated, checkRole("admin"), (req, res) => {
  const stats = getCollaborativeStats();
  res.json(stats);
});

export default router;
