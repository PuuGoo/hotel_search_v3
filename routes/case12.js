import { Router } from "express";
import multer from "multer";
import { checkAuthenticated, checkFeature } from "../middleware/auth.js";
import config from "../utils/config.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const CASE12_API_URL = config.case12.apiUrl || "https://hotel-search-v2-api.vercel.app/api/case12";

// Health check
router.get("/api/case12/health", checkAuthenticated, checkFeature("case12"), async (_req, res) => {
  try {
    const response = await fetch(CASE12_API_URL);
    const body = await response.text();
    return res.status(response.status).type("application/json").send(body);
  } catch (error) {
    console.error("Case12 health check error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Cannot connect to Case12 API",
    });
  }
});

// File upload and proxy
router.post("/api/case12", checkAuthenticated, checkFeature("case12"), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Missing file upload (field name: file)" });
    }

    const formData = new FormData();
    const fileBlob = new Blob([req.file.buffer], {
      type: req.file.mimetype || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    formData.append("file", fileBlob, req.file.originalname || "input.xlsx");

    const response = await fetch(CASE12_API_URL, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).send(errorText);
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const disposition = response.headers.get("content-disposition") || 'attachment; filename="verified_case12.xlsx"';

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", disposition);
    return res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error("Case12 API error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Case12 API error",
    });
  }
});

export default router;
