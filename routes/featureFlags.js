import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FLAGS_FILE = path.join(__dirname, "..", "feature_flags.json");

const router = Router();

export function readFlags() {
  try {
    if (fs.existsSync(FLAGS_FILE)) {
      return JSON.parse(fs.readFileSync(FLAGS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading feature flags:", e.message);
  }
  return { flags: [] };
}

export function writeFlags(data) {
  fs.writeFileSync(FLAGS_FILE, JSON.stringify(data, null, 2));
}

// Check if a feature flag is enabled (for use in other code)
export function isFeatureEnabled(flagName) {
  const data = readFlags();
  const flag = data.flags.find((f) => f.name === flagName);
  return flag ? flag.enabled : false;
}

// GET /api/admin/flags — list all feature flags
router.get("/api/admin/flags", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const data = readFlags();
  res.json({ flags: data.flags || [] });
});

// POST /api/admin/flags — create a feature flag
router.post("/api/admin/flags", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { name, description } = req.body;

  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Flag name is required" });
  }

  const trimmed = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (trimmed.length < 2 || trimmed.length > 50) {
    return res.status(400).json({ error: "Flag name must be 2-50 characters (letters, numbers, hyphens)" });
  }

  const data = readFlags();
  if (data.flags.find((f) => f.name === trimmed)) {
    return res.status(409).json({ error: "Flag already exists" });
  }

  const flag = {
    name: trimmed,
    description: description?.trim() || "",
    enabled: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  data.flags.push(flag);
  writeFlags(data);

  res.status(201).json(flag);
});

// PUT /api/admin/flags/:name — toggle or update a flag
router.put("/api/admin/flags/:name", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { name } = req.params;
  const { enabled, description } = req.body;

  const data = readFlags();
  const flag = data.flags.find((f) => f.name === name);

  if (!flag) {
    return res.status(404).json({ error: "Flag not found" });
  }

  if (typeof enabled === "boolean") {
    flag.enabled = enabled;
  }
  if (description !== undefined) {
    flag.description = description.trim();
  }
  flag.updatedAt = Date.now();

  writeFlags(data);
  res.json(flag);
});

// DELETE /api/admin/flags/:name — delete a flag
router.delete("/api/admin/flags/:name", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { name } = req.params;
  const data = readFlags();
  const index = data.flags.findIndex((f) => f.name === name);

  if (index === -1) {
    return res.status(404).json({ error: "Flag not found" });
  }

  data.flags.splice(index, 1);
  writeFlags(data);
  res.json({ success: true });
});

// GET /api/flags — public endpoint for clients to check flags
router.get("/api/flags", checkAuthenticated, (_req, res) => {
  const data = readFlags();
  const flags = (data.flags || []).map((f) => ({
    name: f.name,
    enabled: f.enabled,
  }));
  res.json({ flags });
});

export default router;
