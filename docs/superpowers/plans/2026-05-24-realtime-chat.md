# Real-Time Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time chat with Socket.IO supporting group rooms (general, support) and direct messaging, with a floating chat widget and admin dashboard.

**Architecture:** Replace `ws` with `socket.io`. A `ChatManager` class handles rooms, messages, and presence in-memory with JSON file persistence. The chat widget is a floating component injected on all authenticated pages. Admin gets a dedicated `/admin/chat` dashboard.

**Tech Stack:** Socket.IO 4.x, Express, vanilla JS (no framework), CSS variables (Imperial Hanoi design system)

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modify | Replace `ws` with `socket.io` |
| `utils/websocket.js` | Rewrite | Socket.IO server + ChatManager class |
| `index.js` | Modify | Init Socket.IO, update CSP, add admin/chat route |
| `routes/chat.js` | Modify | Add room REST endpoints, integrate ChatManager |
| `routes/pages.js` | Modify | Add `/admin/chat` route |
| `middleware/chatRateLimit.js` | Create | Chat-specific rate limiter (10 msg/min) |
| `public/chatWidget.js` | Create | Floating chat widget component |
| `public/chatWidget.css` | Create | Chat widget styles |
| `public/adminChat.html` | Create | Admin chat dashboard page |
| `public/adminChat.js` | Create | Admin chat dashboard logic |
| `public/adminChat.css` | Create | Admin chat dashboard styles |
| `tests/chatRealtime.test.js` | Create | ChatManager unit tests |

---

### Task 1: Install Socket.IO and Remove ws

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace ws with socket.io in package.json**

In `package.json`, remove `"ws": "^8.21.0"` from dependencies and add `"socket.io": "^4.8.0"`.

```json
"dependencies": {
  ...
  "socket.io": "^4.8.0"
}
```

Remove the `ws` line entirely.

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: socket.io installed, ws removed from node_modules

- [ ] **Step 3: Verify no other files import ws directly**

Run: `grep -r "from.*['\"]ws['\"]" --include="*.js" .` (excluding node_modules)
Expected: Only `utils/websocket.js` imports ws (will be rewritten in Task 2)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: replace ws with socket.io for real-time chat"
```

---

### Task 2: Rewrite WebSocket Utility with Socket.IO + ChatManager

**Files:**
- Rewrite: `utils/websocket.js`

- [ ] **Step 1: Write the new websocket.js with ChatManager**

Replace the entire contents of `utils/websocket.js` with the following. This provides Socket.IO initialization, chat room management, message persistence, and presence tracking.

```javascript
// WebSocket support — Socket.IO based real-time communication
// Manages chat rooms, direct messages, and user presence

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHAT_FILE = path.join(__dirname, "..", "chat_messages.json");
const MAX_MESSAGES_PER_ROOM = 500;
const MAX_ROOMS = 100;
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
    // Load persisted data
    this._loadRooms();
  }

  _loadRooms() {
    const data = readJSON(CHAT_FILE);
    // Ensure default rooms exist
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
    // Restore persisted rooms
    if (data.rooms) {
      for (const [id, room] of Object.entries(data.rooms)) {
        if (!this.rooms.has(id)) {
          this.rooms.set(id, { ...room, members: new Set(room.members || []) });
        }
      }
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

  createRoom(id, name, type = "group") {
    if (this.rooms.size >= MAX_ROOMS) return null;
    if (this.rooms.has(id)) return this.rooms.get(id);
    const room = { id, name, type, members: new Set(), createdAt: new Date().toISOString() };
    this.rooms.set(id, room);
    this._saveRooms();
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

    // Track user
    this.users.set(socket.id, { userId, username, role, joinedRooms: new Set() });

    // Notify others this user is online
    socket.broadcast.emit("chat:user:online", { userId, username });

    // Send room list to this user
    socket.emit("chat:room:list", { rooms: this.getRoomList() });

    // Send online users
    const onlineUsers = this._getOnlineUsers();
    socket.emit("chat:users:online", { users: onlineUsers });

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

      // Broadcast to room (including sender for confirmation)
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
    };
  }

  getActiveRooms() {
    return this.getRoomList().sort((a, b) => b.memberCount - a.memberCount);
  }

  sendToUser(userId, message) {
    for (const [sid, info] of this.users) {
      if (info.userId === userId) {
        this.io.to(sid).emit("chat:notification", message);
      }
    }
  }

  sendToRoom(roomName, message) {
    this.io.to(roomName).emit("chat:message:new", { message });
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

export function getUserConnections() {
  return [];
}

export function disconnectUser() {
  return 0;
}

export function sendToUser(userId, message) {
  chatManager.sendToUser(userId, message);
}

export function sendToRoom(roomName, message) {
  chatManager.sendToRoom(roomName, message);
}

export function clearConnectionHistory() {
  // No-op for backward compat
}

export function clearAllConnections() {
  // No-op for backward compat
}
```

- [ ] **Step 2: Verify the module loads without errors**

Run: `node -e "import('./utils/websocket.js').then(m => console.log('OK:', Object.keys(m)))"`
Expected: `OK: ['initWebSocket', 'getChatManager', 'getConnectionStats', ...]`

- [ ] **Step 3: Commit**

```bash
git add utils/websocket.js
git commit -m "feat: rewrite websocket.js with Socket.IO and ChatManager"
```

---

### Task 3: Initialize Socket.IO in Server

**Files:**
- Modify: `index.js`

- [ ] **Step 1: Add initWebSocket call after server.listen**

In `index.js`, find the session middleware setup (around line 255). Store it in a variable so we can pass it to Socket.IO:

```javascript
const sessionMiddleware = session({
  // ... existing session config options
});
app.use(sessionMiddleware);
```

Then find the server startup block:

```javascript
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
  getSSEManager().startHeartbeat(30000);
});
```

Add the Socket.IO initialization:

```javascript
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
  getSSEManager().startHeartbeat(30000);
  // Initialize Socket.IO for real-time chat (shares express-session)
  initWebSocket(server, sessionMiddleware);
  console.log("Socket.IO initialized on /socket.io");
});
```

- [ ] **Step 2: Add import for initWebSocket**

At the top of `index.js`, find the existing import:

```javascript
import { getSSEManager } from "./middleware/sse.js";
```

Add below it:

```javascript
import { initWebSocket } from "./utils/websocket.js";
```

- [ ] **Step 3: Update CSP connect-src for Socket.IO**

Find the CSP header in index.js (around line 216):

```javascript
"connect-src 'self' https://va.vercel-scripts.com",
```

Change to:

```javascript
"connect-src 'self' https://va.vercel-scripts.com ws: wss:",
```

This allows WebSocket connections for Socket.IO's transport layer.

- [ ] **Step 4: Add admin chat page route**

In `routes/pages.js`, add before the final `export default router;`:

```javascript
router.get("/admin/chat", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "adminChat.html"));
});
```

- [ ] **Step 5: Verify server starts without errors**

Run: `timeout 5 node index.js || true`
Expected: Console shows "Socket.IO initialized on /socket.io" before timeout kills it

- [ ] **Step 6: Commit**

```bash
git add index.js routes/pages.js
git commit -m "feat: initialize Socket.IO server and add admin chat route"
```

---

### Task 4: Add Chat Rate Limiter

**Files:**
- Create: `middleware/chatRateLimit.js`

- [ ] **Step 1: Create chat rate limiter middleware**

```javascript
// Chat-specific rate limiter: 10 messages per minute per user

