/* Chat Widget — Floating real-time chat component with DM support */
(function () {
  "use strict";

  let socket = null;
  let currentRoom = null;
  let currentUser = null;
  let rooms = [];
  let onlineUsers = [];
  let unreadCounts = {};
  let typingTimeout = null;
  let panelOpen = false;

  function loadCSS() {
    if (document.querySelector('link[href="/chatWidget.css"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/chatWidget.css";
    document.head.appendChild(link);
  }

  function injectHTML() {
    if (document.getElementById("chatWidget")) return;
    var wrapper = document.createElement("div");
    wrapper.id = "chatWidget";
    wrapper.innerHTML =
      '<button class="chat-widget-trigger" id="chatTrigger" aria-label="Open chat">' +
        '<i class="fas fa-comments"></i>' +
        '<span class="badge" id="chatBadge" style="display:none">0</span>' +
      '</button>' +
      '<div class="chat-widget-panel" id="chatPanel">' +
        '<div id="chatRoomList">' +
          '<div class="chat-widget-header">' +
            '<h3><i class="fas fa-comments"></i> Chat</h3>' +
            '<button id="chatClose" aria-label="Close"><i class="fas fa-times"></i></button>' +
          '</div>' +
          '<div class="chat-widget-rooms" id="chatRooms"></div>' +
          '<div class="chat-online-section">' +
            '<div class="chat-online-header"><i class="fas fa-users"></i> Online</div>' +
            '<div class="chat-online-users" id="chatOnlineUsers"></div>' +
          '</div>' +
        '</div>' +
        '<div class="chat-messages-view" id="chatMessagesView">' +
          '<div class="chat-messages-header">' +
            '<button class="back-btn" id="chatBack" aria-label="Back"><i class="fas fa-arrow-left"></i></button>' +
            '<span class="room-title" id="chatRoomTitle">Room</span>' +
            '<span class="online-count" id="chatOnlineCount"></span>' +
          '</div>' +
          '<div class="chat-messages-list" id="chatMessagesList"></div>' +
          '<div class="chat-typing-indicator" id="chatTyping"></div>' +
          '<div class="chat-input-area">' +
            '<input type="text" id="chatInput" placeholder="Nhập tin nhắn..." maxlength="2000" autocomplete="off" />' +
            '<button id="chatSend"><i class="fas fa-paper-plane"></i></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrapper);
  }

  function connectSocket() {
    if (socket) return;
    socket = io({ path: "/socket.io", withCredentials: true });

    socket.on("connect", function () { console.log("[Chat] Connected"); });

    socket.on("chat:room:list", function (data) {
      rooms = data.rooms;
      renderRoomList();
    });

    socket.on("chat:room:history", function (data) {
      if (data.roomId === currentRoom) renderMessages(data.messages);
    });

    socket.on("chat:message:new", function (data) {
      var msg = data.message;
      if (msg.roomId === currentRoom && panelOpen) {
        appendMessage(msg);
        scrollMessagesToBottom();
      } else {
        // Increment unread
        unreadCounts[msg.roomId] = (unreadCounts[msg.roomId] || 0) + 1;
        updateBadge();
        renderRoomList();
        // Pulse animation on trigger button
        var trigger = document.getElementById("chatTrigger");
        if (trigger) {
          trigger.classList.add("pulse");
          setTimeout(function () { trigger.classList.remove("pulse"); }, 1000);
        }
        // Show toast notification
        if (window.Toasts && msg.from) {
          var roomName = "";
          var room = rooms.find(function (r) { return r.id === msg.roomId; });
          roomName = room ? room.name : msg.roomId;
          window.Toasts.info(msg.from.username + " (" + roomName + "): " + msg.text.substring(0, 60));
        }
      }
    });

    socket.on("chat:typing", function (data) {
      if (data.roomId === currentRoom) {
        var el = document.getElementById("chatTyping");
        if (el) el.textContent = data.isTyping ? data.username + " đang nhập..." : "";
      }
    });

    socket.on("chat:user:online", function (data) {
      // Add to online list if not already there
      var exists = onlineUsers.find(function (u) { return u.userId === data.userId; });
      if (!exists) {
        onlineUsers.push({ userId: data.userId, username: data.username, role: "user" });
        renderOnlineUsers();
      }
    });

    socket.on("chat:user:offline", function (data) {
      onlineUsers = onlineUsers.filter(function (u) { return u.userId !== data.userId; });
      renderOnlineUsers();
    });

    socket.on("chat:users:online", function (data) {
      onlineUsers = data.users || [];
      renderOnlineUsers();
      var el = document.getElementById("chatOnlineCount");
      if (el) el.textContent = onlineUsers.length + " online";
    });

    socket.on("chat:error", function (data) {
      console.error("[Chat] Error:", data.message);
      if (window.Toasts) window.Toasts.error(data.message);
    });

    socket.on("disconnect", function () { console.log("[Chat] Disconnected"); });
  }

  // --- Render room list ---
  function renderRoomList() {
    var container = document.getElementById("chatRooms");
    if (!container) return;
    container.innerHTML = rooms.map(function (room) {
      var unread = unreadCounts[room.id] || 0;
      var icon = room.type === "dm" ? "fa-user" : "fa-hashtag";
      return '<div class="chat-room-item" data-room="' + room.id + '">' +
        '<div class="room-icon"><i class="fas ' + icon + '"></i></div>' +
        '<div class="room-info">' +
          '<div class="room-name">' + escapeHTML(room.name) + '</div>' +
          '<div class="room-preview">' + (room.memberCount || 0) + ' thành viên</div>' +
        '</div>' +
        (unread > 0 ? '<span class="unread-badge">' + unread + '</span>' : "") +
      '</div>';
    }).join("");
    container.querySelectorAll(".chat-room-item").forEach(function (el) {
      el.addEventListener("click", function () { joinRoom(el.dataset.room); });
    });
  }

  // --- Render online users (for DM) ---
  function renderOnlineUsers() {
    var container = document.getElementById("chatOnlineUsers");
    if (!container) return;
    var filtered = onlineUsers.filter(function (u) {
      return currentUser && u.userId !== currentUser.id;
    });
    if (filtered.length === 0) {
      container.innerHTML = '<div class="no-users-online">Không có ai online</div>';
      return;
    }
    container.innerHTML = filtered.map(function (u) {
      return '<div class="chat-online-user" data-userid="' + u.userId + '" data-username="' + escapeHTML(u.username) + '">' +
        '<span class="online-dot"></span>' +
        '<span class="online-name">' + escapeHTML(u.username) + '</span>' +
        (u.role === "admin" ? '<span class="online-role">admin</span>' : "") +
        '<button class="dm-btn" title="Nhắn riêng"><i class="fas fa-paper-plane"></i></button>' +
      '</div>';
    }).join("");
    container.querySelectorAll(".dm-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var item = btn.closest(".chat-online-user");
        startDM(item.dataset.userid, item.dataset.username);
      });
    });
  }

  // --- Start DM with a user ---
  function startDM(targetUserId, targetUsername) {
    if (!socket || !currentUser) return;
    var roomId = [currentUser.id, targetUserId].sort().join("_");
    // Create DM room via REST
    fetch("/api/chat/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: roomId, name: targetUsername, type: "dm" }),
    }).then(function (res) {
      if (res.ok) {
        // Refresh room list then join
        socket.emit("chat:join", { roomId: roomId });
        // Add to local rooms if not exists
        var exists = rooms.find(function (r) { return r.id === roomId; });
        if (!exists) {
          rooms.push({ id: roomId, name: targetUsername, type: "dm", memberCount: 2 });
        }
        joinRoom(roomId);
      }
    }).catch(function () {});
  }

  function joinRoom(roomId) {
    if (currentRoom) socket.emit("chat:leave", { roomId: currentRoom });
    currentRoom = roomId;
    unreadCounts[roomId] = 0;
    updateBadge();
    socket.emit("chat:join", { roomId: roomId });
    document.getElementById("chatRoomList").style.display = "none";
    document.getElementById("chatMessagesView").classList.add("active");
    var room = rooms.find(function (r) { return r.id === roomId; });
    document.getElementById("chatRoomTitle").textContent = room ? room.name : roomId;
    document.getElementById("chatMessagesList").innerHTML = "";
    document.getElementById("chatInput").focus();
    renderRoomList();
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
    // Update page title with unread count
    if (total > 0) {
      document.title = "(" + total + ") " + document.title.replace(/^\(\d+\)\s*/, "");
    } else {
      document.title = document.title.replace(/^\(\d+\)\s*/, "");
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
      panelOpen = !panelOpen;
      panel.classList.toggle("open", panelOpen);
      if (panelOpen && !socket) connectSocket();
      // Clear unread when opening
      if (panelOpen && currentRoom) {
        unreadCounts[currentRoom] = 0;
        updateBadge();
      }
    });
    document.getElementById("chatClose").addEventListener("click", function () {
      panelOpen = false;
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
