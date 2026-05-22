import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

const router = Router();

router.get("/BRAVE_MASTER", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "hotelSearchMaster.html"));
});

router.get("/AZURE_CHILD", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "hotelSearchChild.html"));
});

router.get("/searchXNG", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "hotelSearchXNG.html"));
});

router.get("/roomXNG", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "hotelRoomXNG.html"));
});

router.get("/CRAWLBASE_MASTER", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "crawlbaseMaster.html"));
});

export default router;