const messageTimestamps = new Map(); // userId -> [timestamps]
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_MESSAGES = 10;

setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of messageTimestamps) {
    const filtered = timestamps.filter((t) => now - t < WINDOW_MS);
    if (filtered.length === 0) messageTimestamps.delete(userId);
    else messageTimestamps.set(userId, filtered);
  }
}, 30000).unref();

export function checkChatRateLimit(userId) {
  const now = Date.now();
  const timestamps = messageTimestamps.get(userId) || [];
  const recent = timestamps.filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_MESSAGES) {
    return { allowed: false, retryAfter: Math.ceil((recent[0] + WINDOW_MS - now) / 1000) };
  }

  recent.push(now);
  messageTimestamps.set(userId, recent);
  return { allowed: true };
}
```

- [ ] **Step 2: Integrate rate limiter into ChatManager message handler**

In `utils/websocket.js`, add import at the top:

```javascript
import { checkChatRateLimit } from "../middleware/chatRateLimit.js";
```

In the `chat:message` handler inside `_handleConnection`, add rate limit check before processing:

```javascript
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
    // ... rest unchanged
```

- [ ] **Step 3: Commit**

```bash
git add middleware/chatRateLimit.js utils/websocket.js
git commit -m "feat: add chat rate limiter (10 msg/min per user)"
```

---

### Task 5: Update REST Chat Routes

**Files:**
- Modify: `routes/chat.js`

- [ ] **Step 1: Add room management endpoints**

Add these endpoints to `routes/chat.js`, after the existing routes:

```javascript
// List chat rooms
router.get("/api/chat/rooms", checkAuthenticated, (req, res) => {
  try {
    const { getChatManager } = require("../utils/websocket.js");
    const manager = getChatManager();
    res.json({ rooms: manager.getRoomList() });
  } catch (e) {
    res.status(500).json({ error: "Failed to list rooms" });
  }
});

// Create a new room
router.post("/api/chat/rooms", checkAuthenticated, (req, res) => {
  try {
    const { id, name, type } = req.body;
    if (!id || !name) {
      return res.status(400).json({ error: "id and name are required" });
    }
    const safeId = id.toString().trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 50);
    const safeName = name.toString().trim().slice(0, 100);
    if (!safeId) {
      return res.status(400).json({ error: "Invalid room id" });
    }
    const { getChatManager } = require("../utils/websocket.js");
    const manager = getChatManager();
    const room = manager.createRoom(safeId, safeName, type || "group");
    if (!room) {
      return res.status(500).json({ error: "Failed to create room" });
    }
    res.json({ success: true, room: { id: room.id, name: room.name, type: room.type } });
  } catch (e) {
    res.status(500).json({ error: "Failed to create room" });
  }
});

// Get message history for a room
router.get("/api/chat/rooms/:roomId/messages", checkAuthenticated, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const { getChatManager } = require("../utils/websocket.js");
    const manager = getChatManager();
    const messages = manager.getMessages(req.params.roomId, limit);
    res.json({ roomId: req.params.roomId, messages });
  } catch (e) {
    res.status(500).json({ error: "Failed to get messages" });
  }
});

