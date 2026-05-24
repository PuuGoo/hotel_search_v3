/* Chat Widget — Floating real-time chat component */
(function () {
  "use strict";

  let socket = null;
  let currentRoom = null;
  let currentUser = null;
  let rooms = [];
  let unreadCounts = {};
  let typingTimeout = null;

  function loadCSS() {
    if (document.querySelector('link[href="/chatWidget.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/chatWidget.css";
    document.head.appendChild(link);
  }

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

  async function fetchCurrentUser() {
    try {
      const res = await fetch("/api/me");
      if (res.ok) currentUser = await res.json();
    } catch { /* not authenticated */ }
  }

  function connectSocket() {
    if (socket) return;
    socket = io({ path: "/socket.io", withCredentials: true });

    socket.on("connect", () => console.log("[Chat] Connected"));
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
      } else {
        unreadCounts[message.roomId] = (unreadCounts[message.roomId] || 0) + 1;
        updateBadge();
        renderRoomList();
      }
    });
    socket.on("chat:typing", ({ userId, username, roomId, isTyping }) => {
      if (roomId === currentRoom) {
        const el = document.getElementById("chatTyping");
        if (el) el.textContent = isTyping ? username + " is typing..." : "";
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
      if (el) el.textContent = users.length + " online";
    });
    socket.on("chat:error", ({ message }) => {
      console.error("[Chat] Error:", message);
      if (window.Toasts) window.Toasts.error(message);
    });
    socket.on("disconnect", () => console.log("[Chat] Disconnected"));
  }

  function renderRoomList() {
    const container = document.getElementById("chatRooms");
    if (!container) return;
    container.innerHTML = rooms.map(function (room) {
      var unread = unreadCounts[room.id] || 0;
      var icon = room.type === "dm" ? "fa-user" : "fa-hashtag";
      return '<div class="chat-room-item" data-room="' + room.id + '">' +
        '<div class="room-icon"><i class="fas ' + icon + '"></i></div>' +
        '<div class="room-info">' +
          '<div class="room-name">' + escapeHTML(room.name) + '</div>' +
          '<div class="room-preview">' + (room.memberCount || 0) + ' members</div>' +
        '</div>' +
        (unread > 0 ? '<span class="unread-badge">' + unread + '</span>' : "") +
      '</div>';
    }).join("");
    container.querySelectorAll(".chat-room-item").forEach(function (el) {
      el.addEventListener("click", function () { joinRoom(el.dataset.room); });
    });
  }

  function joinRoom(roomId) {
    if (currentRoom) socket.emit("chat:leave", { roomId: currentRoom });
    currentRoom = roomId;
    unreadCounts[roomId] = 0;
    updateBadge();
    socket.emit("chat:join", { roomId });
    document.getElementById("chatRoomList").style.display = "none";
    document.getElementById("chatMessagesView").classList.add("active");
    var room = rooms.find(function (r) { return r.id === roomId; });
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
    var container = document.getElementById("chatMessagesList");
    if (!container) return;
    container.innerHTML = "";
    messages.forEach(function (msg) { appendMessage(msg); });
    scrollMessagesToBottom();
  }

  function appendMessage(message) {
    var container = document.getElementById("chatMessagesList");
    if (!container) return;
    var isOwn = currentUser && message.from && message.from.userId === currentUser.id;
    var isSystem = message.type === "system";
    var time = new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    var div = document.createElement("div");
    if (isSystem) {
      div.className = "chat-message system";
      div.textContent = message.text;
    } else {
      div.className = "chat-message " + (isOwn ? "own" : "other");
      div.innerHTML =
        (isOwn ? "" : '<div class="msg-author">' + escapeHTML(message.from && message.from.username || "Unknown") + '</div>') +
        '<div>' + escapeHTML(message.text) + '</div>' +
        '<div class="msg-time">' + time + '</div>';
    }
    container.appendChild(div);
  }

  function scrollMessagesToBottom() {
    var container = document.getElementById("chatMessagesList");
    if (container) requestAnimationFrame(function () { container.scrollTop = container.scrollHeight; });
  }

  function sendMessage() {
    var input = document.getElementById("chatInput");
    if (!input || !currentRoom || !socket) return;
    var text = input.value.trim();
    if (!text) return;
    socket.emit("chat:message", { roomId: currentRoom, text: text });
    input.value = "";
    socket.emit("chat:typing", { roomId: currentRoom, isTyping: false });
  }

  function updateBadge() {
    var total = 0;
    for (var k in unreadCounts) total += unreadCounts[k];
    var badge = document.getElementById("chatBadge");
    if (badge) {
      badge.textContent = total;
      badge.style.display = total > 0 ? "" : "none";
    }
  }

  function escapeHTML(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function bindEvents() {
    document.getElementById("chatTrigger").addEventListener("click", function () {
      var panel = document.getElementById("chatPanel");
      panel.classList.toggle("open");
      if (panel.classList.contains("open") && !socket) connectSocket();
    });
    document.getElementById("chatClose").addEventListener("click", function () {
      document.getElementById("chatPanel").classList.remove("open");
    });
    document.getElementById("chatBack").addEventListener("click", goBackToRooms);
    document.getElementById("chatSend").addEventListener("click", sendMessage);
    document.getElementById("chatInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    document.getElementById("chatInput").addEventListener("input", function () {
      if (!currentRoom || !socket) return;
      socket.emit("chat:typing", { roomId: currentRoom, isTyping: true });
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(function () {
        socket.emit("chat:typing", { roomId: currentRoom, isTyping: false });
      }, 2000);
    });
  }

  async function init() {
    try {
      var res = await fetch("/api/me");
      if (!res.ok) return;
      currentUser = await res.json();
    } catch { return; }
    loadCSS();
    injectHTML();
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
