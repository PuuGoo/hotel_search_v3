import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "price_alerts.json");

const router = Router();

function readAlerts() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading price alerts:", e.message);
  }
  return [];
}

function writeAlerts(alerts) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(alerts, null, 2));
}

// Get all alerts for current user
router.get("/api/price-alerts", checkAuthenticated, (req, res) => {
  const alerts = readAlerts();
  const userAlerts = alerts.filter((a) => a.userId === req.session.user.id);
  res.json(userAlerts);
});

// Create a new price alert
router.post("/api/price-alerts", checkAuthenticated, (req, res) => {
  const { hotelName, hotelUrl, targetPrice, direction, engine } = req.body;

  if (!hotelName || !targetPrice) {
    return res.status(400).json({ error: "hotelName and targetPrice are required" });
  }

  const price = parseFloat(targetPrice);
  if (isNaN(price) || price <= 0) {
    return res.status(400).json({ error: "targetPrice must be a positive number" });
  }

  const alerts = readAlerts();
  const alert = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: req.session.user.id,
    hotelName: hotelName.trim(),
    hotelUrl: (hotelUrl || "").trim(),
    targetPrice: price,
    direction: direction === "above" ? "above" : "below",
    engine: engine || "any",
    status: "active",
    lastCheckedPrice: null,
    lastCheckedAt: null,
    triggeredAt: null,
    priceHistory: [],
    createdAt: new Date().toISOString(),
  };

  alerts.push(alert);
  writeAlerts(alerts);
  res.status(201).json(alert);
});

// Update an alert
router.put("/api/price-alerts/:id", checkAuthenticated, (req, res) => {
  const alerts = readAlerts();
  const idx = alerts.findIndex((a) => a.id === req.params.id && a.userId === req.session.user.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Alert not found" });
  }

  const { hotelName, hotelUrl, targetPrice, direction, engine, status } = req.body;
  const alert = alerts[idx];

  if (hotelName !== undefined) alert.hotelName = hotelName.trim();
  if (hotelUrl !== undefined) alert.hotelUrl = hotelUrl.trim();
  if (targetPrice !== undefined) {
    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) {
      return res.status(400).json({ error: "targetPrice must be a positive number" });
    }
    alert.targetPrice = price;
  }
  if (direction !== undefined) alert.direction = direction === "above" ? "above" : "below";
  if (engine !== undefined) alert.engine = engine;
  if (status !== undefined) alert.status = status;

  alerts[idx] = alert;
  writeAlerts(alerts);
  res.json(alert);
});

// Delete an alert
router.delete("/api/price-alerts/:id", checkAuthenticated, (req, res) => {
  const alerts = readAlerts();
  const idx = alerts.findIndex((a) => a.id === req.params.id && a.userId === req.session.user.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Alert not found" });
  }
  alerts.splice(idx, 1);
  writeAlerts(alerts);
  res.json({ success: true });
});

// Check a specific alert (simulate price check)
router.post("/api/price-alerts/:id/check", checkAuthenticated, (req, res) => {
  const alerts = readAlerts();
  const idx = alerts.findIndex((a) => a.id === req.params.id && a.userId === req.session.user.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Alert not found" });
  }

  const alert = alerts[idx];
  const currentPrice = parseFloat(req.body.currentPrice);
  if (isNaN(currentPrice) || currentPrice <= 0) {
    return res.status(400).json({ error: "currentPrice is required and must be positive" });
  }

  alert.priceHistory.push({
    price: currentPrice,
    checkedAt: new Date().toISOString(),
  });

  // Keep last 100 entries
  if (alert.priceHistory.length > 100) {
    alert.priceHistory = alert.priceHistory.slice(-100);
  }

  alert.lastCheckedPrice = currentPrice;
  alert.lastCheckedAt = new Date().toISOString();

  // Check if triggered
  const triggered =
    (alert.direction === "below" && currentPrice <= alert.targetPrice) ||
    (alert.direction === "above" && currentPrice >= alert.targetPrice);

  if (triggered && alert.status === "active") {
    alert.status = "triggered";
    alert.triggeredAt = new Date().toISOString();
  }

  alerts[idx] = alert;
  writeAlerts(alerts);
  res.json({
    alert,
    triggered,
    message: triggered
      ? `Price alert triggered! ${currentPrice} is ${alert.direction} target ${alert.targetPrice}`
      : `Price ${currentPrice} has not ${alert.direction === "below" ? "dropped to" : "reached"} ${alert.targetPrice}`,
  });
});

// Get price history for an alert
router.get("/api/price-alerts/:id/history", checkAuthenticated, (req, res) => {
  const alerts = readAlerts();
  const alert = alerts.find((a) => a.id === req.params.id && a.userId === req.session.user.id);
  if (!alert) {
    return res.status(404).json({ error: "Alert not found" });
  }
  res.json({ id: alert.id, hotelName: alert.hotelName, history: alert.priceHistory });
});

// Bulk check all active alerts (admin)
router.post("/api/price-alerts/check-all", checkAuthenticated, (req, res) => {
  const alerts = readAlerts();
  const userAlerts = alerts.filter(
    (a) => a.userId === req.session.user.id && a.status === "active"
  );
  res.json({
    total: userAlerts.length,
    message: `Found ${userAlerts.length} active alerts. Use individual check endpoints with current price data.`,
  });
});

// Stats for current user
router.get("/api/price-alerts/stats", checkAuthenticated, (req, res) => {
  const alerts = readAlerts();
  const userAlerts = alerts.filter((a) => a.userId === req.session.user.id);
  const active = userAlerts.filter((a) => a.status === "active").length;
  const triggered = userAlerts.filter((a) => a.status === "triggered").length;
  const paused = userAlerts.filter((a) => a.status === "paused").length;
  res.json({ total: userAlerts.length, active, triggered, paused });
});

/**
 * @swagger
 * /api/price-alerts/history:
 *   get:
 *     summary: Get aggregated price history
 *     description: Returns price history for all alerts with data, for chart visualization
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Aggregated price history
 *       401:
 *         description: Not authenticated
 */
router.get("/api/price-alerts/history", checkAuthenticated, (req, res) => {
  const alerts = readAlerts();
  const userAlerts = alerts.filter((a) => a.userId === req.session.user.id && a.priceHistory.length > 0);

  const alertHistories = userAlerts.map((a) => ({
    id: a.id,
    hotelName: a.hotelName,
    targetPrice: a.targetPrice,
    direction: a.direction,
    status: a.status,
    history: a.priceHistory.map((h) => ({
      price: h.price,
      checkedAt: h.checkedAt,
    })),
    currentPrice: a.lastCheckedPrice,
    minPrice: Math.min(...a.priceHistory.map((h) => h.price)),
    maxPrice: Math.max(...a.priceHistory.map((h) => h.price)),
    avgPrice: Math.round(a.priceHistory.reduce((s, h) => s + h.price, 0) / a.priceHistory.length * 100) / 100,
  }));

  res.json({ alerts: alertHistories, total: alertHistories.length });
});

export default router;