// Get online users
router.get("/api/chat/users/online", checkAuthenticated, (req, res) => {
  try {
    const { getChatManager } = require("../utils/websocket.js");
    const manager = getChatManager();
    res.json({ users: manager.getOnlineUsers() });
  } catch (e) {
    res.status(500).json({ error: "Failed to get online users" });
  }
});
```

Note: Since this file uses ES modules (`import`), change the `require` calls to use the already-imported `getChatManager`. Add at the top of the file:

```javascript
import { getChatManager } from "../utils/websocket.js";
```

Then replace all `require("../utils/websocket.js")` references with direct calls to `getChatManager()`.

- [ ] **Step 2: Verify REST endpoints work**

Run: `timeout 5 node index.js || true`
Expected: Server starts without errors

- [ ] **Step 3: Commit**

```bash
git add routes/chat.js
git commit -m "feat: add chat room REST endpoints"
```

---

### Task 6: Create Chat Widget CSS

**Files:**
- Create: `public/chatWidget.css`

- [ ] **Step 1: Write chat widget styles**

```css
/* Chat Widget — Floating bottom-right panel */
.chat-widget-trigger {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-round);
  background: var(--gradient-gold);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-lg), var(--shadow-gold);
  z-index: var(--z-fixed, 500);
  transition: transform var(--transition-smooth), box-shadow var(--transition-smooth);
  color: var(--text-inverse);
  font-size: 1.4rem;
}

.chat-widget-trigger:hover {
  transform: scale(1.08);
  box-shadow: var(--shadow-xl), 0 4px 32px rgba(212, 168, 83, 0.3);
}

.chat-widget-trigger .badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background: var(--color-coral);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  min-width: 20px;
  height: 20px;
  border-radius: var(--radius-round);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  border: 2px solid var(--color-bg);
}

.chat-widget-panel {
  position: fixed;
  bottom: 90px;
  right: 24px;
  width: 380px;
  max-height: 520px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  z-index: var(--z-modal, 1000);
  display: none;
  flex-direction: column;
  overflow: hidden;
  animation: chatSlideUp 0.3s ease;
}

.chat-widget-panel.open {
  display: flex;
}

@keyframes chatSlideUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

.chat-widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-surface-raised);
  border-bottom: 1px solid var(--color-border);
}

.chat-widget-header h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-md);
  color: var(--color-gold);
}

.chat-widget-header button {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 1.1rem;
  padding: 4px;
}

.chat-widget-header button:hover {
  color: var(--text-primary);
}

.chat-widget-rooms {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-xs);
}

.chat-room-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
  color: var(--text-primary);
}

.chat-room-item:hover {
  background: var(--color-surface-hover);
}

.chat-room-item.active {
  background: var(--color-gold-dim);
  border-left: 3px solid var(--color-gold);
}

.chat-room-item .room-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-round);
  background: var(--color-gold-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-gold);
  font-size: 0.9rem;
  flex-shrink: 0;
}

.chat-room-item .room-info {
  flex: 1;
  min-width: 0;
}

.chat-room-item .room-name {
  font-weight: 600;
  font-size: var(--font-size-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-room-item .room-preview {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-room-item .unread-badge {
  background: var(--color-coral);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  border-radius: var(--radius-round);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

/* Chat messages view */
.chat-messages-view {
  display: none;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.chat-messages-view.active {
  display: flex;
}

.chat-messages-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-surface-raised);
  border-bottom: 1px solid var(--color-border);
}

.chat-messages-header .back-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 1rem;
  padding: 4px;
}

.chat-messages-header .back-btn:hover {
  color: var(--color-gold);
}

.chat-messages-header .room-title {
  font-family: var(--font-display);
  font-size: var(--font-size-sm);
  color: var(--color-gold);
  flex: 1;
}

.chat-messages-header .online-count {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.chat-messages-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-sm);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-message {
  max-width: 80%;
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  line-height: 1.4;
  word-wrap: break-word;
}

.chat-message.own {
  align-self: flex-end;
  background: var(--color-gold-dim);
  border: 1px solid var(--color-border);
  color: var(--text-primary);
}

.chat-message.other {
  align-self: flex-start;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  color: var(--text-primary);
}

.chat-message .msg-author {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-gold);
  margin-bottom: 2px;
}

.chat-message .msg-time {
  font-size: 0.65rem;
  color: var(--text-tertiary);
  margin-top: 2px;
  text-align: right;
}

.chat-message.system {
  align-self: center;
  background: none;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  font-style: italic;
  border: none;
  padding: 4px;
}

.chat-typing-indicator {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  padding: 4px var(--spacing-sm);
  font-style: italic;
  min-height: 20px;
}

.chat-input-area {
  display: flex;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}

.chat-input-area input {
  flex: 1;
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: var(--font-size-sm);
  outline: none;
}

.chat-input-area input:focus {
  border-color: var(--color-gold);
  box-shadow: 0 0 0 2px var(--color-gold-dim);
}

.chat-input-area button {
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--gradient-gold);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-inverse);
  cursor: pointer;
  font-weight: 600;
  font-size: var(--font-size-sm);
  transition: opacity var(--transition-fast);
}

.chat-input-area button:hover {
  opacity: 0.9;
}

