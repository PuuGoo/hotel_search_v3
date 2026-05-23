// Configuration validation — validate all env vars at startup

const SCHEMA = {
  NODE_ENV: {
    type: "string",
    enum: ["development", "production", "test"],
    default: "development",
  },
  PORT: {
    type: "number",
    min: 1,
    max: 65535,
    default: 3000,
  },
  SESSION_SECRET: {
    type: "string",
    required: true, // Required in production
    minLength: 16,
    default: "dev-secret-change-in-production",
  },
  SESSION_MAX_AGE: {
    type: "number",
    min: 60000, // 1 minute
    max: 604800000, // 7 days
    default: 86400000, // 24 hours
  },
  CORS_ORIGINS: {
    type: "string",
    default: "",
  },
  RATE_LIMIT_LOGIN_WINDOW: {
    type: "number",
    min: 60000,
    default: 900000, // 15 minutes
  },
  RATE_LIMIT_LOGIN_MAX: {
    type: "number",
    min: 1,
    default: 5,
  },
  RATE_LIMIT_SEARCH_WINDOW: {
    type: "number",
    min: 1000,
    default: 60000,
  },
  RATE_LIMIT_SEARCH_MAX: {
    type: "number",
    min: 1,
    default: 30,
  },
  LOG_LEVEL: {
    type: "string",
    enum: ["debug", "info", "warn", "error"],
    default: "debug",
  },
};

/**
 * Validate environment configuration.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  const isProduction = env.NODE_ENV === "production";

  for (const [key, schema] of Object.entries(SCHEMA)) {
    const value = env[key];

    // Check required in production
    if (schema.required && isProduction && !value) {
      errors.push(`${key} is required in production`);
      continue;
    }

    // Skip if not set (will use default)
    if (!value) continue;

    // Type validation
    if (schema.type === "number") {
      const num = Number(value);
      if (isNaN(num)) {
        errors.push(`${key} must be a number, got: "${value}"`);
        continue;
      }
      if (schema.min !== undefined && num < schema.min) {
        errors.push(`${key} must be >= ${schema.min}, got: ${num}`);
      }
      if (schema.max !== undefined && num > schema.max) {
        errors.push(`${key} must be <= ${schema.max}, got: ${num}`);
      }
    }

    if (schema.type === "string") {
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${key} must be one of [${schema.enum.join(", ")}], got: "${value}"`);
      }
      if (schema.minLength && value.length < schema.minLength) {
        if (isProduction) {
          errors.push(`${key} must be at least ${schema.minLength} characters`);
        } else {
          warnings.push(`${key} is shorter than recommended (${schema.minLength} chars)`);
        }
      }
    }
  }

  // Production-specific checks
  if (isProduction) {
    if (env.SESSION_SECRET === "dev-secret-change-in-production") {
      errors.push("SESSION_SECRET must be changed from default in production");
    }
    if (!env.CORS_ORIGINS) {
      warnings.push("CORS_ORIGINS not set — same-origin only");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Print config validation results to console.
 */
export function printValidation(result) {
  if (result.errors.length > 0) {
    console.error("Configuration errors:");
    for (const err of result.errors) {
      console.error(`  ✗ ${err}`);
    }
  }
  if (result.warnings.length > 0) {
    console.warn("Configuration warnings:");
    for (const warn of result.warnings) {
      console.warn(`  ⚠ ${warn}`);
    }
  }
  if (result.valid && result.warnings.length === 0) {
    console.log("Configuration validated successfully");
  }
}
