// Favorites sync routes — sync starred results across devices

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import {
  getFavorites,
  addFavorite,
  removeFavorite,
  updateFavorite,
  getSyncStatus,
  syncFavorites,
  getFavoritesStats,
} from "../utils/favoritesSync.js";

const router = Router();

/**
 * GET /api/favorites
 * Get all favorites for the current user.
 */
router.get("/api/favorites", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const favorites = getFavorites(userId);
  res.json(favorites);
});

/**
 * POST /api/favorites
 * Add a favorite.
 * Body: { url, title?, description?, engine?, imageUrl?, price?, rating?, tags? }
 */
router.post("/api/favorites", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { url, title, description, engine, imageUrl, price, rating, tags } = req.body;

  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  try {
    const result = addFavorite(userId, { url, title, description, engine, imageUrl, price, rating, tags });
    res.status(result.added ? 201 : 200).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/favorites/:id
 * Remove a favorite.
 */
router.delete("/api/favorites/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const removed = removeFavorite(userId, req.params.id);

  if (!removed) {
    return res.status(404).json({ error: "Favorite not found" });
  }

  res.json({ message: "Favorite removed" });
});

/**
 * PUT /api/favorites/:id
 * Update a favorite (tags, notes, etc).
 * Body: { title?, description?, tags?, notes?, rating?, price? }
 */
router.put("/api/favorites/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const updated = updateFavorite(userId, req.params.id, req.body);

  if (!updated) {
    return res.status(404).json({ error: "Favorite not found" });
  }

  res.json(updated);
});

/**
 * GET /api/favorites/sync/status
 * Get sync status for the current user.
 */
router.get("/api/favorites/sync/status", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const status = getSyncStatus(userId);
  res.json(status);
});

/**
 * POST /api/favorites/sync
 * Sync favorites from a client device.
 * Body: { syncToken?, items[] }
 */
router.post("/api/favorites/sync", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const clientData = req.body;

  try {
    const result = syncFavorites(userId, clientData);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/favorites/stats
 * Get favorites statistics.
 */
router.get("/api/favorites/stats", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const stats = getFavoritesStats(userId);
  res.json(stats);
});

export default router;
