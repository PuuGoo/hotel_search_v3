// WebSocket support — bidirectional real-time communication
// Manages WebSocket connections, rooms, and message broadcasting

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "websocket_data.json");
const MAX_CONNECTIONS = 1000;
const MAX_ROOMS = 100;
const HEARTBEAT_INTERVAL = 30000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { connections: [], rooms: {}, messages: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data));
  } catch { /* ignore */ }
}

// In-memory state
let wss = null;
const clients = new Map(); // ws -> { userId, rooms: Set, connectedAt }
const rooms = new Map();   // roomName -> Set<ws>

/**
 * Initialize WebSocket server.
 */
export function initWebSocket(server) {
  // Dynamic import for ws (ESM compatibility)
  return import("ws").then(({ WebSocketServer }) => {
    wss = new WebSocketServer({ server, path: "/ws" });

    wss.on("connection", (ws, req) => {
      if (clients.size >= MAX_CONNECTIONS) {
        ws.close(1013, "Max connections reached");
        return;
      }

      const userId = new URL(req.url, "http://localhost").searchParams.get("userId") || "anonymous";
      const clientInfo = {
        userId,
        rooms: new Set(),
        connectedAt: Date.now(),
        ip: req.socket.remoteAddress,
      };

      clients.set(ws, clientInfo);
      recordConnection(userId);

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleMessage(ws, message);
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        }
      });

      ws.on("close", () => {
        const info = clients.get(ws);
        if (info) {
          for (const room of info.rooms) {
            const roomClients = rooms.get(room);
            if (roomClients) roomClients.delete(ws);
          }
          clients.delete(ws);
          recordDisconnection(info.userId);
        }
      });

      ws.on("error", () => {
        clients.delete(ws);
      });

      // Send welcome
      ws.send(JSON.stringify({
        type: "connected",
        userId,
        timestamp: Date.now(),
      }));
    });

    // Heartbeat
    setInterval(() => {
      if (!wss) return;
      wss.clients.forEach((ws) => {
        if (ws.readyState === ws.OPEN) {
          ws.ping();
        }
      });
    }, HEARTBEAT_INTERVAL);

    return wss;
  });
}

function handleMessage(ws, message) {
  const info = clients.get(ws);
  if (!info) return;

  switch (message.type) {
    case "join":
      joinRoom(ws, message.room);
      break;
    case "leave":
      leaveRoom(ws, message.room);
      break;
    case "message":
      broadcastToRoom(message.room, {
        type: "message",
        from: info.userId,
        room: message.room,
        data: message.data,
        timestamp: Date.now(),
      }, ws);
      break;
    case "broadcast":
      broadcastToAll({
        type: "broadcast",
        from: info.userId,
        data: message.data,
        timestamp: Date.now(),
      }, ws);
      break;
    default:
      ws.send(JSON.stringify({ type: "error", message: `Unknown type: ${message.type}` }));
  }
}

function joinRoom(ws, roomName) {
  if (!roomName) return;
  if (!rooms.has(roomName)) {
    if (rooms.size >= MAX_ROOMS) {
      ws.send(JSON.stringify({ type: "error", message: "Max rooms reached" }));
      return;
    }
    rooms.set(roomName, new Set());
  }

  rooms.get(roomName).add(ws);
  clients.get(ws).rooms.add(roomName);

  ws.send(JSON.stringify({ type: "joined", room: roomName }));

  broadcastToRoom(roomName, {
    type: "user_joined",
    userId: clients.get(ws).userId,
    room: roomName,
    timestamp: Date.now(),
  }, ws);
}

function leaveRoom(ws, roomName) {
  const roomClients = rooms.get(roomName);
  if (roomClients) {
    roomClients.delete(ws);
    if (roomClients.size === 0) rooms.delete(roomName);
  }

  const info = clients.get(ws);
  if (info) info.rooms.delete(roomName);

  ws.send(JSON.stringify({ type: "left", room: roomName }));
}

function broadcastToRoom(roomName, message, excludeWs = null) {
  const roomClients = rooms.get(roomName);
  if (!roomClients) return;

  const msgStr = JSON.stringify(message);
  for (const client of roomClients) {
    if (client !== excludeWs && client.readyState === 1) {
      client.send(msgStr);
    }
  }
}

function broadcastToAll(message, excludeWs = null) {
  const msgStr = JSON.stringify(message);
  for (const [client] of clients) {
    if (client !== excludeWs && client.readyState === 1) {
      client.send(msgStr);
    }
  }
}

/**
 * Send message to a specific user.
 */
export function sendToUser(userId, message) {
  const msgStr = JSON.stringify(message);
  for (const [ws, info] of clients) {
    if (info.userId === userId && ws.readyState === 1) {
      ws.send(msgStr);
    }
  }
}

/**
 * Send message to a room.
 */
export function sendToRoom(roomName, message) {
  broadcastToRoom(roomName, message);
}

/**
 * Get connection statistics.
 */
export function getConnectionStats() {
  const data = readJSON(DATA_FILE);
  const connections = data.connections || [];

  const roomList = {};
  for (const [name, clients] of rooms) {
    roomList[name] = clients.size;
  }

  const userConnections = {};
  for (const [, info] of clients) {
    userConnections[info.userId] = (userConnections[info.userId] || 0) + 1;
  }

  return {
    activeConnections: clients.size,
    activeRooms: rooms.size,
    roomDetails: roomList,
    userConnections,
    totalConnections: connections.length,
    maxConnections: MAX_CONNECTIONS,
    maxRooms: MAX_ROOMS,
  };
}

/**
 * Get active rooms.
 */
export function getActiveRooms() {
  const result = [];
  for (const [name, clients] of rooms) {
    result.push({ name, clients: clients.size });
  }
  return result.sort((a, b) => b.clients - a.clients);
}

/**
 * Get connections for a specific user.
 */
export function getUserConnections(userId) {
  const userConns = [];
  for (const [ws, info] of clients) {
    if (info.userId === userId) {
      userConns.push({
        connectedAt: info.connectedAt,
        rooms: [...info.rooms],
        ip: info.ip,
      });
    }
  }
  return userConns;
}

/**
 * Disconnect a user.
 */
export function disconnectUser(userId) {
  let count = 0;
  for (const [ws, info] of clients) {
    if (info.userId === userId) {
      ws.close(1000, "Disconnected by admin");
      count++;
    }
  }
  return count;
}

/**
 * Clear all connections.
 */
export function clearAllConnections() {
  for (const [ws] of clients) {
    ws.close(1000, "Server reset");
  }
  clients.clear();
  rooms.clear();
}

function recordConnection(userId) {
  const data = readJSON(DATA_FILE);
  if (!data.connections) data.connections = [];
  data.connections.unshift({ userId, timestamp: Date.now(), type: "connect" });
  if (data.connections.length > 10000) data.connections.length = 10000;
  writeJSON(DATA_FILE, data);
}

function recordDisconnection(userId) {
  const data = readJSON(DATA_FILE);
  if (!data.connections) data.connections = [];
  data.connections.unshift({ userId, timestamp: Date.now(), type: "disconnect" });
  if (data.connections.length > 10000) data.connections.length = 10000;
  writeJSON(DATA_FILE, data);
}

/**
 * Clear connection history.
 */
export function clearConnectionHistory() {
  writeJSON(DATA_FILE, { connections: [], rooms: {}, messages: [] });
}
