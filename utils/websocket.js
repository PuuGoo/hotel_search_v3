// WebSocket support — Socket.IO based real-time communication
// Manages chat rooms, direct messages, and user presence

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";
import { checkChatRateLimit } from "../middleware/chatRateLimit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHAT_FILE = path.join(__dirname, "..", "chat_messages.json");
const LAST_SEEN_FILE = path.join(__dirname, "..", "chat_last_seen.json");
const MAX_MESSAGES_PER_ROOM = 500;
const MAX_ROOMS = 100;
const MAX_CONNECTIONS = 1000;
const HEARTBEAT_INTERVAL = 30000;

// --- Persistence helpers ---

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { rooms: {}, messages: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch { /* ignore */ }
}

// --- ChatManager ---

class ChatManager {
  constructor() {
    this.io = null;
    // socketId -> { userId, username, role, joinedRooms: Set }
    this.users = new Map();
    // roomId -> { name, type, members: Set, createdAt }
    this.rooms = new Map();
    // "userId:roomId" -> ISO timestamp (last time user viewed a room)
    this.lastSeen = new Map();
    // Load persisted data
    this._loadRooms();
    this._loadLastSeen();
  }

  _loadRooms() {
    const data = readJSON(CHAT_FILE);
    // Restore persisted rooms first
    if (data.rooms) {
      for (const [id, room] of Object.entries(data.rooms)) {
        this.rooms.set(id, { ...room, members: new Set(room.members || []) });
      }
    }
    // Ensure default rooms exist (won't overwrite persisted data)
    if (!this.rooms.has("general")) {
      this.rooms.set("general", {
        id: "general",
        name: "General Chat",
        type: "group",
        members: new Set(),
        createdAt: new Date().toISOString(),
      });
    }
    if (!this.rooms.has("support")) {
      this.rooms.set("support", {
        id: "support",
        name: "Support",
        type: "group",
        members: new Set(),
        createdAt: new Date().toISOString(),
      });
    }
  }

  _saveRooms() {
    const data = readJSON(CHAT_FILE);
    const roomsObj = {};
    for (const [id, room] of this.rooms) {
      roomsObj[id] = { ...room, members: [...room.members] };
    }
    data.rooms = roomsObj;
    writeJSON(CHAT_FILE, data);
  }

  _loadLastSeen() {
    try {
      if (fs.existsSync(LAST_SEEN_FILE)) {
        const data = JSON.parse(fs.readFileSync(LAST_SEEN_FILE, "utf8"));
        for (const [key, ts] of Object.entries(data)) {
          this.lastSeen.set(key, ts);
        }
      }
    } catch { /* ignore */ }
  }

  _saveLastSeen() {
    try {
      const obj = {};
      for (const [key, ts] of this.lastSeen) {
        obj[key] = ts;
      }
      fs.writeFileSync(LAST_SEEN_FILE, JSON.stringify(obj, null, 2), "utf8");
    } catch { /* ignore */ }
  }

  _updateLastSeen(userId, roomId) {
    const key = `${userId}:${roomId}`;
    this.lastSeen.set(key, new Date().toISOString());
    this._saveLastSeen();
  }

  _getUnreadCounts(userId) {
    const counts = {};
    const userIdStr = String(userId);
    for (const [roomId] of this.rooms) {
      const key = `${userIdStr}:${roomId}`;
      const lastSeenTs = this.lastSeen.get(key);
      if (!lastSeenTs) {
        // User has never viewed this room - count all messages
        const messages = this.getMessages(roomId, 500);
        counts[roomId] = messages.length;
      } else {
        // Count messages after last seen
        const messages = this.getMessages(roomId, 500);
        counts[roomId] = messages.filter(m => m.timestamp > lastSeenTs).length;
      }
    }
    return counts;
  }

