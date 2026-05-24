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
});
