/**
 * JSON Schema request body validation middleware.
 * Validates POST/PUT request bodies against provided schemas.
 *
 * Usage:
 *   app.post("/api/endpoint", validate({
 *     body: {
 *       type: "object",
 *       required: ["name", "email"],
 *       properties: {
 *         name: { type: "string", minLength: 1, maxLength: 100 },
 *         email: { type: "string", format: "email" },
 *       },
 *     },
 *   }), handler);
 */

const validators = {
  string: (value, schema) => {
    if (typeof value !== "string") return "must be a string";
    if (schema.minLength !== undefined && value.length < schema.minLength) return `must be at least ${schema.minLength} characters`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `must be at most ${schema.maxLength} characters`;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `must match pattern ${schema.pattern}`;
    if (schema.enum && !schema.enum.includes(value)) return `must be one of: ${schema.enum.join(", ")}`;
    return null;
  },
  number: (value, schema) => {
    if (typeof value !== "number" || isNaN(value)) return "must be a number";
    if (schema.minimum !== undefined && value < schema.minimum) return `must be >= ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `must be <= ${schema.maximum}`;
    if (schema.integer && !Number.isInteger(value)) return "must be an integer";
    return null;
  },
  integer: (value, schema) => {
    if (typeof value !== "number" || isNaN(value) || !Number.isInteger(value)) return "must be an integer";
    if (schema.minimum !== undefined && value < schema.minimum) return `must be >= ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `must be <= ${schema.maximum}`;
    return null;
  },
  boolean: (value) => {
    if (typeof value !== "boolean") return "must be a boolean";
    return null;
  },
  array: (value, schema) => {
    if (!Array.isArray(value)) return "must be an array";
    if (schema.minItems !== undefined && value.length < schema.minItems) return `must have at least ${schema.minItems} items`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `must have at most ${schema.maxItems} items`;
    return null;
  },
  object: (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return "must be an object";
    return null;
  },
};

function coerceValue(value, schema) {
  // Coerce query string values to expected types
  if (schema.type === "number" && typeof value === "string") {
    const num = Number(value);
    if (!isNaN(num)) return num;
  }
  if (schema.type === "boolean" && typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  if (schema.type === "integer" && typeof value === "string") {
    const num = parseInt(value, 10);
    if (!isNaN(num) && String(num) === value) return num;
  }
  return value;
}

function validateValue(value, schema, path = "") {
  const errors = [];

  if (value === undefined || value === null) {
    if (schema.default !== undefined) return { errors: [], value: schema.default };
    return { errors: [`${path || "value"} is required`], value };
  }

  // Coerce string values from query params
  value = coerceValue(value, schema);

  const typeValidator = validators[schema.type];
  if (typeValidator) {
    const err = typeValidator(value, schema);
    if (err) {
      errors.push(`${path || schema.type} ${err}`);
      return { errors, value };
    }
  }

  // Object property validation
  if (schema.type === "object" && schema.properties && typeof value === "object") {
    for (const [prop, propSchema] of Object.entries(schema.properties)) {
      const propPath = path ? `${path}.${prop}` : prop;
      const propValue = value[prop];

      if (propValue === undefined) {
        if (schema.required && schema.required.includes(prop)) {
          errors.push(`${propPath} is required`);
        } else if (propSchema.default !== undefined) {
          value[prop] = propSchema.default;
        }
        continue;
      }

      const result = validateValue(propValue, propSchema, propPath);
      errors.push(...result.errors);
    }

    // Check for unexpected properties
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          errors.push(`${path ? path + "." : ""}${key} is not allowed`);
        }
      }
    }
  }

  // Array item validation
  if (schema.type === "array" && schema.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const result = validateValue(value[i], schema.items, `${path}[${i}]`);
      errors.push(...result.errors);
    }
  }

  return { errors, value };
}

export function validate(schemas) {
  return (req, res, next) => {
    const allErrors = [];

    if (schemas.body) {
      if (!req.body || typeof req.body !== "object") {
        if (schemas.body.type === "object" && schemas.body.required) {
          return res.status(400).json({ error: "Request body is required" });
        }
      } else {
        const result = validateValue(req.body, schemas.body, "");
        if (result.errors.length > 0) {
          allErrors.push(...result.errors.map((e) => `body: ${e}`));
        }
      }
    }

    if (schemas.query) {
      const result = validateValue(req.query, schemas.query, "");
      if (result.errors.length > 0) {
        allErrors.push(...result.errors.map((e) => `query: ${e}`));
      }
    }

    if (schemas.params) {
      const result = validateValue(req.params, schemas.params, "");
      if (result.errors.length > 0) {
        allErrors.push(...result.errors.map((e) => `params: ${e}`));
      }
    }

    if (allErrors.length > 0) {
      return res.status(400).json({
        error: "Validation failed",
        details: allErrors,
      });
    }

    next();
  };
}

export { validateValue };