  _saveMessage(roomId, message) {
    const data = readJSON(CHAT_FILE);
    if (!data.messages) data.messages = {};
    if (!data.messages[roomId]) data.messages[roomId] = [];
    data.messages[roomId].push(message);
    // Prune old messages
    if (data.messages[roomId].length > MAX_MESSAGES_PER_ROOM) {
      data.messages[roomId] = data.messages[roomId].slice(-MAX_MESSAGES_PER_ROOM);
    }
    writeJSON(CHAT_FILE, data);
  }

  getMessages(roomId, limit = 50) {
    const data = readJSON(CHAT_FILE);
    const messages = (data.messages && data.messages[roomId]) || [];
    return messages.slice(-limit);
  }

  getRoomList() {
    const result = [];
    for (const [id, room] of this.rooms) {
      result.push({
        id,
        name: room.name,
        type: room.type,
        memberCount: room.members.size,
        createdAt: room.createdAt,
      });
    }
    return result;
  }

  getRoomListForUser(userId) {
    const result = [];
    for (const [id, room] of this.rooms) {
      let displayName = room.name;
      // For DM rooms, show the other person's name
      if (room.type === "dm") {
        const parts = id.split("_");
        if (parts.length === 2) {
          const otherUserId = parts[0] === String(userId) ? parts[1] : parts[0];
          // Find the other user's username from connected users
          const otherUser = this._findUserById(otherUserId);
          if (otherUser) {
            displayName = otherUser.username;
          } else {
            // Fallback: try to get from users.json
            displayName = this._getUsernameFromId(otherUserId) || room.name;
          }
        }
      }
      result.push({
        id,
        name: displayName,
        type: room.type,
        memberCount: room.members.size,
        createdAt: room.createdAt,
      });
    }
    return result;
  }

  _findUserById(userId) {
    for (const [, info] of this.users) {
      if (String(info.userId) === String(userId)) {
        return info;
      }
    }
    return null;
  }

  _getUsernameFromId(userId) {
    try {
      const usersPath = path.join(__dirname, "..", "users.json");
      if (fs.existsSync(usersPath)) {
        const users = JSON.parse(fs.readFileSync(usersPath, "utf8"));
        const user = users.find(u => String(u.id) === String(userId));
        return user ? (user.displayName || user.username) : null;
      }
    } catch { /* ignore */ }
    return null;
  }

  createRoom(id, name, type = "group") {
    if (this.rooms.size >= MAX_ROOMS) return null;
    if (this.rooms.has(id)) return this.rooms.get(id);
    const room = { id, name, type, members: new Set(), createdAt: new Date().toISOString() };
    this.rooms.set(id, room);
    this._saveRooms();
    // Broadcast personalized room list to each connected user
    if (this.io) {
      for (const [sid, info] of this.users) {
        this.io.to(sid).emit("chat:room:list", { rooms: this.getRoomListForUser(info.userId) });
      }
    }
    return room;
  }

  getDMRoomId(userId1, userId2) {
    return [userId1, userId2].sort().join("_");
  }

  init(server, sessionMiddleware) {
    this.io = new SocketIOServer(server, {
      path: "/socket.io",
      cors: {
        origin: true,
        credentials: true,
      },
      pingInterval: HEARTBEAT_INTERVAL,
      pingTimeout: 10000,
    });

    // Share express-session with Socket.IO
    if (sessionMiddleware) {
      this.io.engine.use(sessionMiddleware);
    }

    this.io.on("connection", (socket) => {
      this._handleConnection(socket);
    });

    return this.io;
  }

