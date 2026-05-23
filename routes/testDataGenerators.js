// Test data generator routes — generate realistic test data

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  generateUser,
  generateUsers,
  generateSearchQuery,
  generateSearchQueries,
  generateHotelResult,
  generateHotelResults,
  generateBookmark,
  generateBookmarks,
  generatePriceAlert,
  generatePriceAlerts,
  generateWebhook,
  generateWebhooks,
  generateAuditEntry,
  generateAuditEntries,
  generateNotification,
  generateNotifications,
  getGenerators,
} from "../utils/testDataGenerators.js";

const router = Router();

/**
 * GET /api/test-data/generators
 * List available generators (admin only).
 */
router.get("/api/test-data/generators", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const generators = getGenerators();
  res.json({
    generators: Object.keys(generators),
    count: Object.keys(generators).length,
  });
});

/**
 * POST /api/test-data/generate/:type
 * Generate test data (admin only).
 * Body: { count, overrides }
 */
router.post("/api/test-data/generate/:type", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { type } = req.params;
  const { count = 1, overrides = {} } = req.body || {};

  const generatorMap = {
    user: generateUser,
    users: generateUsers,
    searchQuery: generateSearchQuery,
    searchQueries: generateSearchQueries,
    hotelResult: generateHotelResult,
    hotelResults: generateHotelResults,
    bookmark: generateBookmark,
    bookmarks: generateBookmarks,
    priceAlert: generatePriceAlert,
    priceAlerts: generatePriceAlerts,
    webhook: generateWebhook,
    webhooks: generateWebhooks,
    auditEntry: generateAuditEntry,
    auditEntries: generateAuditEntries,
    notification: generateNotification,
    notifications: generateNotifications,
  };

  const generator = generatorMap[type];
  if (!generator) {
    return res.status(400).json({
      error: `Unknown generator type: ${type}`,
      available: Object.keys(generatorMap),
      code: 400,
    });
  }

  const data = generator(count, overrides);
  res.json({
    type,
    count: Array.isArray(data) ? data.length : 1,
    data,
  });
});

export default router;
