// Connection pooling configuration for outgoing HTTP requests
// Configures Node.js HTTP agent for better performance with external APIs

import http from "http";
import https from "https";

const DEFAULT_OPTIONS = {
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 30000,
};

/**
 * Create configured HTTP/HTTPS agents for outgoing requests.
 * Use with fetch or libraries that accept custom agents.
 */
export function createAgents(options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  const agentOptions = {
    keepAlive: config.keepAlive,
    keepAliveMsecs: config.keepAliveMsecs,
    maxSockets: config.maxSockets,
    maxFreeSockets: config.maxFreeSockets,
    timeout: config.timeout,
  };

  return {
    httpAgent: new http.Agent(agentOptions),
    httpsAgent: new https.Agent(agentOptions),
  };
}

/**
 * Get connection pool stats for monitoring.
 */
export function getAgentStats() {
  return {
    http: {
      name: "http",
      keepAlive: DEFAULT_OPTIONS.keepAlive,
      maxSockets: DEFAULT_OPTIONS.maxSockets,
      maxFreeSockets: DEFAULT_OPTIONS.maxFreeSockets,
    },
    https: {
      name: "https",
      keepAlive: DEFAULT_OPTIONS.keepAlive,
      maxSockets: DEFAULT_OPTIONS.maxSockets,
      maxFreeSockets: DEFAULT_OPTIONS.maxFreeSockets,
    },
  };
}
