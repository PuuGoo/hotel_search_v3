import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "search_templates.json");

const router = Router();

function readTemplates() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading templates:", e.message);
  }
  return [];
}

function writeTemplates(templates) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(templates, null, 2));
}

// Get all templates for current user
router.get("/api/search-templates", checkAuthenticated, (req, res) => {
  const templates = readTemplates();
  const userTemplates = templates.filter((t) => t.userId === req.session.user.id);
  // Also include global templates (userId: null)
  const globalTemplates = templates.filter((t) => t.userId === null);
  res.json({ user: userTemplates, global: globalTemplates });
});

// Create a new template
router.post("/api/search-templates", checkAuthenticated, (req, res) => {
  const { name, query, engine, description, tags } = req.body;

  if (!name || !query) {
    return res.status(400).json({ error: "name and query are required" });
  }

  const templates = readTemplates();
  const template = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: req.session.user.id,
    name: name.trim(),
    query: query.trim(),
    engine: engine || "tavily",
    description: (description || "").trim(),
    tags: Array.isArray(tags) ? tags.map((t) => t.trim()).filter(Boolean) : [],
    useCount: 0,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
  };

  templates.push(template);
  writeTemplates(templates);
  res.status(201).json(template);
});

// Update a template
router.put("/api/search-templates/:id", checkAuthenticated, (req, res) => {
  const templates = readTemplates();
  const idx = templates.findIndex((t) => t.id === req.params.id && t.userId === req.session.user.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Template not found" });
  }

  const { name, query, engine, description, tags } = req.body;
  const template = templates[idx];

  if (name !== undefined) template.name = name.trim();
  if (query !== undefined) template.query = query.trim();
  if (engine !== undefined) template.engine = engine;
  if (description !== undefined) template.description = description.trim();
  if (tags !== undefined) template.tags = Array.isArray(tags) ? tags.map((t) => t.trim()).filter(Boolean) : [];

  templates[idx] = template;
  writeTemplates(templates);
  res.json(template);
});

// Delete a template
router.delete("/api/search-templates/:id", checkAuthenticated, (req, res) => {
  const templates = readTemplates();
  const idx = templates.findIndex((t) => t.id === req.params.id && t.userId === req.session.user.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Template not found" });
  }
  templates.splice(idx, 1);
  writeTemplates(templates);
  res.json({ success: true });
});

// Use a template (increment use count)
router.post("/api/search-templates/:id/use", checkAuthenticated, (req, res) => {
  const templates = readTemplates();
  const idx = templates.findIndex((t) => t.id === req.params.id && (t.userId === req.session.user.id || t.userId === null));
  if (idx === -1) {
    return res.status(404).json({ error: "Template not found" });
  }

  templates[idx].useCount = (templates[idx].useCount || 0) + 1;
  templates[idx].lastUsedAt = new Date().toISOString();
  writeTemplates(templates);
  res.json(templates[idx]);
});

// Get popular templates (by use count)
router.get("/api/search-templates/popular", checkAuthenticated, (req, res) => {
  const templates = readTemplates();
  const accessible = templates.filter((t) => t.userId === req.session.user.id || t.userId === null);
  const sorted = accessible.sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).slice(0, 10);
  res.json(sorted);
});

export default router;
