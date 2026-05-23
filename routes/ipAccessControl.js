import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IP_FILE = path.join(__dirname, "..", "ip_access_control.json");

const router = Router();

export function readIPConfig() {
  try {
    if (fs.existsSync(IP_FILE)) {
      return JSON.parse(fs.readFileSync(IP_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading IP config:", e.message);
  }
  return { mode: "disabled", whitelist: [], blacklist: [] };
}

export function writeIPConfig(data) {
  fs.writeFileSync(IP_FILE, JSON.stringify(data, null, 2));
}

// Normalize IP (handle IPv6-mapped IPv4)
function normalizeIP(ip) {
  if (!ip) return ip;
  return ip.replace(/^::ffff:/, "");
}

// Check if IP matches a CIDR range or exact match
function ipMatches(ip, rule) {
  if (rule === ip) return true;
  if (rule === "*") return true;

  // CIDR matching for IPv4
  if (rule.includes("/")) {
    const [range, bits] = rule.split("/");
    const mask = ~(2 ** (32 - parseInt(bits)) - 1);
    const ipNum = ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
    const rangeNum = range.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
    return (ipNum & mask) === (rangeNum & mask);
  }

  return false;
}

// Middleware to enforce IP access control on admin routes
export function ipAccessControl(req, res, next) {
  const config = readIPConfig();

  if (config.mode === "disabled") {
    return next();
  }

  const ip = normalizeIP(req.ip);

  if (config.mode === "whitelist") {
    const allowed = (config.whitelist || []).some((rule) => ipMatches(ip, rule));
    if (!allowed) {
      return res.status(403).json({ error: "IP not whitelisted for admin access" });
    }
  }

  if (config.mode === "blacklist") {
    const blocked = (config.blacklist || []).some((rule) => ipMatches(ip, rule));
    if (blocked) {
      return res.status(403).json({ error: "IP blacklisted" });
    }
  }

  next();
}

// GET /api/admin/ip-access — get current config
router.get("/api/admin/ip-access", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const config = readIPConfig();
  res.json(config);
});

// PUT /api/admin/ip-access — update config
router.put("/api/admin/ip-access", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { mode, whitelist, blacklist } = req.body;

  if (mode && !["disabled", "whitelist", "blacklist"].includes(mode)) {
    return res.status(400).json({ error: "Mode must be disabled, whitelist, or blacklist" });
  }

  const config = readIPConfig();

  if (mode) config.mode = mode;
  if (Array.isArray(whitelist)) {
    config.whitelist = whitelist.map((ip) => ip.trim()).filter(Boolean);
  }
  if (Array.isArray(blacklist)) {
    config.blacklist = blacklist.map((ip) => ip.trim()).filter(Boolean);
  }

  writeIPConfig(config);
  res.json(config);
});

// POST /api/admin/ip-access/whitelist — add IP to whitelist
router.post("/api/admin/ip-access/whitelist", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { ip } = req.body;

  if (!ip || typeof ip !== "string") {
    return res.status(400).json({ error: "IP address required" });
  }

  const trimmed = ip.trim();
  const config = readIPConfig();

  if (!config.whitelist.includes(trimmed)) {
    config.whitelist.push(trimmed);
    writeIPConfig(config);
  }

  res.json({ success: true, whitelist: config.whitelist });
});

// DELETE /api/admin/ip-access/whitelist?ip=... — remove IP from whitelist
router.delete("/api/admin/ip-access/whitelist", checkAuthenticated, checkRole("admin"), (req, res) => {
  const ip = req.query.ip || req.body?.ip;

  if (!ip) {
    return res.status(400).json({ error: "IP address required" });
  }

  const config = readIPConfig();
  config.whitelist = config.whitelist.filter((i) => i !== ip);
  writeIPConfig(config);

  res.json({ success: true, whitelist: config.whitelist });
});

// POST /api/admin/ip-access/blacklist — add IP to blacklist
router.post("/api/admin/ip-access/blacklist", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { ip } = req.body;

  if (!ip || typeof ip !== "string") {
    return res.status(400).json({ error: "IP address required" });
  }

  const trimmed = ip.trim();
  const config = readIPConfig();

  if (!config.blacklist.includes(trimmed)) {
    config.blacklist.push(trimmed);
    writeIPConfig(config);
  }

  res.json({ success: true, blacklist: config.blacklist });
});

// DELETE /api/admin/ip-access/blacklist?ip=... — remove IP from blacklist
router.delete("/api/admin/ip-access/blacklist", checkAuthenticated, checkRole("admin"), (req, res) => {
  const ip = req.query.ip || req.body?.ip;

  if (!ip) {
    return res.status(400).json({ error: "IP address required" });
  }

  const config = readIPConfig();
  config.blacklist = config.blacklist.filter((i) => i !== ip);
  writeIPConfig(config);

  res.json({ success: true, blacklist: config.blacklist });
});

export default router;
