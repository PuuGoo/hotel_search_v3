// Environment-based configuration management
const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  isDevelopment: process.env.NODE_ENV !== "production",

  session: {
    secret: process.env.SESSION_SECRET || "dev-secret-change-in-production",
    maxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 24 * 60 * 60 * 1000,
  },

  cors: {
    origins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
      : [],
  },

  rateLimit: {
    loginWindow: parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW, 10) || 15 * 60 * 1000,
    loginMax: parseInt(process.env.RATE_LIMIT_LOGIN_MAX, 10) || 5,
    searchWindow: parseInt(process.env.RATE_LIMIT_SEARCH_WINDOW, 10) || 60 * 1000,
    searchMax: parseInt(process.env.RATE_LIMIT_SEARCH_MAX, 10) || 30,
  },

  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  },

  case12: {
    apiUrl: process.env.CASE12_API_URL || "",
    apiKey: process.env.CASE12_API_KEY || "",
  },

  ddg: {
    serverUrl: process.env.DDG_SERVER_URL || "http://localhost:5001",
  },
};

// Validate required config in production
if (config.isProduction) {
  const required = ["SESSION_SECRET"];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`Missing required env var: ${key}`);
      process.exit(1);
    }
  }
}

export default config;