.chat-input-area button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Mobile responsive */
@media (max-width: 480px) {
  .chat-widget-panel {
    bottom: 0;
    right: 0;
    left: 0;
    width: 100%;
    max-height: 100vh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/chatWidget.css
git commit -m "feat: add chat widget CSS styles"
```

---

### Task 7: Create Chat Widget JavaScript

**Files:**
- Create: `public/chatWidget.js`

- [ ] **Step 1: Write the chat widget component**

```javascript
/* Chat Widget — Floating real-time chat component */
(function () {
  "use strict";

  // Load Socket.IO client from same origin
  const SCRIPT_SRC = "/socket.io/socket.io.js";

  let socket = null;
  let currentRoom = null;
  let currentUser = null;
  let rooms = [];
  let unreadCounts = {};
  let typingTimeout = null;

  // --- Inject CSS ---
  function loadCSS() {
    if (document.querySelector('link[href="/chatWidget.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/chatWidget.css";
    document.head.appendChild(link);
  }

  // --- Inject HTML ---
  function injectHTML() {
    if (document.getElementById("chatWidget")) return;

    const wrapper = document.createElement("div");
    wrapper.id = "chatWidget";
    wrapper.innerHTML = `
      <button class="chat-widget-trigger" id="chatTrigger" aria-label="Open chat">
        <i class="fas fa-comments"></i>
        <span class="badge" id="chatBadge" style="display:none">0</span>
      </button>
      <div class="chat-widget-panel" id="chatPanel">
        <div id="chatRoomList">
          <div class="chat-widget-header">
            <h3><i class="fas fa-comments"></i> Chat</h3>
            <button id="chatClose" aria-label="Close"><i class="fas fa-times"></i></button>
          </div>
          <div class="chat-widget-rooms" id="chatRooms"></div>
        </div>
        <div class="chat-messages-view" id="chatMessagesView">
          <div class="chat-messages-header">
            <button class="back-btn" id="chatBack" aria-label="Back"><i class="fas fa-arrow-left"></i></button>
            <span class="room-title" id="chatRoomTitle">Room</span>
            <span class="online-count" id="chatOnlineCount"></span>
          </div>
          <div class="chat-messages-list" id="chatMessagesList"></div>
          <div class="chat-typing-indicator" id="chatTyping"></div>
          <div class="chat-input-area">
            <input type="text" id="chatInput" placeholder="Type a message..." maxlength="2000" autocomplete="off" />
            <button id="chatSend"><i class="fas fa-paper-plane"></i></button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);
  }

  // --- Get current user info ---
  async function fetchCurrentUser() {
    try {
      const res = await fetch("/api/me");
      if (res.ok) {
        currentUser = await res.json();
      }
    } catch { /* not authenticated */ }
  }

  // --- Socket.IO connection ---
  function connectSocket() {
    if (socket) return;

    socket = io({ path: "/socket.io", withCredentials: true });

    socket.on("connect", () => {
      console.log("[Chat] Connected");
    });

    socket.on("chat:room:list", ({ rooms: roomList }) => {
      rooms = roomList;
      renderRoomList();
    });

    socket.on("chat:room:history", ({ roomId, messages }) => {
      if (roomId === currentRoom) {
        renderMessages(messages);
      }
    });

    socket.on("chat:message:new", ({ message }) => {
      if (message.roomId === currentRoom) {
        appendMessage(message);
        scrollMessagesToBottom();
      } else {
        // Increment unread
        unreadCounts[message.roomId] = (unreadCounts[message.roomId] || 0) + 1;
        updateBadge();
        renderRoomList();
      }
    });

    socket.on("chat:typing", ({ userId, username, roomId, isTyping }) => {
      if (roomId === currentRoom) {
        const el = document.getElementById("chatTyping");
        if (el) el.textContent = isTyping ? `${username} is typing...` : "";
      }
    });

    socket.on("chat:user:online", ({ userId, username }) => {
      console.log("[Chat] Online:", username);
    });

    socket.on("chat:user:offline", ({ userId, username }) => {
      console.log("[Chat] Offline:", username);
    });

    socket.on("chat:users:online", ({ users }) => {
      const el = document.getElementById("chatOnlineCount");
      if (el) el.textContent = `${users.length} online`;
    });

    socket.on("chat:error", ({ message }) => {
      console.error("[Chat] Error:", message);
      if (window.Toasts) window.Toasts.error(message);
    });

    socket.on("disconnect", () => {
      console.log("[Chat] Disconnected");
    });
  }

  // --- UI Rendering ---
  function renderRoomList() {
    const container = document.getElementById("chatRooms");
    if (!container) return;

    container.innerHTML = rooms.map((room) => {
      const unread = unreadCounts[room.id] || 0;
      const icon = room.type === "dm" ? "fa-user" : "fa-hashtag";
      return `
        <div class="chat-room-item" data-room="${room.id}">
          <div class="room-icon"><i class="fas ${icon}"></i></div>
          <div class="room-info">
            <div class="room-name">${escapeHTML(room.name)}</div>
            <div class="room-preview">${room.memberCount || 0} members</div>
          </div>
          ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ""}
        </div>
      `;
    }).join("");

    // Attach click handlers
    container.querySelectorAll(".chat-room-item").forEach((el) => {
      el.addEventListener("click", () => joinRoom(el.dataset.room));
    });
  }

  function joinRoom(roomId) {
    if (currentRoom) {
      socket.emit("chat:leave", { roomId: currentRoom });
    }
    currentRoom = roomId;
    unreadCounts[roomId] = 0;
    updateBadge();

    socket.emit("chat:join", { roomId });

    // Switch to messages view
    document.getElementById("chatRoomList").style.display = "none";
    document.getElementById("chatMessagesView").classList.add("active");
    const room = rooms.find((r) => r.id === roomId);
    document.getElementById("chatRoomTitle").textContent = room ? room.name : roomId;
    document.getElementById("chatMessagesList").innerHTML = "";
    document.getElementById("chatInput").focus();
  }

  function goBackToRooms() {
    if (currentRoom) {
      socket.emit("chat:leave", { roomId: currentRoom });
      currentRoom = null;
    }
    document.getElementById("chatMessagesView").classList.remove("active");
    document.getElementById("chatRoomList").style.display = "";
    renderRoomList();
  }

  function renderMessages(messages) {
    const container = document.getElementById("chatMessagesList");
    if (!container) return;
    container.innerHTML = "";
    messages.forEach((msg) => appendMessage(msg));
    scrollMessagesToBottom();
  }

  function appendMessage(message) {
    const container = document.getElementById("chatMessagesList");
    if (!container) return;

    const isOwn = currentUser && message.from && message.from.userId === currentUser.id;
    const isSystem = message.type === "system";
    const time = new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const div = document.createElement("div");
    if (isSystem) {
      div.className = "chat-message system";
      div.textContent = message.text;
    } else {
      div.className = `chat-message ${isOwn ? "own" : "other"}`;
      div.innerHTML = `
        ${isOwn ? "" : `<div class="msg-author">${escapeHTML(message.from?.username || "Unknown")}</div>`}
        <div>${escapeHTML(message.text)}</div>
        <div class="msg-time">${time}</div>
      `;
    }
    container.appendChild(div);
  }

  function scrollMessagesToBottom() {
    const container = document.getElementById("chatMessagesList");
    if (container) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }

  function sendMessage() {
    const input = document.getElementById("chatInput");
    if (!input || !currentRoom || !socket) return;
    const text = input.value.trim();
    if (!text) return;

    socket.emit("chat:message", { roomId: currentRoom, text });
    input.value = "";
    // Stop typing indicator
    socket.emit("chat:typing", { roomId: currentRoom, isTyping: false });
  }

  function updateBadge() {
    const total = Object.values(unreadCounts).reduce((s, n) => s + n, 0);
    const badge = document.getElementById("chatBadge");
    if (badge) {
      badge.textContent = total;
      badge.style.display = total > 0 ? "" : "none";
    }
  }

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  // --- Event binding ---
  function bindEvents() {
    document.getElementById("chatTrigger").addEventListener("click", () => {
      const panel = document.getElementById("chatPanel");
      panel.classList.toggle("open");
      if (panel.classList.contains("open") && !socket) {
        connectSocket();
      }
    });

    document.getElementById("chatClose").addEventListener("click", () => {
      document.getElementById("chatPanel").classList.remove("open");
    });

    document.getElementById("chatBack").addEventListener("click", goBackToRooms);

    document.getElementById("chatSend").addEventListener("click", sendMessage);

    document.getElementById("chatInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Typing indicator
    document.getElementById("chatInput").addEventListener("input", () => {
      if (!currentRoom || !socket) return;
      socket.emit("chat:typing", { roomId: currentRoom, isTyping: true });
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        socket.emit("chat:typing", { roomId: currentRoom, isTyping: false });
      }, 2000);
    });
  }

  // --- Init ---
  async function init() {
    // Only load on authenticated pages
    try {
      const res = await fetch("/api/me");
      if (!res.ok) return; // Not authenticated, don't show widget
      currentUser = await res.json();
    } catch {
      return;
    }

    loadCSS();
    injectHTML();
    bindEvents();
  }

  // Run on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
```

- [ ] **Step 2: Verify widget loads on authenticated pages**

Start the server, log in, and check browser console for "[Chat] Connected" message.

- [ ] **Step 3: Commit**

```bash
git add public/chatWidget.js public/chatWidget.css
git commit -m "feat: add floating chat widget with Socket.IO integration"
```

---

### Task 8: Create Admin Chat Dashboard

**Files:**
- Create: `public/adminChat.html`
- Create: `public/adminChat.js`
- Create: `public/adminChat.css`

- [ ] **Step 1: Create adminChat.html**

```html
<!DOCTYPE html>
<html lang="vi" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Chat — Hotel Search</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/app.css">
  <link rel="stylesheet" href="/chatWidget.css">
  <link rel="stylesheet" href="/adminChat.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" crossorigin="anonymous" referrerpolicy="no-referrer">
  <script>
    if (!window.Toasts) {
      window.Toasts = {
        show: function(msg, opts) { console.log("[Toast]", (opts && opts.type) || "info", msg); },
        success: function(msg) { console.log("[Toast] success", msg); },
        error: function(msg) { console.log("[Toast] error", msg); },
        warning: function(msg) { console.log("[Toast] warning", msg); },
        info: function(msg) { console.log("[Toast] info", msg); },
      };
    }
  </script>
</head>
<body>
  <nav class="navbar">
    <a href="/dashboard" class="nav-brand">Hotel Search</a>
    <div class="nav-links">
      <a href="/dashboard">Dashboard</a>
      <a href="/admin/chat" class="active">Admin Chat</a>
      <a href="/admin-dashboard">Admin</a>
    </div>
  </nav>

  <main class="admin-chat-layout">
    <aside class="admin-chat-sidebar">
      <div class="sidebar-header">
        <h2><i class="fas fa-comments"></i> Chat Rooms</h2>
        <button id="createRoomBtn" class="btn btn-sm" title="Create Room"><i class="fas fa-plus"></i></button>
      </div>
      <div class="room-list" id="adminRoomList"></div>
      <div class="sidebar-section">
        <h3><i class="fas fa-users"></i> Online</h3>
        <div class="online-list" id="adminOnlineList"></div>
      </div>
    </aside>

    <section class="admin-chat-main">
      <div class="chat-placeholder" id="chatPlaceholder">
        <i class="fas fa-comments" style="font-size: 3rem; color: var(--text-tertiary); margin-bottom: var(--spacing-md);"></i>
        <p>Select a room to start chatting</p>
      </div>
      <div class="admin-chat-view" id="adminChatView" style="display:none">
        <div class="admin-chat-header">
          <h3 id="adminRoomTitle">Room</h3>
          <span class="online-count" id="adminOnlineCount"></span>
        </div>
        <div class="admin-messages-list" id="adminMessagesList"></div>
        <div class="chat-typing-indicator" id="adminTyping"></div>
        <div class="chat-input-area">
          <input type="text" id="adminChatInput" placeholder="Type a message..." maxlength="2000" autocomplete="off" />
          <button id="adminChatSend"><i class="fas fa-paper-plane"></i></button>
        </div>
      </div>
    </section>
  </main>

  <!-- Create Room Modal -->
  <div class="modal-overlay" id="createRoomModal" style="display:none">
    <div class="modal-card">
      <h3>Create New Room</h3>
      <form id="createRoomForm">
        <label>Room ID</label>
        <input type="text" id="newRoomId" placeholder="e.g. vip-support" required pattern="[a-z0-9_-]+" maxlength="50">
        <label>Room Name</label>
        <input type="text" id="newRoomName" placeholder="e.g. VIP Support" required maxlength="100">
        <div class="modal-actions">
          <button type="button" class="btn" id="cancelCreateRoom">Cancel</button>
          <button type="submit" class="btn btn-primary">Create</button>
        </div>
      </form>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/socket.io-client@4/dist/socket.io.min.js"></script>
  <script src="/adminChat.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create adminChat.css**

```css
/* Admin Chat Dashboard Layout */
.admin-chat-layout {
  display: flex;
  height: calc(100vh - 60px);
  max-width: 1400px;
  margin: 0 auto;
}

.admin-chat-sidebar {
  width: 280px;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
}

.sidebar-header h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-md);
  color: var(--color-gold);
}

.sidebar-header h2 i {
  margin-right: 6px;
}

.btn-sm {
  padding: 6px 10px;
  font-size: var(--font-size-xs);
}

.room-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-xs);
}

.room-list .chat-room-item {
  padding: var(--spacing-sm) var(--spacing-md);
}

.room-list .chat-room-item.active {
  background: var(--color-gold-dim);
  border-left: 3px solid var(--color-gold);
}

.sidebar-section {
  border-top: 1px solid var(--color-border);
  padding: var(--spacing-sm) var(--spacing-md);
  max-height: 200px;
  overflow-y: auto;
}

.sidebar-section h3 {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  font-weight: 600;
}

.sidebar-section h3 i {
  margin-right: 4px;
}

.online-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.online-user {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  padding: 4px 0;
}

.online-user .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-emerald);
  flex-shrink: 0;
}

