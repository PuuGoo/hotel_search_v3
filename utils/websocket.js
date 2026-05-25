// WebSocket support — Socket.IO based real-time communication
// Manages chat rooms, direct messages, and user presence

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";
import { checkChatRateLimit } from "../middleware/chatRateLimit.js";
import { acknowledgePendingNotification } from "./realtimeNotifications.js";
import { getSession, joinSession, leaveSession, recordSearch } from "./searchCollaboration.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHAT_FILE = path.join(__dirname, "..", "chat_messages.json");
const LAST_SEEN_FILE = path.join(__dirname, "..", "chat_last_seen.json");
const LANGUAGE_PREF_FILE = path.join(__dirname, "..", "chat_language_prefs.json");
const MAX_MESSAGES_PER_ROOM = 500;
const MAX_ROOMS = 100;
const MAX_CONNECTIONS = 1000;
const HEARTBEAT_INTERVAL = 30000;
const ADMIN_OPS_ROOM = "ops:admin";
const MAX_OPS_HISTORY = 500;
const COLLAB_ROOM_PREFIX = "collab:";

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
    this.languagePreferences = new Map();
    // roomId -> Map<userId, { userId, username, expiresAt }>
    this.typingUsers = new Map();
    this.opsEventHistory = [];
    // sessionId -> Map<userId, { userId, username, role, socketCount }>
    this.collaborationPresence = new Map();
    // Load persisted data
    this._loadRooms();
    this._loadLastSeen();
    this._loadLanguagePreferences();
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

  _loadLanguagePreferences() {
    try {
      if (fs.existsSync(LANGUAGE_PREF_FILE)) {
        const data = JSON.parse(fs.readFileSync(LANGUAGE_PREF_FILE, "utf8"));
        for (const [userId, language] of Object.entries(data || {})) {
          this.languagePreferences.set(String(userId), String(language || "en").toLowerCase());
        }
      }
    } catch { /* ignore */ }
  }

  _saveLanguagePreferences() {
    try {
      const obj = {};
      for (const [userId, language] of this.languagePreferences) {
        obj[String(userId)] = String(language || "en").toLowerCase();
      }
      fs.writeFileSync(LANGUAGE_PREF_FILE, JSON.stringify(obj, null, 2), "utf8");
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
        counts[roomId] = messages.filter(m => !m.deleted).length;
      } else {
        // Count messages after last seen
        const messages = this.getMessages(roomId, 500);
        counts[roomId] = messages.filter(m => !m.deleted && m.timestamp > lastSeenTs).length;
      }
    }
    return counts;
  }

  _buildRoomPresence(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    const members = [];
    const seen = new Set();
    for (const [, info] of this.users) {
      if (seen.has(String(info.userId))) continue;
      if (!info.joinedRooms.has(roomId)) continue;
      seen.add(String(info.userId));
      members.push({
        userId: info.userId,
        username: info.username,
        role: info.role,
      });
    }
    return members;
  }

  _broadcastRoomPresence(roomId) {
    if (!this.io || !roomId) return;
    this.io.to(roomId).emit("chat:room:presence", {
      roomId,
      users: this._buildRoomPresence(roomId),
    });
  }

  _getTypingUsers(roomId) {
    const roomTyping = this.typingUsers.get(roomId);
    if (!roomTyping) return [];
    const now = Date.now();
    const result = [];
    for (const [uid, entry] of roomTyping) {
      if (entry.expiresAt <= now) {
        roomTyping.delete(uid);
        continue;
      }
      result.push({ userId: entry.userId, username: entry.username });
    }
    if (roomTyping.size === 0) {
      this.typingUsers.delete(roomId);
    }
    return result;
  }

  _broadcastTypingState(roomId) {
    if (!this.io || !roomId) return;
    this.io.to(roomId).emit("chat:typing:state", {
      roomId,
      users: this._getTypingUsers(roomId),
    });
  }

  _getCollabRoomName(sessionId) {
    return `${COLLAB_ROOM_PREFIX}${sessionId}`;
  }

  _getCollabPresence(sessionId) {
    const roomPresence = this.collaborationPresence.get(sessionId);
    if (!roomPresence) return [];
    return [...roomPresence.values()].map((entry) => ({
      userId: entry.userId,
      username: entry.username,
      role: entry.role,
      socketCount: entry.socketCount,
    }));
  }

  _broadcastCollabPresence(sessionId) {
    if (!this.io || !sessionId) return;
    this.io.to(this._getCollabRoomName(sessionId)).emit("collab:presence:update", {
      sessionId,
      participants: this._getCollabPresence(sessionId),
    });
  }

  _saveMessage(roomId, message) {
    const data = readJSON(CHAT_FILE);
    if (!data.messages) data.messages = {};
    if (!data.messages[roomId]) data.messages[roomId] = [];
    const existingIdx = data.messages[roomId].findIndex(
      (entry) => String(entry.id) === String(message.id),
    );
    if (existingIdx >= 0) {
      data.messages[roomId][existingIdx] = message;
    } else {
      data.messages[roomId].push(message);
    }
    // Prune old messages
    if (data.messages[roomId].length > MAX_MESSAGES_PER_ROOM) {
      data.messages[roomId] = data.messages[roomId].slice(-MAX_MESSAGES_PER_ROOM);
    }
    writeJSON(CHAT_FILE, data);
  }

  _toggleMessageReaction(roomId, messageId, user, emoji) {
    if (!roomId || !messageId || !emoji) return null;
    const data = readJSON(CHAT_FILE);
    const messages = (data.messages && data.messages[roomId]) || [];
    const message = messages.find((m) => String(m.id) === String(messageId));
    if (!message) return null;

    if (!message.reactions || typeof message.reactions !== "object") {
      message.reactions = {};
    }

    const reactionKey = String(emoji).slice(0, 16);
    if (!reactionKey) return null;
    if (!Array.isArray(message.reactions[reactionKey])) {
      message.reactions[reactionKey] = [];
    }

    const actorId = String(user.userId);
    const existingIndex = message.reactions[reactionKey].findIndex(
      (entry) => String(entry.userId) === actorId,
    );

    let action = "added";

    if (existingIndex >= 0) {
      message.reactions[reactionKey].splice(existingIndex, 1);
      action = "removed";
      if (message.reactions[reactionKey].length === 0) {
        delete message.reactions[reactionKey];
      }
    } else {
      for (const [key, users] of Object.entries(message.reactions)) {
        if (!Array.isArray(users)) continue;
        const idx = users.findIndex((entry) => String(entry.userId) === actorId);
        if (idx >= 0) {
          users.splice(idx, 1);
          if (users.length === 0) {
            delete message.reactions[key];
          }
        }
      }

      if (!Array.isArray(message.reactions[reactionKey])) {
        message.reactions[reactionKey] = [];
      }
      message.reactions[reactionKey].push({
        userId: user.userId,
        username: user.username,
      });
    }

    writeJSON(CHAT_FILE, data);
    return {
      roomId,
      messageId: message.id,
      emoji: reactionKey,
      action,
      by: {
        userId: user.userId,
        username: user.username,
      },
      reactions: message.reactions,
      timestamp: new Date().toISOString(),
    };
  }

  getMessages(roomId, limit = 50) {
    const data = readJSON(CHAT_FILE);
    const messages = (data.messages && data.messages[roomId]) || [];
    return messages.slice(-limit);
  }

  getMessagesSince(roomId, sinceTs) {
    if (!roomId || !sinceTs) return [];
    const data = readJSON(CHAT_FILE);
    const messages = (data.messages && data.messages[roomId]) || [];
    return messages.filter((m) => !m.deleted && m.timestamp > sinceTs);
  }

  buildReplyMetadata(roomId, replyToMessageId) {
    if (!roomId || !replyToMessageId) return null;
    const data = readJSON(CHAT_FILE);
    const messages = (data.messages && data.messages[roomId]) || [];
    const target = messages.find((m) => String(m.id) === String(replyToMessageId));
    if (!target) return null;

    return {
      replyToMessageId: String(target.id),
      replyToSnapshot: {
        senderName: String(target.from?.username || "Unknown"),
        textSnippet: String(target.text || "[message]").trim().slice(0, 120) || "[message]",
      },
    };
  }

  setUserLanguagePreference(userId, language = "en") {
    const normalized = String(language || "en").trim().toLowerCase();
    const allowed = new Set(["en", "vi"]);
    const finalLanguage = allowed.has(normalized) ? normalized : "en";
    this.languagePreferences.set(String(userId), finalLanguage);
    this._saveLanguagePreferences();
    return finalLanguage;
  }

  getUserLanguagePreference(userId) {
    return this.languagePreferences.get(String(userId)) || "en";
  }

  buildLocalizedSystemMessage(userId, key, params = {}) {
    const language = this.getUserLanguagePreference(userId);
    const dict = {
      en: {
        room_locked: `Room ${params.roomName || ""} is now locked.`.trim(),
        room_unlocked: `Room ${params.roomName || ""} is now unlocked.`.trim(),
      },
      vi: {
        room_locked: `Phòng ${params.roomName || ""} đã bị khóa.`.trim(),
        room_unlocked: `Phòng ${params.roomName || ""} đã được mở khóa.`.trim(),
      },
    };
    const fallback = dict.en[key] || key;
    const text = (dict[language] && dict[language][key]) || fallback;
    return { key, language, text };
  }

  toggleMessageReaction(roomId, messageId, userId, username, emoji) {
    return this._toggleMessageReaction(
      roomId,
      messageId,
      { userId, username },
      emoji,
    );
  }

  editMessage(roomId, messageId, actorUserId, newText) {
    if (!roomId || !messageId) return null;
    const trimmed = typeof newText === "string" ? newText.trim() : "";
    if (!trimmed) return null;

    const data = readJSON(CHAT_FILE);
    const messages = (data.messages && data.messages[roomId]) || [];
    const message = messages.find((m) => String(m.id) === String(messageId));
    if (!message || message.deleted) return null;
    if (String(message.from?.userId) !== String(actorUserId)) return null;

    message.text = trimmed.slice(0, 2000);
    message.editedAt = new Date().toISOString();
    writeJSON(CHAT_FILE, data);
    return message;
  }

  deleteMessage(roomId, messageId, actorUserId, actorRole = "user") {
    if (!roomId || !messageId) return null;

    const data = readJSON(CHAT_FILE);
    const messages = (data.messages && data.messages[roomId]) || [];
    const message = messages.find((m) => String(m.id) === String(messageId));
    if (!message || message.deleted) return null;

    const isOwner = String(message.from?.userId) === String(actorUserId);
    const isAdmin = String(actorRole) === "admin";
    if (!isOwner && !isAdmin) return null;

    message.deleted = true;
    message.text = "[deleted]";
    message.deletedAt = new Date().toISOString();
    writeJSON(CHAT_FILE, data);
    return message;
  }

  lockRoom(roomId, actorUserId, actorRole = "user") {
    if (!roomId || String(actorRole) !== "admin") return null;
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.locked = true;
    room.lockedAt = new Date().toISOString();
    room.lockedBy = actorUserId;
    this._saveRooms();
    return {
      roomId,
      locked: true,
      lockedAt: room.lockedAt,
      lockedBy: room.lockedBy,
    };
  }

  unlockRoom(roomId, actorUserId, actorRole = "user") {
    if (!roomId || String(actorRole) !== "admin") return null;
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.locked = false;
    room.unlockedAt = new Date().toISOString();
    room.unlockedBy = actorUserId;
    this._saveRooms();
    return {
      roomId,
      locked: false,
      unlockedAt: room.unlockedAt,
      unlockedBy: room.unlockedBy,
    };
  }

  muteUserInRoom(roomId, targetUserId, actorUserId, actorRole = "user") {
    if (!roomId || !targetUserId || String(actorRole) !== "admin") return null;
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (!room.mutedUsers) room.mutedUsers = {};
    room.mutedUsers[String(targetUserId)] = {
      userId: String(targetUserId),
      muted: true,
      mutedBy: actorUserId,
      mutedAt: new Date().toISOString(),
    };
    this._saveRooms();
    return room.mutedUsers[String(targetUserId)];
  }

  unmuteUserInRoom(roomId, targetUserId, actorUserId, actorRole = "user") {
    if (!roomId || !targetUserId || String(actorRole) !== "admin") return null;
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (!room.mutedUsers) room.mutedUsers = {};
    room.mutedUsers[String(targetUserId)] = {
      userId: String(targetUserId),
      muted: false,
      unmutedBy: actorUserId,
      unmutedAt: new Date().toISOString(),
    };
    this._saveRooms();
    return room.mutedUsers[String(targetUserId)];
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
    this.users.set(socket.id, {
      userId,
      username,
      role,
      joinedRooms: new Set(),
      joinedCollabSessions: new Set(),
    });
    if (role === "admin") {
      socket.join(ADMIN_OPS_ROOM);
    }

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
      socket.emit("chat:room:presence", { roomId, users: this._buildRoomPresence(roomId) });
      socket.emit("chat:typing:state", { roomId, users: this._getTypingUsers(roomId) });
      this._broadcastRoomPresence(roomId);

      // Notify room
      socket.to(roomId).emit("chat:user:joined", { userId, username, roomId });
    });

    socket.on("chat:leave", ({ roomId }) => {
      socket.leave(roomId);
      const info = this.users.get(socket.id);
      if (info) info.joinedRooms.delete(roomId);
      const room = this.rooms.get(roomId);
      if (room) room.members.delete(userId);
      const roomTyping = this.typingUsers.get(roomId);
      if (roomTyping) {
        roomTyping.delete(String(userId));
        if (roomTyping.size === 0) this.typingUsers.delete(roomId);
      }
      this._broadcastTypingState(roomId);
      this._broadcastRoomPresence(roomId);
      socket.to(roomId).emit("chat:user:left", { userId, username, roomId });
    });

    socket.on("chat:message", ({ roomId, text, replyToMessageId }) => {
      if (!text || typeof text !== "string") return;
      const trimmed = text.trim().slice(0, 2000);
      if (!trimmed) return;
      if (!this.rooms.has(roomId)) {
        socket.emit("chat:error", { message: "Room not found" });
        return;
      }

      const rateCheck = checkChatRateLimit(userId);
      if (!rateCheck.allowed) {
        socket.emit("chat:error", { message: `Too many messages. Try again in ${rateCheck.retryAfter}s.` });
        return;
      }

      let replyMeta = null;
      if (replyToMessageId) {
        replyMeta = this.buildReplyMetadata(roomId, replyToMessageId);
        if (!replyMeta) {
          socket.emit("chat:error", { message: "Reply target not found" });
          return;
        }
      }

      const message = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        roomId,
        from: { userId, username, role },
        text: trimmed,
        timestamp: new Date().toISOString(),
        type: "text",
        replyToMessageId: replyMeta ? replyMeta.replyToMessageId : null,
        replyToSnapshot: replyMeta ? replyMeta.replyToSnapshot : null,
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
      const info = this.users.get(socket.id);
      if (!info || !info.joinedRooms.has(roomId)) return;
      const key = String(userId);
      if (!this.typingUsers.has(roomId)) this.typingUsers.set(roomId, new Map());
      const roomTyping = this.typingUsers.get(roomId);
      if (isTyping) {
        roomTyping.set(key, {
          userId,
          username,
          expiresAt: Date.now() + 3000,
        });
      } else {
        roomTyping.delete(key);
        if (roomTyping.size === 0) this.typingUsers.delete(roomId);
      }
      socket.to(roomId).emit("chat:typing", { userId, username, roomId, isTyping: !!isTyping });
      this._broadcastTypingState(roomId);
    });

    socket.on("chat:message:reaction", ({ roomId, messageId, emoji }) => {
      const info = this.users.get(socket.id);
      if (!info || !info.joinedRooms.has(roomId)) return;

      const reaction = this._toggleMessageReaction(
        roomId,
        messageId,
        { userId, username },
        typeof emoji === "string" ? emoji.trim() : "",
      );
      if (!reaction) {
        socket.emit("chat:error", { message: "Message not found or invalid reaction" });
        return;
      }
      this.io.to(roomId).emit("chat:message:reaction", reaction);
    });

    socket.on("chat:message:edit", ({ roomId, messageId, text }) => {
      const info = this.users.get(socket.id);
      if (!info || !info.joinedRooms.has(roomId)) return;
      const edited = this.editMessage(roomId, messageId, userId, text);
      if (!edited) {
        socket.emit("chat:error", { message: "Message not found or edit not allowed" });
        return;
      }
      this.io.to(roomId).emit("chat:message:edited", {
        roomId,
        messageId: edited.id,
        text: edited.text,
        editedAt: edited.editedAt,
      });
    });

    socket.on("chat:message:delete", ({ roomId, messageId }) => {
      const info = this.users.get(socket.id);
      if (!info || !info.joinedRooms.has(roomId)) return;
      const deleted = this.deleteMessage(roomId, messageId, userId, role);
      if (!deleted) {
        socket.emit("chat:error", { message: "Message not found or delete not allowed" });
        return;
      }
      this.io.to(roomId).emit("chat:message:deleted", {
        roomId,
        messageId: deleted.id,
        deleted: true,
        deletedAt: deleted.deletedAt,
      });
    });

    socket.on("notification:ack", ({ notificationId }) => {
      if (!notificationId) return;
      acknowledgePendingNotification(notificationId, userId);
    });

    socket.on("collab:session:join", ({ sessionId }) => {
      if (!sessionId || typeof sessionId !== "string") {
        socket.emit("collab:error", { message: "Invalid session id" });
        return;
      }
      const session = getSession(sessionId);
      if (!session) {
        socket.emit("collab:error", { message: "Session not found", sessionId });
        return;
      }

      joinSession(sessionId, userId);
      const info = this.users.get(socket.id);
      if (!info) return;
      info.joinedCollabSessions.add(sessionId);

      const roomName = this._getCollabRoomName(sessionId);
      socket.join(roomName);

      if (!this.collaborationPresence.has(sessionId)) {
        this.collaborationPresence.set(sessionId, new Map());
      }
      const roomPresence = this.collaborationPresence.get(sessionId);
      const key = String(userId);
      const existing = roomPresence.get(key);
      roomPresence.set(key, {
        userId,
        username,
        role,
        socketCount: (existing?.socketCount || 0) + 1,
      });

      socket.emit("collab:session:joined", {
        sessionId,
        sessionName: session.name,
        participants: this._getCollabPresence(sessionId),
      });
      this._broadcastCollabPresence(sessionId);
    });

    socket.on("collab:session:leave", ({ sessionId }) => {
      const info = this.users.get(socket.id);
      if (!info || !info.joinedCollabSessions.has(sessionId)) return;

      const roomName = this._getCollabRoomName(sessionId);
      socket.leave(roomName);
      info.joinedCollabSessions.delete(sessionId);
      this._handleCollaborationLeave(sessionId, userId);
    });

    socket.on("collab:query:draft", ({ sessionId, query }) => {
      const info = this.users.get(socket.id);
      if (!info || !info.joinedCollabSessions.has(sessionId)) return;

      const safeQuery = typeof query === "string" ? query.slice(0, 500) : "";
      socket.to(this._getCollabRoomName(sessionId)).emit("collab:query:draft", {
        sessionId,
        query: safeQuery,
        user: { userId, username, role },
        timestamp: Date.now(),
      });
    });

    socket.on("collab:search:share", ({ sessionId, query, engine, resultCount }) => {
      const info = this.users.get(socket.id);
      if (!info || !info.joinedCollabSessions.has(sessionId)) return;

      const recorded = recordSearch(sessionId, {
        userId,
        query: typeof query === "string" ? query.slice(0, 500) : "",
        engine: typeof engine === "string" ? engine.slice(0, 50) : "unknown",
        resultCount: Number.isFinite(Number(resultCount)) ? Number(resultCount) : 0,
      });

      if (!recorded) {
        socket.emit("collab:error", { message: "Session not found", sessionId });
        return;
      }

      this.io.to(this._getCollabRoomName(sessionId)).emit("collab:search:shared", {
        sessionId,
        search: recorded,
        user: { userId, username, role },
      });
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
          const roomTyping = this.typingUsers.get(roomId);
          if (roomTyping) {
            roomTyping.delete(String(userId));
            if (roomTyping.size === 0) this.typingUsers.delete(roomId);
          }
          this._broadcastTypingState(roomId);
          this._broadcastRoomPresence(roomId);
        }
        for (const sessionId of info.joinedCollabSessions) {
          this._handleCollaborationLeave(sessionId, userId);
        }
        this.users.delete(socket.id);
      }
    });
  }

  _handleCollaborationLeave(sessionId, userId) {
    leaveSession(sessionId, userId);

    const roomPresence = this.collaborationPresence.get(sessionId);
    if (!roomPresence) return;
    const key = String(userId);
    const existing = roomPresence.get(key);
    if (existing) {
      const nextCount = existing.socketCount - 1;
      if (nextCount <= 0) {
        roomPresence.delete(key);
      } else {
        roomPresence.set(key, { ...existing, socketCount: nextCount });
      }
    }
    if (roomPresence.size === 0) {
      this.collaborationPresence.delete(sessionId);
    }
    this._broadcastCollabPresence(sessionId);
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

  getAdminLoadSnapshot() {
    const loads = new Map();
    for (const [, info] of this.users) {
      if (String(info.role) !== "admin") continue;
      const key = String(info.userId);
      if (!loads.has(key)) {
        loads.set(key, {
          userId: info.userId,
          username: info.username,
          activeRooms: new Set(),
        });
      }
      for (const roomId of info.joinedRooms || []) {
        if (roomId === ADMIN_OPS_ROOM) continue;
        loads.get(key).activeRooms.add(roomId);
      }
    }
    return [...loads.values()]
      .map((entry) => ({ userId: entry.userId, username: entry.username, load: entry.activeRooms.size }))
      .sort((a, b) => a.load - b.load || String(a.userId).localeCompare(String(b.userId)));
  }

  suggestSupportAssignee(topic = "general", priority = "normal") {
    const normalizedTopic = String(topic || "general").trim().toLowerCase();
    const normalizedPriority = String(priority || "normal").trim().toLowerCase();
    const admins = this.getAdminLoadSnapshot();
    if (!admins.length) return null;

    const topicWeight = {
      billing: 3,
      technical: 3,
      booking: 2,
      account: 2,
      general: 1,
    };
    const priorityWeight = {
      low: 1,
      normal: 2,
      high: 3,
      urgent: 4,
    };

    const ranked = admins.map((a) => ({
      ...a,
      topicScore: topicWeight[normalizedTopic] || 1,
      priorityScore: priorityWeight[normalizedPriority] || 2,
      score: (a.load * 10) + (topicWeight[normalizedTopic] || 1) + (priorityWeight[normalizedPriority] || 2),
    })).sort((a, b) => a.score - b.score || String(a.userId).localeCompare(String(b.userId)));

    return {
      assignee: ranked[0],
      candidates: ranked,
      topic: normalizedTopic,
      priority: normalizedPriority,
    };
  }

  createSupportRoomWithRouting({
    requesterUserId,
    requesterUsername,
    topic = "general",
    priority = "normal",
  }) {
    const suggestion = this.suggestSupportAssignee(topic, priority);
    const roomId = `support_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const roomName = `Support: ${topic}`;
    const room = this.createRoom(roomId, roomName, "support");
    if (!room) return null;

    if (requesterUserId !== undefined && requesterUserId !== null) {
      room.members.add(requesterUserId);
      this.joinUserToRoom(requesterUserId, roomId);
    }

    if (suggestion?.assignee?.userId !== undefined) {
      room.assignedAdminId = suggestion.assignee.userId;
      room.assignment = {
        topic: suggestion.topic,
        priority: suggestion.priority,
        score: suggestion.assignee.score,
        candidates: suggestion.candidates.map((c) => ({ userId: c.userId, load: c.load, score: c.score })),
        assignedAt: new Date().toISOString(),
      };
      this.joinUserToRoom(suggestion.assignee.userId, roomId);
      room.members.add(suggestion.assignee.userId);
    }

    this._saveRooms();

    return {
      room,
      routing: {
        roomId,
        assignedAdminId: room.assignedAdminId || null,
        topic: suggestion?.topic || String(topic || "general").toLowerCase(),
        priority: suggestion?.priority || String(priority || "normal").toLowerCase(),
        candidates: suggestion?.candidates || [],
        requester: { userId: requesterUserId, username: requesterUsername || null },
      },
    };
  }

  suggestSupportAssignment(roomId, topic = "general", priority = "normal") {
    const room = this.rooms.get(roomId);
    if (!room || room.type !== "support") return null;
    const suggestion = this.suggestSupportAssignee(topic, priority);
    if (!suggestion) return null;

    return {
      roomId,
      topic: suggestion.topic,
      priority: suggestion.priority,
      suggestedAssigneeId: suggestion.assignee.userId,
      factors: {
        load: suggestion.assignee.load,
        topicScore: suggestion.assignee.topicScore,
        priorityScore: suggestion.assignee.priorityScore,
        totalScore: suggestion.assignee.score,
      },
      candidates: suggestion.candidates.map((c) => ({
        userId: c.userId,
        username: c.username,
        load: c.load,
        topicScore: c.topicScore,
        priorityScore: c.priorityScore,
        totalScore: c.score,
      })),
      decidedAt: new Date().toISOString(),
    };
  }

  decideSupportAssignment(roomId, actor, decision = "accept", options = {}) {
    const room = this.rooms.get(roomId);
    if (!room || room.type !== "support") return null;
    const normalizedDecision = String(decision || "").trim().toLowerCase();
    if (!["accept", "reject"].includes(normalizedDecision)) return null;

    const topic = typeof options.topic === "string" ? options.topic : room.assignment?.topic || "general";
    const priority = typeof options.priority === "string" ? options.priority : room.assignment?.priority || "normal";
    const suggestion = this.suggestSupportAssignment(roomId, topic, priority);
    if (!suggestion) return null;

    const result = {
      roomId,
      decision: normalizedDecision,
      byUserId: actor?.userId ?? null,
      byRole: actor?.role || null,
      suggestedAssigneeId: suggestion.suggestedAssigneeId,
      appliedAssigneeId: null,
      factors: suggestion.factors,
      candidates: suggestion.candidates,
      topic: suggestion.topic,
      priority: suggestion.priority,
      decidedAt: new Date().toISOString(),
    };

    if (normalizedDecision === "accept") {
      room.assignedAdminId = suggestion.suggestedAssigneeId;
      room.assignment = {
        topic: suggestion.topic,
        priority: suggestion.priority,
        score: suggestion.factors.totalScore,
        candidates: suggestion.candidates.map((c) => ({ userId: c.userId, load: c.load, score: c.totalScore })),
        assignedAt: new Date().toISOString(),
      };
      this.joinUserToRoom(suggestion.suggestedAssigneeId, roomId);
      room.members.add(suggestion.suggestedAssigneeId);
      result.appliedAssigneeId = suggestion.suggestedAssigneeId;
    }

    this._saveRooms();

    if (this.io) {
      this.io.to(roomId).emit("support:assignment:updated", result);
    }
    if (result.appliedAssigneeId !== null) {
      this.sendToUser(result.appliedAssigneeId, {
        type: "support:assignment:updated",
        ...result,
      });
    }

    return result;
  }

  generateRoomSummary(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const messages = this.getMessages(roomId, 200).filter((m) => !m.deleted);
    const participants = [];
    const seen = new Set();

    for (const msg of messages) {
      const uid = msg?.from?.userId;
      const uname = msg?.from?.username;
      if (uid === undefined || uid === null || !uname) continue;
      const key = String(uid);
      if (seen.has(key)) continue;
      seen.add(key);
      participants.push({ userId: uid, username: uname, role: msg?.from?.role || "user" });
    }

    const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const recentText = messages.slice(-5).map((m) => `${m.from?.username || "unknown"}: ${m.text}`).join(" | ");

    return {
      roomId,
      roomName: room.name,
      roomType: room.type,
      messageCount: messages.length,
      participants,
      latestMessage: latestMessage
        ? {
            id: latestMessage.id,
            text: latestMessage.text,
            timestamp: latestMessage.timestamp,
            from: latestMessage.from,
          }
        : null,
      summaryText: recentText || "No recent messages.",
      generatedAt: new Date().toISOString(),
    };
  }

  saveHandoffNote(roomId, { authorId, authorName, note }) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const safeNote = typeof note === "string" ? note.trim().slice(0, 2000) : "";
    if (!safeNote) return null;

    const data = readJSON(CHAT_FILE);
    if (!data.handoffNotes || typeof data.handoffNotes !== "object") {
      data.handoffNotes = {};
    }
    if (!Array.isArray(data.handoffNotes[roomId])) {
      data.handoffNotes[roomId] = [];
    }

    const entry = {
      id: `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      roomId,
      authorId,
      authorName: authorName || "unknown",
      note: safeNote,
      createdAt: new Date().toISOString(),
    };

    data.handoffNotes[roomId].push(entry);
    if (data.handoffNotes[roomId].length > 200) {
      data.handoffNotes[roomId] = data.handoffNotes[roomId].slice(-200);
    }
    writeJSON(CHAT_FILE, data);
    return entry;
  }

  getHandoffNotes(roomId, limit = 50) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const data = readJSON(CHAT_FILE);
    const notes = (data.handoffNotes && data.handoffNotes[roomId]) || [];
    return notes.slice(-Math.max(1, Math.min(limit, 200)));
  }

  getSuggestedReplies(roomId, actor = {}) {
    if (!actor || String(actor.role) !== "admin") return [];

    const messages = this.getMessages(roomId, 200).filter((m) => !m.deleted);
    const latest = messages.length ? messages[messages.length - 1] : null;
    const latestText = String(latest?.text || "").toLowerCase();

    const suggestions = [];
    const pushUnique = (id, text, category) => {
      if (!suggestions.some((s) => s.id === id)) {
        suggestions.push({ id, text, category });
      }
    };

    pushUnique("acknowledge", "Thanks for reaching out — I’m checking this for you now.", "empathy");

    if (latestText.includes("refund") || latestText.includes("cancel")) {
      pushUnique(
        "refund_policy",
        "I can help with that. Please share your booking ID so I can verify refund options.",
        "policy",
      );
    }

    if (latestText.includes("booking") || latestText.includes("reservation")) {
      pushUnique(
        "booking_lookup",
        "Please share your booking ID and check-in date so I can look this up quickly.",
        "diagnostic",
      );
    }

    if (latestText.includes("error") || latestText.includes("failed") || latestText.includes("not work")) {
      pushUnique(
        "troubleshoot",
        "Sorry about that — can you share the exact error message and when it occurred?",
        "troubleshooting",
      );
    }

    pushUnique("escalate", "If needed, I can escalate this to a specialist right away.", "escalation");

    return suggestions.slice(0, 5);
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
        if (message && message.type === "notification:new") {
          this.io.to(sid).emit("notification:new", message);
        } else if (message && message.type === "notification:status") {
          this.io.to(sid).emit("notification:status", message);
        }
        sent++;
      }
    }
    console.log(`[Chat] sendToUser(${userId}): sent to ${sent} socket(s)`);
  }

  sendToOps(message, actor = null, source = "websocket") {
    this.opsEventHistory.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      source,
      actor: actor || null,
      message,
    });
    if (this.opsEventHistory.length > MAX_OPS_HISTORY) {
      this.opsEventHistory.length = MAX_OPS_HISTORY;
    }
    if (!this.io) return;
    this.io.to(ADMIN_OPS_ROOM).emit("ops:notification:delivery", message);
  }

  getOpsEventHistory(limit = 100, filters = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, MAX_OPS_HISTORY));
    const { type = null, since = null } = filters;
    let result = [...this.opsEventHistory];
    if (type) {
      result = result.filter((e) => e.message?.type === type);
    }
    if (since) {
      const sinceTime = Number(since);
      if (Number.isFinite(sinceTime) && sinceTime > 0) {
        result = result.filter((e) => Date.parse(e.timestamp) >= sinceTime);
      }
    }
    return result.slice(0, safeLimit);
  }

  clearOpsEventHistory() {
    const count = this.opsEventHistory.length;
    this.opsEventHistory.length = 0;
    return count;
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

  getRoomPresence(roomId) {
    return this._buildRoomPresence(roomId);
  }

  reset() {
    this.users.clear();
    this.rooms.clear();
    this.typingUsers.clear();
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

export function sendToOps(message, actor = null, source = "websocket") {
  chatManager.sendToOps(message, actor, source);
}

export function getOpsEventHistory(limit, filters) {
  return chatManager.getOpsEventHistory(limit, filters);
}

export function clearOpsEventHistory() {
  return chatManager.clearOpsEventHistory();
}

export function clearConnectionHistory() {
  chatManager.users.clear();
  chatManager.rooms.clear();
  chatManager.opsEventHistory = [];
}

export function clearAllConnections() {
  chatManager.users.clear();
  chatManager.rooms.clear();
  chatManager.opsEventHistory = [];
}
