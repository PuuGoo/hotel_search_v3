// Result clustering routes — group similar results together

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import {
  clusterResults,
  clusterByLocation,
  clusterByPrice,
  getClusteringStats,
} from "../utils/resultClustering.js";

const router = Router();

/**
 * POST /api/clustering/text
 * Cluster results by text similarity.
 * Body: { results, threshold?, maxClusters? }
 */
router.post("/api/clustering/text", checkAuthenticated, (req, res) => {
  const { results, threshold, maxClusters } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results array is required" });
  }

  const clusters = clusterResults(results, { threshold, maxClusters });
  res.json({ clusters, count: clusters.length });
});

/**
 * POST /api/clustering/location
 * Cluster results by location.
 * Body: { results }
 */
router.post("/api/clustering/location", checkAuthenticated, (req, res) => {
  const { results } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results array is required" });
  }

  const clusters = clusterByLocation(results);
  res.json({ clusters, count: clusters.length });
});

/**
 * POST /api/clustering/price
 * Cluster results by price range.
 * Body: { results, ranges? }
 */
router.post("/api/clustering/price", checkAuthenticated, (req, res) => {
  const { results, ranges } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results array is required" });
  }

  const clusters = clusterByPrice(results, ranges);
  res.json({ clusters, count: clusters.length });
});

/**
 * POST /api/clustering/stats
 * Get clustering statistics.
 * Body: { results, threshold? }
 */
router.post("/api/clustering/stats", checkAuthenticated, (req, res) => {
  const { results, threshold } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results array is required" });
  }

  const stats = getClusteringStats(results, { threshold });
  res.json(stats);
});

export default router;
