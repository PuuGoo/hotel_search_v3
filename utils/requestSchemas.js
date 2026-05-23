// Request validation schemas — JSON schema validation for POST/PUT endpoints
// Defines and validates request bodies against schemas

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEMAS_FILE = path.join(__dirname, "..", "request_schemas.json");

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { schemas: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

// Built-in schemas for common endpoints
const BUILTIN_SCHEMAS = {
  "POST /api/auth/login": {
    type: "object",
    required: ["username", "password"],
    properties: {
      username: { type: "string", minLength: 1, maxLength: 100 },
      password: { type: "string", minLength: 1, maxLength: 200 },
    },
  },
  "POST /api/auth/register": {
    type: "object",
    required: ["username", "password"],
    properties: {
      username: { type: "string", minLength: 2, maxLength: 50 },
      password: { type: "string", minLength: 6, maxLength: 200 },
      role: { type: "string", enum: ["user", "admin"] },
    },
  },
  "POST /api/bookmarks": {
    type: "object",
    required: ["url", "title"],
    properties: {
      url: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 500 },
      tags: { type: "array", items: { type: "string" }, maxItems: 20 },
      folder: { type: "string", maxLength: 100 },
    },
  },
  "POST /api/search-history": {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string", minLength: 1, maxLength: 1000 },
      engine: { type: "string", maxLength: 50 },
      resultCount: { type: "integer", minimum: 0 },
    },
  },
  "POST /api/webhooks": {
    type: "object",
    required: ["url", "events"],
    properties: {
      url: { type: "string", format: "uri" },
      events: { type: "array", items: { type: "string" }, minItems: 1 },
      secret: { type: "string", maxLength: 200 },
    },
  },
  "POST /api/price-alerts": {
    type: "object",
    required: ["hotelName"],
    properties: {
      hotelName: { type: "string", minLength: 1, maxLength: 500 },
      targetPrice: { type: "number", minimum: 0 },
      location: { type: "string", maxLength: 200 },
    },
  },
};

/**
 * Validate a value against a schema.
 * Returns { valid, errors[] }.
 */
export function validate(value, schema) {
  const errors = [];

  if (!schema || typeof schema !== "object") {
    return { valid: true, errors: [] };
  }

  // Type check
  if (schema.type) {
    const actualType = Array.isArray(value) ? "array" : typeof value;
    if (actualType !== schema.type) {
      errors.push(`Expected type ${schema.type}, got ${actualType}`);
      return { valid: false, errors };
    }
  }

  // Required fields
  if (schema.required && typeof value === "object" && value !== null) {
    for (const field of schema.required) {
      if (value[field] === undefined || value[field] === null || value[field] === "") {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Properties validation
  if (schema.properties && typeof value === "object" && value !== null) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const propValue = value[key];
      if (propValue === undefined || propValue === null) continue;

      // String validations
      if (propSchema.type === "string" && typeof propValue === "string") {
        if (propSchema.minLength !== undefined && propValue.length < propSchema.minLength) {
          errors.push(`${key}: minimum length is ${propSchema.minLength}`);
        }
        if (propSchema.maxLength !== undefined && propValue.length > propSchema.maxLength) {
          errors.push(`${key}: maximum length is ${propSchema.maxLength}`);
        }
        if (propSchema.enum && !propSchema.enum.includes(propValue)) {
          errors.push(`${key}: must be one of ${propSchema.enum.join(", ")}`);
        }
        if (propSchema.format === "uri" && !isValidUrl(propValue)) {
          errors.push(`${key}: must be a valid URL`);
        }
      }

      // Number validations
      if (propSchema.type === "number" && typeof propValue === "number") {
        if (propSchema.minimum !== undefined && propValue < propSchema.minimum) {
          errors.push(`${key}: minimum value is ${propSchema.minimum}`);
        }
        if (propSchema.maximum !== undefined && propValue > propSchema.maximum) {
          errors.push(`${key}: maximum value is ${propSchema.maximum}`);
        }
      }

      // Integer validations
      if (propSchema.type === "integer" && typeof propValue === "number") {
        if (!Number.isInteger(propValue)) {
          errors.push(`${key}: must be an integer`);
        }
        if (propSchema.minimum !== undefined && propValue < propSchema.minimum) {
          errors.push(`${key}: minimum value is ${propSchema.minimum}`);
        }
      }

      // Array validations
      if (propSchema.type === "array" && Array.isArray(propValue)) {
        if (propSchema.minItems !== undefined && propValue.length < propSchema.minItems) {
          errors.push(`${key}: minimum items is ${propSchema.minItems}`);
        }
        if (propSchema.maxItems !== undefined && propValue.length > propSchema.maxItems) {
          errors.push(`${key}: maximum items is ${propSchema.maxItems}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function isValidUrl(str) {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all schemas (built-in + custom).
 */
export function getAllSchemas() {
  const custom = readJSON(SCHEMAS_FILE);
  return { ...BUILTIN_SCHEMAS, ...(custom.schemas || {}) };
}

/**
 * Get schema for a specific endpoint.
 */
export function getSchema(endpoint) {
  const all = getAllSchemas();
  return all[endpoint] || null;
}

/**
 * Register a custom schema.
 */
export function registerSchema(endpoint, schema) {
  const data = readJSON(SCHEMAS_FILE);
  if (!data.schemas) data.schemas = {};
  data.schemas[endpoint] = schema;
  writeJSON(SCHEMAS_FILE, data);
  return schema;
}

/**
 * Remove a custom schema.
 */
export function removeSchema(endpoint) {
  const data = readJSON(SCHEMAS_FILE);
  if (data.schemas && data.schemas[endpoint]) {
    delete data.schemas[endpoint];
    writeJSON(SCHEMAS_FILE, data);
    return true;
  }
  return false;
}

/**
 * Get validation statistics.
 */
export function getValidationStats() {
  const all = getAllSchemas();
  const endpoints = Object.keys(all);
  return {
    totalSchemas: endpoints.length,
    builtinSchemas: Object.keys(BUILTIN_SCHEMAS).length,
    customSchemas: endpoints.length - Object.keys(BUILTIN_SCHEMAS).length,
    endpoints,
  };
}