.online-user .role-badge {
  font-size: 0.6rem;
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  background: var(--color-purple-dim);
  color: var(--color-purple);
  font-weight: 600;
  text-transform: uppercase;
}

/* Main chat area */
.admin-chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}

.admin-chat-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.admin-chat-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.admin-chat-header h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-md);
  color: var(--color-gold);
  flex: 1;
}

.admin-chat-header .online-count {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.admin-messages-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--color-bg);
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal, 1000);
}

.modal-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  width: 360px;
  max-width: 90vw;
}

.modal-card h3 {
  margin: 0 0 var(--spacing-md);
  font-family: var(--font-display);
  color: var(--color-gold);
}

.modal-card label {
  display: block;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-bottom: 4px;
  margin-top: var(--spacing-sm);
}

.modal-card input {
  width: 100%;
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: var(--font-size-sm);
  outline: none;
  box-sizing: border-box;
}

.modal-card input:focus {
  border-color: var(--color-gold);
}

.modal-actions {
  display: flex;
  gap: var(--spacing-sm);
  justify-content: flex-end;
  margin-top: var(--spacing-md);
}

/* Responsive */
@media (max-width: 768px) {
  .admin-chat-layout {
    flex-direction: column;
  }
  .admin-chat-sidebar {
    width: 100%;
    max-height: 200px;
    border-right: none;
    border-bottom: 1px solid var(--color-border);
  }
}
```

- [ ] **Step 3: Create adminChat.js**

```javascript
/* Admin Chat Dashboard */
(function () {
  "use strict";

  let socket = null;
  let currentRoom = null;
  let currentUser = null;
  let rooms = [];
  let typingTimeout = null;

  async function init() {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) { window.location.href = "/"; return; }
      currentUser = await res.json();
      if (currentUser.role !== "admin") {
        window.location.href = "/dashboard";
        return;
      }
    } catch { window.location.href = "/"; return; }

    connectSocket();
    bindEvents();
  }

  function connectSocket() {
    socket = io({ path: "/socket.io", withCredentials: true });

    socket.on("connect", () => console.log("[AdminChat] Connected"));

    socket.on("chat:room:list", ({ rooms: roomList }) => {
      rooms = roomList;
      renderRoomList();
    });

    socket.on("chat:room:history", ({ roomId, messages }) => {
      if (roomId === currentRoom) renderMessages(messages);
    });

    socket.on("chat:message:new", ({ message }) => {
      if (message.roomId === currentRoom) {
        appendMessage(message);
        scrollMessagesToBottom();
      }
    });

    socket.on("chat:typing", ({ username, roomId, isTyping }) => {
      if (roomId === currentRoom) {
        const el = document.getElementById("adminTyping");
        if (el) el.textContent = isTyping ? `${username} is typing...` : "";
      }
    });

    socket.on("chat:users:online", ({ users }) => {
      renderOnlineUsers(users);
    });

    socket.on("chat:user:online", ({ username }) => {
      console.log("[AdminChat] Online:", username);
    });

    socket.on("chat:user:offline", ({ username }) => {
      console.log("[AdminChat] Offline:", username);
    });

    socket.on("chat:error", ({ message }) => {
      if (window.Toasts) window.Toasts.error(message);
    });
  }

  function renderRoomList() {
    const container = document.getElementById("adminRoomList");
    container.innerHTML = rooms.map((room) => {
      const icon = room.type === "dm" ? "fa-user" : "fa-hashtag";
      return `
        <div class="chat-room-item${currentRoom === room.id ? " active" : ""}" data-room="${room.id}">
          <div class="room-icon"><i class="fas ${icon}"></i></div>
          <div class="room-info">
            <div class="room-name">${escapeHTML(room.name)}</div>
            <div class="room-preview">${room.memberCount || 0} members</div>
          </div>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".chat-room-item").forEach((el) => {
      el.addEventListener("click", () => joinRoom(el.dataset.room));
    });
  }

  function joinRoom(roomId) {
    if (currentRoom) socket.emit("chat:leave", { roomId: currentRoom });
    currentRoom = roomId;
    socket.emit("chat:join", { roomId });

    document.getElementById("chatPlaceholder").style.display = "none";
    document.getElementById("adminChatView").style.display = "flex";
    const room = rooms.find((r) => r.id === roomId);
    document.getElementById("adminRoomTitle").textContent = room ? room.name : roomId;
    document.getElementById("adminMessagesList").innerHTML = "";
    document.getElementById("adminChatInput").focus();
    renderRoomList();
  }

  function renderMessages(messages) {
    const container = document.getElementById("adminMessagesList");
    container.innerHTML = "";
    messages.forEach((msg) => appendMessage(msg));
    scrollMessagesToBottom();
  }

  function appendMessage(message) {
    const container = document.getElementById("adminMessagesList");
    const isOwn = currentUser && message.from && message.from.userId === currentUser.id;
    const isSystem = message.type === "system";
    const time = new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const div = document.createElement("div");
    if (isSystem) {
      div.className = "chat-message system";
      div.textContent = message.text;
    } else {
      div.className = `chat-message ${isOwn ? "own" : "other"}`;
      div.innerHTML = `
        ${isOwn ? "" : `<div class="msg-author">${escapeHTML(message.from?.username || "Unknown")} <span class="role-badge">${escapeHTML(message.from?.role || "user")}</span></div>`}
        <div>${escapeHTML(message.text)}</div>
        <div class="msg-time">${time}</div>
      `;
    }
    container.appendChild(div);
  }

  function scrollMessagesToBottom() {
    const container = document.getElementById("adminMessagesList");
    if (container) requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }

  function renderOnlineUsers(users) {
    const container = document.getElementById("adminOnlineList");
    container.innerHTML = users.map((u) => `
      <div class="online-user">
        <span class="dot"></span>
        <span>${escapeHTML(u.username)}</span>
        <span class="role-badge">${escapeHTML(u.role)}</span>
      </div>
    `).join("");

    const countEl = document.getElementById("adminOnlineCount");
    if (countEl) countEl.textContent = `${users.length} online`;
  }

  function sendMessage() {
    const input = document.getElementById("adminChatInput");
    if (!input || !currentRoom || !socket) return;
    const text = input.value.trim();
    if (!text) return;
    socket.emit("chat:message", { roomId: currentRoom, text });
    input.value = "";
    socket.emit("chat:typing", { roomId: currentRoom, isTyping: false });
  }

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function bindEvents() {
    document.getElementById("adminChatSend").addEventListener("click", sendMessage);
    document.getElementById("adminChatInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    document.getElementById("adminChatInput").addEventListener("input", () => {
      if (!currentRoom || !socket) return;
      socket.emit("chat:typing", { roomId: currentRoom, isTyping: true });
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        socket.emit("chat:typing", { roomId: currentRoom, isTyping: false });
      }, 2000);
    });

    // Create room modal
    document.getElementById("createRoomBtn").addEventListener("click", () => {
      document.getElementById("createRoomModal").style.display = "flex";
    });
    document.getElementById("cancelCreateRoom").addEventListener("click", () => {
      document.getElementById("createRoomModal").style.display = "none";
    });
    document.getElementById("createRoomForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("newRoomId").value.trim();
      const name = document.getElementById("newRoomName").value.trim();
      if (!id || !name) return;
      try {
        const res = await fetch("/api/chat/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, name }),
        });
        if (res.ok) {
          document.getElementById("createRoomModal").style.display = "none";
          document.getElementById("newRoomId").value = "";
          document.getElementById("newRoomName").value = "";
          if (window.Toasts) window.Toasts.success("Room created");
        } else {
          const data = await res.json();
          if (window.Toasts) window.Toasts.error(data.error || "Failed to create room");
        }
      } catch (err) {
        if (window.Toasts) window.Toasts.error("Failed to create room");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
```

- [ ] **Step 4: Commit**

```bash
git add public/adminChat.html public/adminChat.js public/adminChat.css
git commit -m "feat: add admin chat dashboard page"
```

---

### Task 9: Write ChatManager Unit Tests

**Files:**
- Create: `tests/chatRealtime.test.js`

- [ ] **Step 1: Write tests for ChatManager**

```javascript
import { describe, test, expect, beforeEach, jest } from "@jest/globals";

// Mock socket.io
jest.unstable_mockModule("socket.io", () => ({
  Server: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  })),
}));

// Mock fs for persistence
jest.unstable_mockModule("fs", () => ({
  default: {
    existsSync: jest.fn().mockReturnValue(false),
    readFileSync: jest.fn().mockReturnValue("{}"),
    writeFileSync: jest.fn(),
  },
}));

describe("ChatManager", () => {
  let ChatManager;

  beforeEach(async () => {
    // Dynamic import to get fresh module with mocks
    const mod = await import("../utils/websocket.js");
    // ChatManager is not directly exported, but we can test via getChatManager
    ChatManager = mod.getChatManager;
  });

  test("getChatManager returns a ChatManager instance", () => {
    const manager = ChatManager();
    expect(manager).toBeDefined();
    expect(typeof manager.getRoomList).toBe("function");
    expect(typeof manager.getMessages).toBe("function");
  });

  test("default rooms exist (general, support)", () => {
    const manager = ChatManager();
    const rooms = manager.getRoomList();
    const ids = rooms.map((r) => r.id);
    expect(ids).toContain("general");
    expect(ids).toContain("support");
  });

  test("createRoom adds a new room", () => {
    const manager = ChatManager();
    const room = manager.createRoom("test-room", "Test Room", "group");
    expect(room).toBeDefined();
    expect(room.id).toBe("test-room");
    expect(room.name).toBe("Test Room");
    expect(room.type).toBe("group");

    const rooms = manager.getRoomList();
    const found = rooms.find((r) => r.id === "test-room");
    expect(found).toBeDefined();
  });

  test("createRoom returns existing room if id already exists", () => {
    const manager = ChatManager();
    const room1 = manager.createRoom("dup-room", "First", "group");
    const room2 = manager.createRoom("dup-room", "Second", "group");
    expect(room1.id).toBe(room2.id);
  });

  test("getMessages returns empty array for room with no messages", () => {
    const manager = ChatManager();
    const messages = manager.getMessages("general", 10);
    expect(Array.isArray(messages)).toBe(true);
  });

  test("getDMRoomId generates consistent room id", () => {
    const manager = ChatManager();
    const id1 = manager.getDMRoomId("user-a", "user-b");
    const id2 = manager.getDMRoomId("user-b", "user-a");
    expect(id1).toBe(id2);
    expect(id1).toBe("user-a_user-b");
  });

  test("getOnlineUsers returns empty array when no connections", () => {
    const manager = ChatManager();
    const users = manager.getOnlineUsers();
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBe(0);
  });

  test("getConnectionStats returns expected structure", () => {
    const manager = ChatManager();
    const stats = manager.getConnectionStats();
    expect(stats).toHaveProperty("activeConnections");
    expect(stats).toHaveProperty("activeRooms");
    expect(stats).toHaveProperty("roomDetails");
    expect(typeof stats.activeConnections).toBe("number");
  });

  test("getActiveRooms returns rooms sorted by member count", () => {
    const manager = ChatManager();
    const rooms = manager.getActiveRooms();
    expect(Array.isArray(rooms)).toBe(true);
    // Should be sorted descending by memberCount
    for (let i = 1; i < rooms.length; i++) {
      expect(rooms[i - 1].memberCount).toBeGreaterThanOrEqual(rooms[i].memberCount);
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/chatRealtime.test.js --verbose`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/chatRealtime.test.js
git commit -m "test: add ChatManager unit tests"
```

---

### Task 10: Integration Test — Widget on Main Page

**Files:**
- Modify: `public/hotelSearchTavily.html` (or whichever main page loads chat widget)

- [ ] **Step 1: Add chat widget script to main pages**

The chat widget auto-loads on any page that includes the script. Add before the closing `</body>` tag in `public/hotelSearchTavily.html`:

```html
<script src="/chatWidget.js"></script>
```

Also add to `public/dashboard.html`:

```html
<script src="/chatWidget.js"></script>
```

- [ ] **Step 2: Manual verification checklist**

1. Start server: `npm start`
2. Log in as a user
3. Verify chat button appears (bottom-right gold circle)
4. Click chat button — panel opens showing "General Chat" and "Support" rooms
5. Click "General Chat" — joins room, empty message list
6. Type and send a message — appears in the chat
7. Open a second browser tab, log in as different user
8. Join "General Chat" — see the message from step 6
9. Send a message — appears in both tabs in real-time
10. Verify typing indicator works (type in one tab, see indicator in other)
11. Log in as admin, go to `/admin/chat`
12. Verify admin dashboard shows rooms and online users
13. Send message from admin — appears in user's widget

- [ ] **Step 3: Commit**

```bash
git add public/hotelSearchTavily.html public/dashboard.html
git commit -m "feat: add chat widget to main pages"
```

---

### Task 11: Run Full Test Suite and Verify

- [ ] **Step 1: Run all tests**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --verbose`
Expected: All tests pass (including new chatRealtime tests)

- [ ] **Step 2: Start server and verify no errors**

Run: `timeout 5 npm start || true`
Expected: Server starts, shows "Socket.IO initialized on /socket.io"

- [ ] **Step 3: Final commit with any fixes**

```bash
git add -A
git commit -m "feat: complete real-time chat feature with Socket.IO"
```
