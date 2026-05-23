import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "result_notes.json");

const router = Router();

function readNotes() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading notes:", e.message);
  }
  return [];
}

function writeNotes(notes) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(notes, null, 2));
}

// Get all notes for current user
router.get("/api/result-notes", checkAuthenticated, (req, res) => {
  const notes = readNotes();
  const userNotes = notes
    .filter((n) => n.userId === req.session.user.id)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const start = (page - 1) * limit;
  const items = userNotes.slice(start, start + limit);

  res.json({
    items,
    total: userNotes.length,
    page,
    limit,
    totalPages: Math.ceil(userNotes.length / limit),
    hasMore: start + limit < userNotes.length,
  });
});

// Get notes for a specific URL
router.get("/api/result-notes/by-url", checkAuthenticated, (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.json(null);
  }
  const notes = readNotes();
  const note = notes.find(
    (n) => n.userId === req.session.user.id && n.url === url
  );
  res.json(note || null);
});

// Create or update a note
router.post("/api/result-notes", checkAuthenticated, (req, res) => {
  const { url, title, note, rating } = req.body;

  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  const notes = readNotes();
  const idx = notes.findIndex(
    (n) => n.userId === req.session.user.id && n.url === url
  );

  if (idx >= 0) {
    // Update existing
    if (title !== undefined) notes[idx].title = title;
    if (note !== undefined) notes[idx].note = note;
    if (rating !== undefined) notes[idx].rating = rating;
    notes[idx].updatedAt = new Date().toISOString();
    writeNotes(notes);
    res.json(notes[idx]);
  } else {
    // Create new
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      userId: req.session.user.id,
      url,
      title: title || "",
      note: note || "",
      rating: rating || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    notes.push(entry);
    writeNotes(notes);
    res.status(201).json(entry);
  }
});

// Delete a note
router.delete("/api/result-notes/:id", checkAuthenticated, (req, res) => {
  const notes = readNotes();
  const idx = notes.findIndex(
    (n) => n.id === req.params.id && n.userId === req.session.user.id
  );
  if (idx === -1) {
    return res.status(404).json({ error: "Not found" });
  }
  notes.splice(idx, 1);
  writeNotes(notes);
  res.json({ success: true });
});

// Get notes stats
router.get("/api/result-notes/stats", checkAuthenticated, (req, res) => {
  const notes = readNotes();
  const userNotes = notes.filter((n) => n.userId === req.session.user.id);
  const withRating = userNotes.filter((n) => n.rating != null);
  const avgRating =
    withRating.length > 0
      ? Math.round((withRating.reduce((s, n) => s + n.rating, 0) / withRating.length) * 10) / 10
      : 0;

  res.json({
    total: userNotes.length,
    withRating: withRating.length,
    avgRating,
  });
});

export default router;
