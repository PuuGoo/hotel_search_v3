/* Admin Chat Dashboard */
(function () {
  "use strict";

  var socket = null;
  var currentRoom = null;
  var currentUser = null;
  var rooms = [];
  var typingTimeout = null;

  async function init() {
    try {
      var res = await fetch("/api/me");
      if (!res.ok) { window.location.href = "/"; return; }
      currentUser = await res.json();
      if (currentUser.role !== "admin") { window.location.href = "/dashboard"; return; }
    } catch { window.location.href = "/"; return; }
    connectSocket();
    bindEvents();
  }

  function connectSocket() {
    socket = io({ path: "/socket.io", withCredentials: true });
    socket.on("connect", function () { console.log("[AdminChat] Connected"); });
    socket.on("chat:room:list", function (data) { rooms = data.rooms; renderRoomList(); });
    socket.on("chat:room:history", function (data) {
      if (data.roomId === currentRoom) renderMessages(data.messages);
    });
    socket.on("chat:message:new", function (data) {
      if (data.message.roomId === currentRoom) {
        appendMessage(data.message);
        scrollMessagesToBottom();
      }
    });
    socket.on("chat:typing", function (data) {
      if (data.roomId === currentRoom) {
        var el = document.getElementById("adminTyping");
        if (el) el.textContent = data.isTyping ? data.username + " is typing..." : "";
      }
    });
    socket.on("chat:users:online", function (data) { renderOnlineUsers(data.users); });
    socket.on("chat:user:online", function (d) { console.log("[AdminChat] Online:", d.username); });
    socket.on("chat:user:offline", function (d) { console.log("[AdminChat] Offline:", d.username); });
    socket.on("chat:error", function (data) {
      if (window.Toasts) window.Toasts.error(data.message);
    });
  }

  function renderRoomList() {
    var container = document.getElementById("adminRoomList");
    container.innerHTML = rooms.map(function (room) {
      var icon = room.type === "dm" ? "fa-user" : "fa-hashtag";
      var active = currentRoom === room.id ? " active" : "";
      return '<div class="chat-room-item' + active + '" data-room="' + room.id + '">' +
        '<div class="room-icon"><i class="fas ' + icon + '"></i></div>' +
        '<div class="room-info">' +
          '<div class="room-name">' + escapeHTML(room.name) + '</div>' +
          '<div class="room-preview">' + (room.memberCount || 0) + ' members</div>' +
        '</div></div>';
    }).join("");
    container.querySelectorAll(".chat-room-item").forEach(function (el) {
      el.addEventListener("click", function () { joinRoom(el.dataset.room); });
    });
  }

  function joinRoom(roomId) {
    if (currentRoom) socket.emit("chat:leave", { roomId: currentRoom });
    currentRoom = roomId;
    socket.emit("chat:join", { roomId: roomId });
    document.getElementById("chatPlaceholder").style.display = "none";
    document.getElementById("adminChatView").style.display = "flex";
    var room = rooms.find(function (r) { return r.id === roomId; });
    document.getElementById("adminRoomTitle").textContent = room ? room.name : roomId;
    document.getElementById("adminMessagesList").innerHTML = "";
    document.getElementById("adminChatInput").focus();
    renderRoomList();
  }

  function renderMessages(messages) {
    var container = document.getElementById("adminMessagesList");
    container.innerHTML = "";
    messages.forEach(function (msg) { appendMessage(msg); });
    scrollMessagesToBottom();
  }

  function appendMessage(message) {
    var container = document.getElementById("adminMessagesList");
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
        (isOwn ? "" : '<div class="msg-author">' + escapeHTML(message.from && message.from.username || "Unknown") + ' <span class="role-badge">' + escapeHTML(message.from && message.from.role || "user") + '</span></div>') +
        '<div>' + escapeHTML(message.text) + '</div>' +
        '<div class="msg-time">' + time + '</div>';
    }
    container.appendChild(div);
  }

  function scrollMessagesToBottom() {
    var container = document.getElementById("adminMessagesList");
    if (container) requestAnimationFrame(function () { container.scrollTop = container.scrollHeight; });
  }

  function renderOnlineUsers(users) {
    var container = document.getElementById("adminOnlineList");
    container.innerHTML = users.map(function (u) {
      return '<div class="online-user"><span class="dot"></span><span>' + escapeHTML(u.username) + '</span><span class="role-badge">' + escapeHTML(u.role) + '</span></div>';
    }).join("");
    var countEl = document.getElementById("adminOnlineCount");
    if (countEl) countEl.textContent = users.length + " online";
  }

  function sendMessage() {
    var input = document.getElementById("adminChatInput");
    if (!input || !currentRoom || !socket) return;
    var text = input.value.trim();
    if (!text) return;
    socket.emit("chat:message", { roomId: currentRoom, text: text });
    input.value = "";
    socket.emit("chat:typing", { roomId: currentRoom, isTyping: false });
  }

  function escapeHTML(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function bindEvents() {
    document.getElementById("adminChatSend").addEventListener("click", sendMessage);
    document.getElementById("adminChatInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    document.getElementById("adminChatInput").addEventListener("input", function () {
      if (!currentRoom || !socket) return;
      socket.emit("chat:typing", { roomId: currentRoom, isTyping: true });
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(function () {
        socket.emit("chat:typing", { roomId: currentRoom, isTyping: false });
      }, 2000);
    });
    document.getElementById("createRoomBtn").addEventListener("click", function () {
      document.getElementById("createRoomModal").style.display = "flex";
    });
    document.getElementById("cancelCreateRoom").addEventListener("click", function () {
      document.getElementById("createRoomModal").style.display = "none";
    });
    document.getElementById("createRoomForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      var id = document.getElementById("newRoomId").value.trim();
      var name = document.getElementById("newRoomName").value.trim();
      if (!id || !name) return;
      try {
        var res = await fetch("/api/chat/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: id, name: name }),
        });
        if (res.ok) {
          document.getElementById("createRoomModal").style.display = "none";
          document.getElementById("newRoomId").value = "";
          document.getElementById("newRoomName").value = "";
          if (window.Toasts) window.Toasts.success("Room created");
        } else {
          var data = await res.json();
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
