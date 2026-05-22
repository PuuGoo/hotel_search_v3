import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, "..", "users.json");

export function readUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading users.json:", e.message);
  }
  return [];
}

export function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

export function checkAuthenticated(req, res, next) {
  if (req.session.isAuthenticated) {
    return next();
  }
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return res.redirect("/");
}

export function checkRole(...roles) {
  return (req, res, next) => {
    if (!req.session.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!roles.includes(req.session.user?.role)) {
      return res.status(403).json({ error: "Access denied" });
    }
    next();
  };
}

export function checkFeature(...features) {
  return (req, res, next) => {
    if (!req.session.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userFeatures = req.session.user?.features || [];
    if (!features.some((f) => userFeatures.includes(f))) {
      return res.status(403).json({ error: "Access denied for this feature" });
    }
    next();
  };
}

export const VALID_FEATURES = ["tavily", "ddg", "case12"];
