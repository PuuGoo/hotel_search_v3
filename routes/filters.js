import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";
import { applyFilters, sortResults, extractDomains } from "../utils/filters.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAVED_FILTERS_FILE = path.join(__dirname, "..", "saved_filters.json");
const MAX_SAVED_FILTERS = 20;

const router = Router();

function readSavedFilters() {
  try {
    if (fs.existsSync(SAVED_FILTERS_FILE)) {
      return JSON.parse(fs.readFileSync(SAVED_FILTERS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading saved filters:", e.message);
  }
  return {};
}

function writeSavedFilters(data) {
  fs.writeFileSync(SAVED_FILTERS_FILE, JSON.stringify(data, null, 2), "utf8");
}

// Filter and sort any array of results (client sends results, server filters)
router.post("/api/filter-results", checkAuthenticated, (req, res) => {
  const { results, filters, sortBy, sortOrder } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results must be an array" });
  }

  let filtered = applyFilters(results, filters || {});
  const totalBefore = results.length;

  if (sortBy) {
    filtered = sortResults(filtered, sortBy, sortOrder || "desc");
  }

  // Apply limit after filtering
  if (filters?.limit && filters.limit > 0) {
    filtered = filtered.slice(0, filters.limit);
  }

  const domains = extractDomains(filtered);

  res.json({
    results: filtered,
    total: filtered.length,
    totalBefore,
    domains: domains.slice(0, 20),
    filters: filters || {},
  });
});

// Get available filter options (domains) from results
router.post("/api/filter-options", checkAuthenticated, (req, res) => {
  const { results } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "results must be an array" });
  }

  const domains = extractDomains(results);
  res.json({ domains });
});

// List saved filter presets
router.get("/api/filters/saved", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const allFilters = readSavedFilters();
  res.json(allFilters[userId] || []);
});

// Create a saved filter preset
router.post("/api/filters/saved", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { name, filters } = req.body;

  if (!name || typeof name !== "string" || name.trim().length < 1) {
    return res.status(400).json({ error: "Name is required" });
  }

  const sanitizedName = name.replace(/[<>]/g, "").trim().slice(0, 100);
  const allFilters = readSavedFilters();
  if (!allFilters[userId]) allFilters[userId] = [];

  if (allFilters[userId].length >= MAX_SAVED_FILTERS) {
    return res.status(400).json({ error: `Maximum ${MAX_SAVED_FILTERS} filters allowed` });
  }

  const entry = {
    id: Date.now(),
    name: sanitizedName,
    filters: filters || {},
    timestamp: Date.now(),
  };

  allFilters[userId].push(entry);
  writeSavedFilters(allFilters);
  res.json({ success: true, filter: entry });
});

// Update a saved filter preset
router.put("/api/filters/saved/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const id = Number(req.params.id);
  const { name, filters } = req.body;

  const allFilters = readSavedFilters();
  const userFilters = allFilters[userId] || [];
  const filter = userFilters.find((f) => f.id === id);

  if (!filter) {
    return res.status(404).json({ error: "Filter not found" });
  }

  if (name) filter.name = name.replace(/[<>]/g, "").trim().slice(0, 100);
  if (filters) filter.filters = filters;

  writeSavedFilters(allFilters);
  res.json({ success: true, filter });
});

// Delete a saved filter preset
router.delete("/api/filters/saved/:id", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const id = Number(req.params.id);

  const allFilters = readSavedFilters();
  const userFilters = allFilters[userId] || [];
  const index = userFilters.findIndex((f) => f.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Filter not found" });
  }

  userFilters.splice(index, 1);
  allFilters[userId] = userFilters;
  writeSavedFilters(allFilters);
  res.json({ success: true });
});

export default router;
