// Server-Sent Events — real-time push notifications to connected clients

import crypto from "crypto";

/**
 * SSE connection manager.
 * Tracks connected clients by userId and broadcasts events.
 */
export class SSEManager {
  constructor() {
    this.clients = new Map(); // userId -> Set<{ id, res }>
    this.heartbeatInterval = null;
  }

  /**
   * Add a client connection.
   * @param {string} userId
   * @param {object} res - Express response object
   * @returns {string} clientId
   */
  addClient(userId, res) {
    const clientId = crypto.randomBytes(8).toString("hex");

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // nginx passthrough
    });

    // Send initial connected event
    this._send(res, { type: "connected", clientId });

    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId).add({ id: clientId, res });

    // Clean up on disconnect
    res.on("close", () => {
      this.removeClient(userId, clientId);
    });

    return clientId;
  }

  /**
   * Remove a specific client.
   */
  removeClient(userId, clientId) {
    const userClients = this.clients.get(userId);
    if (!userClients) return;
    for (const client of userClients) {
      if (client.id === clientId) {
        userClients.delete(client);
        break;
      }
    }
    if (userClients.size === 0) {
      this.clients.delete(userId);
    }
  }

  /**
   * Send an event to a specific user.
   */
  sendToUser(userId, event) {
    const userClients = this.clients.get(userId);
    if (!userClients) return 0;
    let sent = 0;
    for (const client of userClients) {
      try {
        this._send(client.res, event);
        sent++;
      } catch {
        userClients.delete(client);
      }
    }
    if (userClients.size === 0) {
      this.clients.delete(userId);
    }
    return sent;
  }

  /**
   * Broadcast an event to all connected users.
   */
  broadcast(event) {
    let sent = 0;
    for (const [userId] of this.clients) {
      sent += this.sendToUser(userId, event);
    }
    return sent;
  }

  /**
   * Get connection stats.
   */
  stats() {
    let totalClients = 0;
    const users = {};
    for (const [userId, userClients] of this.clients) {
      users[userId] = userClients.size;
      totalClients += userClients.size;
    }
    return { totalClients, uniqueUsers: this.clients.size, users };
  }

  /**
   * Start heartbeat to keep connections alive.
   */
  startHeartbeat(intervalMs = 30000) {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.broadcast({ type: "heartbeat", timestamp: Date.now() });
    }, intervalMs);
    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  /**
   * Stop heartbeat.
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Send SSE formatted data.
   */
  _send(res, data) {
    const id = Date.now();
    const json = typeof data === "string" ? data : JSON.stringify(data);
    res.write(`id: ${id}\n`);
    res.write(`data: ${json}\n\n`);
  }
}

// Singleton instance
let instance = null;

export function getSSEManager() {
  if (!instance) {
    instance = new SSEManager();
  }
  return instance;
}

export function resetSSEManager() {
  if (instance) {
    instance.stopHeartbeat();
    instance = null;
  }
}