  _handleConnection(socket) {
    const session = socket.request?.session;
    if (!session || !session.isAuthenticated || !session.user) {
      socket.emit("chat:error", { message: "Authentication required" });
      socket.disconnect(true);
      return;
    }

    const userId = session.user.id;
    const username = session.user.displayName || session.user.username || userId;
    const role = session.user.role || "user";

    console.log(`[Chat] User connected: ${username} (id=${userId}, socket=${socket.id})`);

    // Track user
    this.users.set(socket.id, { userId, username, role, joinedRooms: new Set() });

    // Notify others this user is online
    socket.broadcast.emit("chat:user:online", { userId, username });

    // Send room list to this user (with personalized DM names)
    socket.emit("chat:room:list", { rooms: this.getRoomListForUser(userId) });

    // Auto-join this socket to all DM rooms the user belongs to
    const userIdStr = String(userId);
    for (const [roomId, room] of this.rooms) {
      if (room.type === "dm" && roomId.includes("_")) {
        const parts = roomId.split("_");
        if (parts[0] === userIdStr || parts[1] === userIdStr) {
          socket.join(roomId);
          const info = this.users.get(socket.id);
          if (info) info.joinedRooms.add(roomId);
          room.members.add(userId);
          console.log(`[Chat] Auto-joined ${username} to DM room: ${roomId}`);
        }
      }
    }

    // Send online users
    const onlineUsers = this._getOnlineUsers();
    socket.emit("chat:users:online", { users: onlineUsers });

    // Send unread counts for all rooms
    const unreadCounts = this._getUnreadCounts(userId);
    socket.emit("chat:unread:counts", { counts: unreadCounts });

    // --- Event handlers ---

    socket.on("chat:join", ({ roomId }) => {
      if (!roomId || !this.rooms.has(roomId)) {
        socket.emit("chat:error", { message: "Room not found" });
        return;
      }
      socket.join(roomId);
      const info = this.users.get(socket.id);
      if (info) info.joinedRooms.add(roomId);
      this.rooms.get(roomId).members.add(userId);
      // Update last seen timestamp
      this._updateLastSeen(userId, roomId);

      // Send message history
      const history = this.getMessages(roomId, 50);
      socket.emit("chat:room:history", { roomId, messages: history });

      // Notify room
      socket.to(roomId).emit("chat:user:joined", { userId, username, roomId });
    });

    socket.on("chat:leave", ({ roomId }) => {
      socket.leave(roomId);
      const info = this.users.get(socket.id);
      if (info) info.joinedRooms.delete(roomId);
      const room = this.rooms.get(roomId);
      if (room) room.members.delete(userId);
      socket.to(roomId).emit("chat:user:left", { userId, username, roomId });
    });

    socket.on("chat:message", ({ roomId, text }) => {
      if (!text || typeof text !== "string") return;
      const trimmed = text.trim().slice(0, 2000);
      if (!trimmed) return;
      if (!this.rooms.has(roomId)) {
        socket.emit("chat:error", { message: "Room not found" });
        return;
      }

      // Rate limit check
      const rateCheck = checkChatRateLimit(userId);
      if (!rateCheck.allowed) {
        socket.emit("chat:error", { message: `Too many messages. Try again in ${rateCheck.retryAfter}s.` });
        return;
      }

      const message = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        roomId,
        from: { userId, username, role },
        text: trimmed,
        timestamp: new Date().toISOString(),
        type: "text",
      };

      // Persist
      this._saveMessage(roomId, message);
      // Update sender's last seen
      this._updateLastSeen(userId, roomId);

      // Broadcast to room (including sender for confirmation)
      const roomSockets = this.io.sockets.adapter.rooms.get(roomId);
      console.log(`[Chat] Message in room ${roomId} from ${username}. Sockets in room: ${roomSockets ? roomSockets.size : 0}`);
      this.io.to(roomId).emit("chat:message:new", { message });
    });

    socket.on("chat:typing", ({ roomId, isTyping }) => {
      socket.to(roomId).emit("chat:typing", { userId, username, roomId, isTyping: !!isTyping });
    });

