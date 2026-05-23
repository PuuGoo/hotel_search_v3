// Endpoint documentation auto-generation — generate docs from route definitions
// Introspects Express router to generate API documentation

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_FILE = path.join(__dirname, "..", "endpoint_docs.json");

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { endpoints: [], customDocs: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

// Pre-defined endpoint documentation
const BUILTIN_DOCS = {
  "POST /api/auth/login": {
    summary: "User login",
    description: "Authenticate user with username and password. Returns session cookie.",
    requestBody: { username: "string (required)", password: "string (required)" },
    responses: { 200: "Login successful", 401: "Invalid credentials" },
    auth: false,
    tags: ["auth"],
  },
  "POST /api/auth/register": {
    summary: "User registration",
    description: "Create a new user account.",
    requestBody: { username: "string (required, 2-50 chars)", password: "string (required, 6+ chars)", role: "string (optional, user|admin)" },
    responses: { 201: "Registration successful", 400: "Username taken" },
    auth: false,
    tags: ["auth"],
  },
  "POST /api/auth/logout": {
    summary: "User logout",
    description: "Destroy current session.",
    responses: { 200: "Logged out" },
    auth: true,
    tags: ["auth"],
  },
  "GET /api/me": {
    summary: "Get current user",
    description: "Returns current authenticated user info.",
    responses: { 200: "User object", 401: "Not authenticated" },
    auth: true,
    tags: ["users"],
  },
  "GET /api/search-history": {
    summary: "Get search history",
    description: "Returns paginated search history for current user.",
    queryParams: { page: "number", limit: "number" },
    responses: { 200: "Paginated history" },
    auth: true,
    tags: ["search"],
  },
  "GET /api/bookmarks": {
    summary: "Get bookmarks",
    description: "Returns paginated bookmarks for current user.",
    queryParams: { page: "number", limit: "number", folder: "string" },
    responses: { 200: "Paginated bookmarks" },
    auth: true,
    tags: ["bookmarks"],
  },
  "GET /health": {
    summary: "Health check",
    description: "Returns server health status with dependency checks.",
    responses: { 200: "Healthy", 503: "Degraded" },
    auth: false,
    tags: ["system"],
  },
  "GET /metrics": {
    summary: "Prometheus metrics",
    description: "Returns Prometheus-format metrics for scraping.",
    responses: { 200: "Metrics text" },
    auth: false,
    tags: ["system"],
  },
};

/**
 * Get all endpoint documentation.
 */
export function getAllDocs() {
  const custom = readJSON(DOCS_FILE);
  const merged = { ...BUILTIN_DOCS };

  // Merge custom docs
  if (custom.customDocs) {
    for (const [key, value] of Object.entries(custom.customDocs)) {
      merged[key] = { ...merged[key], ...value };
    }
  }

  return merged;
}

/**
 * Get documentation for a specific endpoint.
 */
export function getEndpointDoc(endpoint) {
  const all = getAllDocs();
  return all[endpoint] || null;
}

/**
 * Add or update custom endpoint documentation.
 */
export function setEndpointDoc(endpoint, doc) {
  const data = readJSON(DOCS_FILE);
  if (!data.customDocs) data.customDocs = {};
  data.customDocs[endpoint] = { ...data.customDocs[endpoint], ...doc };
  writeJSON(DOCS_FILE, data);
  return data.customDocs[endpoint];
}

/**
 * Remove custom endpoint documentation.
 */
export function removeEndpointDoc(endpoint) {
  const data = readJSON(DOCS_FILE);
  if (data.customDocs && data.customDocs[endpoint]) {
    delete data.customDocs[endpoint];
    writeJSON(DOCS_FILE, data);
    return true;
  }
  return false;
}

/**
 * Get documentation grouped by tags.
 */
export function getDocsByTag() {
  const all = getAllDocs();
  const grouped = {};

  for (const [endpoint, doc] of Object.entries(all)) {
    const tags = doc.tags || ["untagged"];
    for (const tag of tags) {
      if (!grouped[tag]) grouped[tag] = [];
      grouped[tag].push({ endpoint, ...doc });
    }
  }

  return grouped;
}

/**
 * Get documentation statistics.
 */
export function getDocsStats() {
  const all = getAllDocs();
  const endpoints = Object.keys(all);
  const tags = new Set();

  for (const doc of Object.values(all)) {
    if (doc.tags) doc.tags.forEach((t) => tags.add(t));
  }

  const documented = endpoints.filter((e) => all[e].summary).length;
  const withRequestBodies = endpoints.filter((e) => all[e].requestBody).length;

  return {
    totalEndpoints: endpoints.length,
    documented,
    withRequestBodies,
    tags: [...tags],
    builtinDocs: Object.keys(BUILTIN_DOCS).length,
    customDocs: endpoints.length - Object.keys(BUILTIN_DOCS).length,
  };
}

/**
 * Generate OpenAPI-style spec from docs.
 */
export function generateOpenAPISpec(options = {}) {
  const { title = "Hotel Search API", version = "1.0.0", baseUrl = "http://localhost:3000" } = options;
  const all = getAllDocs();

  const paths = {};
  for (const [key, doc] of Object.entries(all)) {
    const [method, ...pathParts] = key.split(" ");
    const apiPath = pathParts.join(" ");

    if (!paths[apiPath]) paths[apiPath] = {};
    paths[apiPath][method.toLowerCase()] = {
      summary: doc.summary || "",
      description: doc.description || "",
      tags: doc.tags || [],
      security: doc.auth !== false ? [{ session: [] }] : [],
      responses: doc.responses || {},
    };
  }

  return {
    openapi: "3.0.0",
    info: { title, version },
    servers: [{ url: baseUrl }],
    paths,
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "connect.sid" },
      },
    },
  };
}
