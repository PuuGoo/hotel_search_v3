import { describe, test, expect, beforeEach, jest } from "@jest/globals";

// Mock socket.io
jest.unstable_mockModule("socket.io", () => ({
  Server: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    engine: { use: jest.fn() },
    sockets: { sockets: new Map() },
  })),
}));

// Mock chatRateLimit
jest.unstable_mockModule("../middleware/chatRateLimit.js", () => ({
  checkChatRateLimit: jest.fn().mockReturnValue({ allowed: true }),
}));

describe("ChatManager", () => {
  let getChatManager;

  beforeEach(async () => {
    const mod = await import("../utils/websocket.js");
    getChatManager = mod.getChatManager;
  });

  test("getChatManager returns a ChatManager instance", () => {
    const manager = getChatManager();
    expect(manager).toBeDefined();
    expect(typeof manager.getRoomList).toBe("function");
    expect(typeof manager.getMessages).toBe("function");
    expect(typeof manager.createRoom).toBe("function");
  });

  test("default rooms exist (general, support)", () => {
    const manager = getChatManager();
    const rooms = manager.getRoomList();
    const ids = rooms.map((r) => r.id);
    expect(ids).toContain("general");
    expect(ids).toContain("support");
  });

  test("default rooms have correct properties", () => {
    const manager = getChatManager();
    const rooms = manager.getRoomList();
    const general = rooms.find((r) => r.id === "general");
    expect(general.name).toBe("General Chat");
    expect(general.type).toBe("group");
    expect(typeof general.createdAt).toBe("string");
  });

  test("createRoom adds a new room", () => {
    const manager = getChatManager();
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
    const manager = getChatManager();
    const room1 = manager.createRoom("dup-room", "First", "group");
    const room2 = manager.createRoom("dup-room", "Second", "group");
    expect(room1.id).toBe(room2.id);
    expect(room1.name).toBe("First");
  });

  test("getMessages returns empty array for room with no messages", () => {
    const manager = getChatManager();
    const messages = manager.getMessages("general", 10);
    expect(Array.isArray(messages)).toBe(true);
  });

  test("getDMRoomId generates consistent room id", () => {
    const manager = getChatManager();
    const id1 = manager.getDMRoomId("user-a", "user-b");
    const id2 = manager.getDMRoomId("user-b", "user-a");
    expect(id1).toBe(id2);
    expect(id1).toBe("user-a_user-b");
  });

  test("getOnlineUsers returns empty array when no connections", () => {
    const manager = getChatManager();
    const users = manager.getOnlineUsers();
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBe(0);
  });

  test("getConnectionStats returns expected structure", () => {
    const manager = getChatManager();
    const stats = manager.getConnectionStats();
    expect(stats).toHaveProperty("activeConnections");
    expect(stats).toHaveProperty("activeRooms");
    expect(stats).toHaveProperty("roomDetails");
    expect(stats).toHaveProperty("maxConnections");
    expect(stats).toHaveProperty("totalConnections");
    expect(typeof stats.activeConnections).toBe("number");
    expect(typeof stats.maxConnections).toBe("number");
  });

  test("getActiveRooms returns rooms sorted by member count", () => {
    const manager = getChatManager();
    const rooms = manager.getActiveRooms();
    expect(Array.isArray(rooms)).toBe(true);
    expect(rooms.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < rooms.length; i++) {
      expect(rooms[i - 1].memberCount).toBeGreaterThanOrEqual(rooms[i].memberCount);
    }
  });

  test("sendToUser emits both legacy and new notification events", () => {
    const manager = getChatManager();
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    manager.io = { to };
    manager.users = new Map([
      ["socket-1", { userId: "u-1", username: "user1", role: "user", joinedRooms: new Set() }],
    ]);

    manager.sendToUser("u-1", {
      type: "notification:new",
      notification: { id: "n1", title: "Hello" },
    });

    expect(to).toHaveBeenCalledWith("socket-1");
    expect(emit).toHaveBeenCalledWith("chat:notification", {
      type: "notification:new",
      notification: { id: "n1", title: "Hello" },
    });
    expect(emit).toHaveBeenCalledWith("notification:new", {
      type: "notification:new",
      notification: { id: "n1", title: "Hello" },
    });
  });

  test("sendToUser emits notification:status event", () => {
    const manager = getChatManager();
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    manager.io = { to };
    manager.users = new Map([
      ["socket-1", { userId: "u-1", username: "user1", role: "user", joinedRooms: new Set() }],
    ]);

    manager.sendToUser("u-1", {
      type: "notification:status",
      status: "acknowledged",
      notificationId: "n1",
    });

    expect(emit).toHaveBeenCalledWith("notification:status", {
      type: "notification:status",
      status: "acknowledged",
      notificationId: "n1",
    });
  });

  test("sendToOps emits to admin ops room", () => {
    const manager = getChatManager();
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    manager.io = { to };

    manager.sendToOps({ type: "notification:status", status: "dead_letter", notificationId: "n9" });

    expect(to).toHaveBeenCalledWith("ops:admin");
    expect(emit).toHaveBeenCalledWith("ops:notification:delivery", {
      type: "notification:status",
      status: "dead_letter",
      notificationId: "n9",
    });
  });

  test("toggleMessageReaction adds reaction for message", () => {
    const manager = getChatManager();
    manager.createRoom("reaction-room", "Reaction Room", "group");
    manager._saveMessage("reaction-room", {
      id: "msg-1",
      roomId: "reaction-room",
      from: { userId: 1, username: "alice", role: "user" },
      text: "hello",
      timestamp: new Date().toISOString(),
      type: "text",
    });

    const reaction = manager.toggleMessageReaction("reaction-room", "msg-1", 2, "bob", "👍");
    expect(reaction).toBeDefined();
    expect(reaction.action).toBe("added");
    expect(reaction.reactions["👍"]).toHaveLength(1);
    expect(reaction.reactions["👍"][0].username).toBe("bob");
  });

  test("toggleMessageReaction keeps a single active emoji per user", () => {
    const manager = getChatManager();
    manager.createRoom("reaction-room-single", "Reaction Room Single", "group");
    manager._saveMessage("reaction-room-single", {
      id: "msg-single-1",
      roomId: "reaction-room-single",
      from: { userId: 1, username: "alice", role: "user" },
      text: "hello",
      timestamp: new Date().toISOString(),
      type: "text",
    });

    const first = manager.toggleMessageReaction("reaction-room-single", "msg-single-1", 2, "bob", "👍");
    expect(first).toBeDefined();
    expect(first.reactions["👍"]).toHaveLength(1);

    const switched = manager.toggleMessageReaction("reaction-room-single", "msg-single-1", 2, "bob", "❤️");
    expect(switched).toBeDefined();
    expect(switched.reactions["👍"]).toBeUndefined();
    expect(switched.reactions["❤️"]).toHaveLength(1);
    expect(switched.reactions["❤️"][0].userId).toBe(2);
  });

  test("editMessage updates text for message author", () => {
    const manager = getChatManager();
    manager.createRoom("edit-room", "Edit Room", "group");
    manager._saveMessage("edit-room", {
      id: "msg-edit-1",
      roomId: "edit-room",
      from: { userId: 11, username: "alice", role: "user" },
      text: "old text",
      timestamp: new Date().toISOString(),
      type: "text",
    });

    const edited = manager.editMessage("edit-room", "msg-edit-1", 11, "new text");
    expect(edited).toBeDefined();
    expect(edited.text).toBe("new text");
    expect(edited.editedAt).toBeDefined();
  });

  test("deleteMessage marks message as deleted for author", () => {
    const manager = getChatManager();
    manager.createRoom("delete-room", "Delete Room", "group");
    manager._saveMessage("delete-room", {
      id: "msg-del-1",
      roomId: "delete-room",
      from: { userId: 21, username: "bob", role: "user" },
      text: "to delete",
      timestamp: new Date().toISOString(),
      type: "text",
    });

    const deleted = manager.deleteMessage("delete-room", "msg-del-1", 21, "user");
    expect(deleted).toBeDefined();
    expect(deleted.deleted).toBe(true);
    expect(deleted.text).toBe("[deleted]");
    expect(deleted.deletedAt).toBeDefined();
  });

  test("builds room presence from joined room memberships", () => {
    const manager = getChatManager();
    manager.createRoom("presence-room", "Presence Room", "group");
    manager.users.set("socket-a", {
      userId: "u-1",
      username: "alice",
      role: "user",
      joinedRooms: new Set(["presence-room"]),
    });
    manager.users.set("socket-b", {
      userId: "u-2",
      username: "bob",
      role: "admin",
      joinedRooms: new Set(["presence-room"]),
    });

    const presence = manager._buildRoomPresence("presence-room");
    expect(presence).toHaveLength(2);
    expect(presence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "u-1", username: "alice", role: "user" }),
        expect.objectContaining({ userId: "u-2", username: "bob", role: "admin" }),
      ])
    );
  });

  test("unread counts ignore deleted messages after last seen", () => {
    const manager = getChatManager();
    manager.createRoom("receipt-room", "Receipt Room", "group");
    const oldTs = new Date(Date.now() - 60_000).toISOString();
    manager.lastSeen.set("u-100:receipt-room", oldTs);

    manager._saveMessage("receipt-room", {
      id: "receipt-1",
      roomId: "receipt-room",
      from: { userId: 500, username: "sender", role: "user" },
      text: "visible",
      timestamp: new Date().toISOString(),
      type: "text",
    });
    manager._saveMessage("receipt-room", {
      id: "receipt-2",
      roomId: "receipt-room",
      from: { userId: 500, username: "sender", role: "user" },
      text: "deleted-msg",
      deleted: true,
      deletedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      type: "text",
    });

    const counts = manager._getUnreadCounts("u-100");
    expect(counts["receipt-room"]).toBe(1);
  });

  test("room summary produces stable structured output", () => {
    const manager = getChatManager();
    manager.createRoom("summary-room", "Summary Room", "group");
    manager._saveMessage("summary-room", {
      id: "summary-1",
      roomId: "summary-room",
      from: { userId: 1, username: "alice", role: "user" },
      text: "Need help with booking",
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      type: "text",
    });
    manager._saveMessage("summary-room", {
      id: "summary-2",
      roomId: "summary-room",
      from: { userId: 2, username: "bob", role: "admin" },
      text: "I can assist with that",
      timestamp: new Date().toISOString(),
      type: "text",
    });

    expect(typeof manager.generateRoomSummary).toBe("function");
    const summary = manager.generateRoomSummary("summary-room");
    expect(summary).toHaveProperty("roomId", "summary-room");
    expect(summary).toHaveProperty("messageCount");
    expect(summary).toHaveProperty("participants");
    expect(summary).toHaveProperty("latestMessage");
    expect(summary).toHaveProperty("summaryText");
    expect(summary.messageCount).toBeGreaterThanOrEqual(2);
  });

  test("handoff notes persist and can be retrieved", () => {
    const manager = getChatManager();
    manager.createRoom("handoff-room", "Handoff Room", "support");

    expect(typeof manager.saveHandoffNote).toBe("function");
    expect(typeof manager.getHandoffNotes).toBe("function");

    const saved = manager.saveHandoffNote("handoff-room", {
      authorId: 99,
      authorName: "admin",
      note: "User asked for escalation after midnight.",
    });

    expect(saved).toBeDefined();
    expect(saved.roomId).toBe("handoff-room");
    expect(saved.note).toContain("escalation");

    const notes = manager.getHandoffNotes("handoff-room");
    expect(Array.isArray(notes)).toBe(true);
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[notes.length - 1].note).toContain("escalation");
  });

  test("language preference persists per user", () => {
    const manager = getChatManager();
    expect(typeof manager.setUserLanguagePreference).toBe("function");
    expect(typeof manager.getUserLanguagePreference).toBe("function");

    const saved = manager.setUserLanguagePreference("u-lang-1", "vi");
    expect(saved).toBe("vi");
    expect(manager.getUserLanguagePreference("u-lang-1")).toBe("vi");
  });

  test("localized system message resolves by language preference", () => {
    const manager = getChatManager();
    manager.setUserLanguagePreference("u-lang-2", "vi");

    expect(typeof manager.buildLocalizedSystemMessage).toBe("function");
    const msg = manager.buildLocalizedSystemMessage("u-lang-2", "room_locked", {
      roomName: "Support",
    });

    expect(msg).toHaveProperty("key", "room_locked");
    expect(msg).toHaveProperty("language", "vi");
    expect(typeof msg.text).toBe("string");
    expect(msg.text.length).toBeGreaterThan(0);
  });

  test("language preference survives reconnect-style manager re-read", () => {
    const manager = getChatManager();
    manager.setUserLanguagePreference("u-lang-3", "en");
    const value = manager.getUserLanguagePreference("u-lang-3");
    expect(value).toBe("en");
  });
  test("reconnect replay returns only messages after last seen", () => {
    const manager = getChatManager();
    manager.createRoom("reconnect-room", "Reconnect Room", "group");

    const oldMsgTs = new Date(Date.now() - 120_000).toISOString();
    const newMsgTs = new Date(Date.now() - 10_000).toISOString();
    manager._saveMessage("reconnect-room", {
      id: "reconnect-1",
      roomId: "reconnect-room",
      from: { userId: 7, username: "author", role: "user" },
      text: "old",
      timestamp: oldMsgTs,
      type: "text",
    });
    manager._saveMessage("reconnect-room", {
      id: "reconnect-2",
      roomId: "reconnect-room",
      from: { userId: 7, username: "author", role: "user" },
      text: "new",
      timestamp: newMsgTs,
      type: "text",
    });

    expect(typeof manager.getMessagesSince).toBe("function");
    const replay = manager.getMessagesSince("reconnect-room", new Date(Date.now() - 60_000).toISOString());
    expect(Array.isArray(replay)).toBe(true);
    expect(replay).toHaveLength(1);
    expect(replay[0].id).toBe("reconnect-2");
  });
});