    socket.on("disconnect", () => {
      const info = this.users.get(socket.id);
      if (info) {
        // Check if user has other connections
        let hasOther = false;
        for (const [sid, u] of this.users) {
          if (sid !== socket.id && u.userId === userId) {
            hasOther = true;
            break;
          }
        }
        if (!hasOther) {
          socket.broadcast.emit("chat:user:offline", { userId, username });
        }
        // Remove from rooms
        for (const roomId of info.joinedRooms) {
          const room = this.rooms.get(roomId);
          if (room) room.members.delete(userId);
        }
        this.users.delete(socket.id);
      }
    });
  }

  _getOnlineUsers() {
    const seen = new Set();
    const users = [];
    for (const [, info] of this.users) {
      if (!seen.has(info.userId)) {
        seen.add(info.userId);
        users.push({ userId: info.userId, username: info.username, role: info.role });
      }
    }
    return users;
  }

  getOnlineUsers() {
    return this._getOnlineUsers();
  }

  getConnectionStats() {
    const roomDetails = {};
    for (const [name, room] of this.rooms) {
      roomDetails[name] = room.members.size;
    }
    return {
      activeConnections: this.users.size,
      activeRooms: this.rooms.size,
      roomDetails,
      maxConnections: MAX_CONNECTIONS || 1000,
      totalConnections: this.users.size,
    };
  }

  getActiveRooms() {
    return this.getRoomList().sort((a, b) => b.memberCount - a.memberCount);
  }

  sendToUser(userId, message) {
    if (!this.io) return;
    const target = String(userId);
    let sent = 0;
    for (const [sid, info] of this.users) {
      if (String(info.userId) === target) {
        this.io.to(sid).emit("chat:notification", message);
        sent++;
      }
    }
    console.log(`[Chat] sendToUser(${userId}): sent to ${sent} socket(s)`);
  }

  joinUserToRoom(userId, roomId) {
    if (!this.io) return;
    const target = String(userId);
    let joined = 0;
    for (const [sid, info] of this.users) {
      if (String(info.userId) === target) {
        const socket = this.io.sockets.sockets.get(sid);
        if (socket) {
          socket.join(roomId);
          info.joinedRooms.add(roomId);
          joined++;
        }
      }
    }
    const room = this.rooms.get(roomId);
    if (room) room.members.add(userId);
    console.log(`[Chat] joinUserToRoom(${userId}, ${roomId}): joined ${joined} socket(s)`);
  }

  sendToRoom(roomName, message) {
    if (!this.io) return;
    this.io.to(roomName).emit("chat:message:new", { message });
  }

  reset() {
    this.users.clear();
    this.rooms.clear();
    this.io = null;
  }
}

// Singleton instance
const chatManager = new ChatManager();

export function initWebSocket(server, sessionMiddleware) {
  return chatManager.init(server, sessionMiddleware);
}

export function getChatManager() {
  return chatManager;
}

// Backward-compatible exports for websocket.js routes
export function getConnectionStats() {
  return chatManager.getConnectionStats();
}

export function getActiveRooms() {
  return chatManager.getActiveRooms();
}

export function getUserConnections(userId) {
  const result = [];
  for (const [sid, info] of chatManager.users) {
    if (info.userId === userId) {
      result.push({
        socketId: sid,
        connectedAt: Date.now(),
        rooms: [...info.joinedRooms],
      });
    }
  }
  return result;
}

export function disconnectUser(userId) {
  let count = 0;
  for (const [sid, info] of chatManager.users) {
    if (info.userId === userId) {
      const socket = chatManager.io?.sockets?.sockets?.get(sid);
      if (socket) {
        socket.disconnect(true);
        count++;
      }
    }
  }
  return count;
}

export function sendToUser(userId, message) {
  chatManager.sendToUser(userId, message);
}

export function sendToRoom(roomName, message) {
  chatManager.sendToRoom(roomName, message);
}

export function clearConnectionHistory() {
  chatManager.users.clear();
  chatManager.rooms.clear();
}

export function clearAllConnections() {
  chatManager.users.clear();
  chatManager.rooms.clear();
}
