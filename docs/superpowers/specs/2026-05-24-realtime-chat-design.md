# Real-Time Chat Feature Design

**Date:** 2026-05-24
**Status:** Approved

## Overview

Add real-time chat to the Hotel Search application using Socket.IO. Supports both User ↔ Admin (support) and User ↔ User (group rooms) communication.

## Motivation

The existing chat (`routes/chat.js`) is REST-only with no real-time capability. Users need instant communication for support requests and collaboration.

## Architecture

### Technology Choice

**Socket.IO** replaces the existing `ws` library for:
- Built-in rooms and namespaces
- Automatic reconnection with fallback
- Event-based protocol (cleaner than raw WebSocket messages)
- Better developer experience

### Components

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│  ┌──────────────┐    ┌───────────────────────┐  │
│  │ Chat Widget  │    │ Admin Chat Dashboard  │  │
│  │ (floating)   │    │ /admin/chat           │  │
│  └──────┬───────┘    └───────────┬───────────┘  │
│         │    Socket.IO Client    │               │
└─────────┼────────────────────────┼───────────────┘
          │                        │
          ▼                        ▼
┌─────────────────────────────────────────────────┐
│              Socket.IO Server                    │
│  Namespace: /chat                                │
│  ┌─────────────────────────────────────────┐    │
│  │ Event Handlers:                          │    │
│  │  - chat:join / chat:leave               │    │
│  │  - chat:message                          │    │
│  │  - chat:typing                           │    │
│  │  - disconnect (presence)                │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ ChatManager (state + persistence)        │    │
│  │  - rooms: Map<roomId, Room>             │    │
│  │  - users: Map<socketId, UserInfo>       │    │
│  │  - messages: persisted to JSON           │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

## Data Model

### Message

```json
{
  "id": "uuid-v4",
  "roomId": "general",
  "from": {
    "userId": "user123",
    "username": "PuuGoo",
    "role": "user"
  },
  "text": "Hello everyone!",
  "timestamp": "2026-05-24T10:00:00.000Z",
  "type": "text"
}
```

### Room

```json
{
  "id": "general",
  "name": "General Chat",
  "type": "group",
  "members": [],
  "createdAt": "2026-05-24T10:00:00.000Z"
}
```

### User Presence

```json
{
  "userId": "user123",
  "username": "PuuGoo",
  "role": "user",
  "socketId": "abc123",
  "online": true,
  "lastSeen": "2026-05-24T10:00:00.000Z"
}
```

## Socket.IO Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `chat:join` | `{ roomId }` | Join a chat room |
| `chat:leave` | `{ roomId }` | Leave a chat room |
| `chat:message` | `{ roomId, text }` | Send message to room |
| `chat:typing` | `{ roomId, isTyping }` | Typing indicator |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `chat:message:new` | `{ message }` | New message in a room |
| `chat:user:joined` | `{ userId, username, roomId }` | User joined room |
| `chat:user:left` | `{ userId, username, roomId }` | User left room |
| `chat:user:online` | `{ userId, username }` | User came online |
| `chat:user:offline` | `{ userId, username }` | User went offline |
| `chat:typing` | `{ userId, username, roomId, isTyping }` | Typing indicator from others |
| `chat:room:list` | `{ rooms }` | Available rooms list |
| `chat:room:history` | `{ roomId, messages }` | Message history for room |
| `chat:error` | `{ message }` | Error notification |

## Default Rooms

| Room ID | Name | Type | Description |
|---------|------|------|-------------|
| `general` | General Chat | group | Open chat for all authenticated users |
| `support` | Support | group | User ↔ Admin support channel |

Users can also create DM rooms (auto-generated as `dm_{userId1}_{userId2}`).

## Frontend

### Chat Widget (All Pages)

A floating chat button in the bottom-right corner:
- Shows unread message count badge
- Click opens a slide-up panel
- Panel has two views:
  1. **Room list**: shows available rooms with unread counts
  2. **Chat view**: messages list, input field, typing indicator
- Responsive: full-screen on mobile
- Remembers last open room in localStorage

### Admin Chat Dashboard (`/admin/chat`)

A dedicated page for admins:
- Left sidebar: all rooms and DMs with unread indicators
- Center: message history for selected room
- Right sidebar: online users list
- Admin can resolve/close support conversations
- Admin can create new rooms

## API Endpoints (REST)

These complement Socket.IO for non-real-time operations:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/chat/rooms` | List all rooms |
| `POST` | `/api/chat/rooms` | Create a new room |
| `GET` | `/api/chat/rooms/:id/messages` | Get message history (paginated) |
| `POST` | `/api/chat/rooms/:id/messages` | Send message (REST fallback) |
| `GET` | `/api/chat/users/online` | Get online users |

## Files to Modify/Create

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Replace `ws` with `socket.io` |
| `index.js` | Initialize Socket.IO, attach to server |
| `utils/websocket.js` | Rewrite with Socket.IO, add ChatManager |
| `routes/chat.js` | Add room endpoints, integrate with ChatManager |

### New Files

| File | Purpose |
|------|---------|
| `public/chatWidget.js` | Chat widget component (floating) |
| `public/chatWidget.css` | Chat widget styles |
| `public/adminChat.html` | Admin chat dashboard page |
| `public/adminChat.js` | Admin chat dashboard logic |
| `public/adminChat.css` | Admin chat dashboard styles |

## Security

- All chat endpoints require authentication (`checkAuthenticated`)
- Room creation restricted to authenticated users
- Admin actions (resolve, delete) restricted to admin role
- Message text sanitized (XSS prevention)
- Rate limiting on message send (max 10 messages/minute)
- Max message length: 2000 characters
- Max rooms: 100

## Persistence

Messages stored in `chat_messages.json`:
- Each room maintains its own message array
- Max 500 messages per room (older messages pruned)
- File written asynchronously to avoid blocking

## Testing

- Unit tests for ChatManager (room CRUD, message handling)
- Integration tests for Socket.IO events
- Manual testing for UI components

## Future Enhancements (Out of Scope)

- File/image sharing in chat
- Message reactions/emojis
- Message search
- Read receipts
- Push notifications for offline users
- Database storage (SQLite/PostgreSQL)
