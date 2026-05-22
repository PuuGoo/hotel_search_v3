// Structured logger for production
const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function getLogLevel() {
  const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug");
  return LOG_LEVELS[level] ?? LOG_LEVELS.info;
}

function formatMessage(level, message, meta = {}) {
  if (process.env.NODE_ENV === "production") {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    });
  }
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  return `[${new Date().toISOString()}] ${level.toUpperCase()}: ${message}${metaStr}`;
}

export const logger = {
  error(message, meta = {}) {
    if (getLogLevel() >= LOG_LEVELS.error) {
      console.error(formatMessage("error", message, meta));
    }
  },
  warn(message, meta = {}) {
    if (getLogLevel() >= LOG_LEVELS.warn) {
      console.warn(formatMessage("warn", message, meta));
    }
  },
  info(message, meta = {}) {
    if (getLogLevel() >= LOG_LEVELS.info) {
      console.log(formatMessage("info", message, meta));
    }
  },
  debug(message, meta = {}) {
    if (getLogLevel() >= LOG_LEVELS.debug) {
      console.log(formatMessage("debug", message, meta));
    }
  },
};
