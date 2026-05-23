// Schema validation middleware — validate request bodies against JSON schemas

import { getSchema, validate } from "../utils/requestSchemas.js";

/**
 * Express middleware that validates req.body against a registered schema.
 * Schema is looked up by `${req.method} ${req.path}`.
 */
export function schemaValidation(req, res, next) {
  // Only validate POST/PUT/PATCH with JSON bodies
  if (!["POST", "PUT", "PATCH"].includes(req.method)) return next();
  if (!req.body || typeof req.body !== "object") return next();

  const key = `${req.method} ${req.path}`;
  const schema = getSchema(key);

  if (!schema) return next();

  const result = validate(req.body, schema);

  if (!result.valid) {
    return res.status(400).json({
      error: "Validation failed",
      code: 400,
      details: result.errors,
    });
  }

  next();
}
