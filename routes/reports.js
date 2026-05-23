// Report routes — generate printable HTML reports for PDF export

import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");
const ALERTS_FILE = path.join(__dirname, "..", "price_alerts.json");

const router = Router();

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return [];
}

function getUserData(filePath, userId) {
  const all = readJSON(filePath);
  return Array.isArray(all) ? all.filter((item) => item.userId === userId) : [];
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * GET /api/reports/search-history
 * Returns a printable HTML report of search history.
 */
router.get("/api/reports/search-history", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const history = getUserData(HISTORY_FILE, userId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 100);

  const engineCounts = {};
  history.forEach((h) => {
    const engine = h.engine || "unknown";
    engineCounts[engine] = (engineCounts[engine] || 0) + 1;
  });

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Search History Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #333; }
  h1 { color: #1976d2; border-bottom: 2px solid #1976d2; padding-bottom: 8px; }
  .meta { color: #666; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
  th { background: #f5f5f5; font-weight: 600; }
  .summary { display: flex; gap: 24px; margin: 20px 0; }
  .summary-item { text-align: center; }
  .summary-item .value { font-size: 2rem; font-weight: 700; color: #1976d2; }
  .summary-item .label { font-size: 0.85rem; color: #666; }
  @media print { body { padding: 20px; } }
</style>
</head><body>
<h1>Search History Report</h1>
<div class="meta">Generated: ${new Date().toLocaleString()} | User: ${escapeHtml(req.session.user.username || userId)}</div>

<div class="summary">
  <div class="summary-item"><div class="value">${history.length}</div><div class="label">Total Searches</div></div>
  <div class="summary-item"><div class="value">${Object.keys(engineCounts).length}</div><div class="label">Engines Used</div></div>
  ${Object.entries(engineCounts).map(([eng, cnt]) => `<div class="summary-item"><div class="value">${cnt}</div><div class="label">${escapeHtml(eng)}</div></div>`).join("")}
</div>

<table>
<thead><tr><th>Date</th><th>Query</th><th>Engine</th><th>Results</th></tr></thead>
<tbody>
${history.map((h) => `<tr><td>${new Date(h.timestamp).toLocaleDateString()}</td><td>${escapeHtml(h.query)}</td><td>${escapeHtml(h.engine || "-")}</td><td>${h.resultCount || "-"}</td></tr>`).join("")}
</tbody>
</table>
<script>window.onload = () => window.print();</script>
</body></html>`;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

/**
 * GET /api/reports/bookmarks
 * Returns a printable HTML report of bookmarks.
 */
router.get("/api/reports/bookmarks", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const bookmarks = getUserData(BOOKMARKS_FILE, userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const engineCounts = {};
  bookmarks.forEach((b) => {
    const engine = b.engine || "unknown";
    engineCounts[engine] = (engineCounts[engine] || 0) + 1;
  });

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Bookmarks Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #333; }
  h1 { color: #1976d2; border-bottom: 2px solid #1976d2; padding-bottom: 8px; }
  .meta { color: #666; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
  th { background: #f5f5f5; font-weight: 600; }
  td a { color: #1976d2; text-decoration: none; }
  .summary { display: flex; gap: 24px; margin: 20px 0; }
  .summary-item { text-align: center; }
  .summary-item .value { font-size: 2rem; font-weight: 700; color: #1976d2; }
  .summary-item .label { font-size: 0.85rem; color: #666; }
  @media print { body { padding: 20px; } }
</style>
</head><body>
<h1>Bookmarks Report</h1>
<div class="meta">Generated: ${new Date().toLocaleString()} | User: ${escapeHtml(req.session.user.username || userId)}</div>

<div class="summary">
  <div class="summary-item"><div class="value">${bookmarks.length}</div><div class="label">Total Bookmarks</div></div>
  ${Object.entries(engineCounts).map(([eng, cnt]) => `<div class="summary-item"><div class="value">${cnt}</div><div class="label">${escapeHtml(eng)}</div></div>`).join("")}
</div>

<table>
<thead><tr><th>Date</th><th>Name</th><th>URL</th><th>Tags</th></tr></thead>
<tbody>
${bookmarks.map((b) => `<tr><td>${new Date(b.createdAt).toLocaleDateString()}</td><td>${escapeHtml(b.title || b.name || "-")}</td><td>${b.url ? `<a href="${escapeHtml(b.url)}">${escapeHtml(b.url.substring(0, 50))}...</a>` : "-"}</td><td>${escapeHtml((b.tags || []).join(", "))}</td></tr>`).join("")}
</tbody>
</table>
<script>window.onload = () => window.print();</script>
</body></html>`;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

/**
 * GET /api/reports/price-alerts
 * Returns a printable HTML report of price alerts.
 */
router.get("/api/reports/price-alerts", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const alerts = getUserData(ALERTS_FILE, userId);

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Price Alerts Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #333; }
  h1 { color: #1976d2; border-bottom: 2px solid #1976d2; padding-bottom: 8px; }
  .meta { color: #666; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
  th { background: #f5f5f5; font-weight: 600; }
  .status-active { color: #2e7d32; font-weight: 600; }
  .status-triggered { color: #e65100; font-weight: 600; }
  @media print { body { padding: 20px; } }
</style>
</head><body>
<h1>Price Alerts Report</h1>
<div class="meta">Generated: ${new Date().toLocaleString()} | User: ${escapeHtml(req.session.user.username || userId)}</div>

<div class="summary">
  <div class="summary-item"><div class="value">${alerts.length}</div><div class="label">Total Alerts</div></div>
  <div class="summary-item"><div class="value">${alerts.filter((a) => a.active !== false).length}</div><div class="label">Active</div></div>
</div>

<table>
<thead><tr><th>Hotel</th><th>Target Price</th><th>Current Price</th><th>Status</th><th>Created</th></tr></thead>
<tbody>
${alerts.map((a) => `<tr><td>${escapeHtml(a.hotelName || a.query || "-")}</td><td>${a.targetPrice ? "$" + a.targetPrice : "-"}</td><td>${a.currentPrice ? "$" + a.currentPrice : "-"}</td><td class="${a.triggered ? "status-triggered" : "status-active"}">${a.triggered ? "Triggered" : "Active"}</td><td>${new Date(a.createdAt).toLocaleDateString()}</td></tr>`).join("")}
</tbody>
</table>
<script>window.onload = () => window.print();</script>
</body></html>`;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

export default router;
