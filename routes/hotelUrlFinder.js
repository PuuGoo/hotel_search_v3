import { Router } from "express";
import multer from "multer";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const router = Router();
const upload = multer({ dest: path.join(PROJECT_ROOT, "uploads"), limits: { fileSize: 16 * 1024 * 1024 } });

// Store active jobs
const jobs = new Map();

/**
 * @swagger
 * /hotel-finder/upload:
 *   post:
 *     summary: Upload Excel file for hotel URL finding
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: file
 *         type: file
 *         required: true
 *         description: Excel file (.xlsx) with child_hotel_name and child_hotel_address columns
 *     responses:
 *       200:
 *         description: Job started
 */
router.post("/hotel-finder/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  if (!req.file.originalname.endsWith(".xlsx")) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Only .xlsx files supported" });
  }

  const jobId = randomUUID().slice(0, 8);
  const outputPath = path.join(PROJECT_ROOT, "uploads", `${jobId}_output.xlsx`);

  jobs.set(jobId, {
    status: "running",
    rows: [],
    total: 0,
    output: null,
    error: null,
    filename: req.file.originalname,
  });

  // Spawn Python CLI with --json flag
  const py = spawn("python", [
    path.join(PROJECT_ROOT, "hotel_url_finder_cli.py"),
    "--input", req.file.path,
    "--output", outputPath,
    "--json",
  ], { cwd: PROJECT_ROOT });

  let buffer = "";

  py.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        const job = jobs.get(jobId);
        if (!job) continue;

        if (data.type === "start") {
          job.total = data.total;
        } else if (data.type === "row") {
          job.rows.push(data);
        } else if (data.type === "done") {
          job.status = "done";
          job.output = data.output;
        }
      } catch {
        // Not JSON, skip (could be log output from other modules)
      }
    }
  });

  py.stderr.on("data", (chunk) => {
    const msg = chunk.toString();
    // Playwright/stealth logs go to stderr, only capture real errors
    if (msg.includes("Error") || msg.includes("Traceback")) {
      const job = jobs.get(jobId);
      if (job) job.error = msg;
    }
  });

  py.on("close", (code) => {
    const job = jobs.get(jobId);
    if (job && job.status !== "done") {
      job.status = code === 0 ? "done" : "error";
      if (code !== 0 && !job.error) job.error = `Process exited with code ${code}`;
      if (!job.output) job.output = outputPath;
    }
    // Clean up uploaded file
    try { fs.unlinkSync(req.file.path); } catch {}
  });

  res.json({ job_id: jobId });
});

/**
 * @swagger
 * /hotel-finder/progress/{jobId}:
 *   get:
 *     summary: SSE stream of processing progress
 */
router.get("/hotel-finder/progress/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let sentCount = 0;

  const interval = setInterval(() => {
    const j = jobs.get(jobId);
    if (!j) {
      res.write(`data: ${JSON.stringify({ type: "error", error: "Job lost" })}\n\n`);
      clearInterval(interval);
      res.end();
      return;
    }

    // Send new rows
    while (sentCount < j.rows.length) {
      const row = j.rows[sentCount];
      res.write(`data: ${JSON.stringify(row)}\n\n`);
      sentCount++;
    }

    // Send status heartbeat
    res.write(`data: ${JSON.stringify({ type: "status", status: j.status, current: sentCount, total: j.total })}\n\n`);

    // If done or error, send final event and close
    if (j.status === "done") {
      res.write(`data: ${JSON.stringify({ type: "complete", output: `/hotel-finder/download/${jobId}` })}\n\n`);
      clearInterval(interval);
      res.end();
    } else if (j.status === "error") {
      res.write(`data: ${JSON.stringify({ type: "error", error: j.error || "Unknown error" })}\n\n`);
      clearInterval(interval);
      res.end();
    }
  }, 500);

  req.on("close", () => {
    clearInterval(interval);
  });
});

/**
 * @swagger
 * /hotel-finder/download/{jobId}:
 *   get:
 *     summary: Download output Excel file
 */
router.get("/hotel-finder/download/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job || job.status !== "done" || !job.output) {
    return res.status(404).json({ error: "File not ready" });
  }

  if (!fs.existsSync(job.output)) {
    return res.status(404).json({ error: "Output file not found" });
  }

  res.download(job.output, `output_${job.filename}`);
});

export default router;
