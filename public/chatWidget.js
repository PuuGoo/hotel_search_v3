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
  let activeTab = "rooms"; // "rooms" or "online"
  let searchQuery = "";

  const EMOJIS = ["😀","😂","😍","🥰","😎","🤔","👍","👎","❤️","🔥","🎉","😢","😮","🙏","✨","💯","😅","🤣","😊","🥳","😴","🤯","👋","💪","🙌","🫶","🤝","💬","📱","💻","🏨","✈️"];

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
      // Trigger button
      '<button class="chat-widget-trigger" id="chatTrigger" aria-label="Open chat">' +
        '<i class="fas fa-comments"></i>' +
        '<span class="badge" id="chatBadge" style="display:none">0</span>' +
        '<span class="status-dot" id="chatStatusDot"></span>' +
      '</button>' +
      // Panel
      '<div class="chat-widget-panel" id="chatPanel">' +
        // Header
        '<div class="cw-header">' +
          '<div class="cw-avatar"><i class="fas fa-hotel"></i></div>' +
          '<div class="cw-title">' +
            '<h3>Imperial Chat</h3>' +
            '<div class="cw-subtitle">Hỗ trợ trực tuyến</div>' +
          '</div>' +
          '<div class="cw-actions">' +
            '<button id="chatMinimize" aria-label="Minimize"><i class="fas fa-minus"></i></button>' +
            '<button id="chatClose" aria-label="Close"><i class="fas fa-times"></i></button>' +
          '</div>' +
        '</div>' +
        // Tabs
        '<div class="cw-tabs">' +
          '<button class="cw-tab active" data-tab="rooms"><i class="fas fa-comments"></i> Phòng chat</button>' +
          '<button class="cw-tab" data-tab="online"><i class="fas fa-users"></i> Online <span class="tab-badge" id="onlineBadge" style="display:none">0</span></button>' +
        '</div>' +
        // Tab content
        '<div class="cw-tab-content">' +
          // Rooms tab
          '<div class="cw-tab-pane active" id="tabRooms">' +
            '<div class="cw-search-wrapper">' +
              '<i class="fas fa-search"></i>' +
              '<input type="text" class="cw-search-input" id="chatSearch" placeholder="Tìm phòng chat..." />' +
            '</div>' +
            '<div class="cw-rooms" id="chatRooms"></div>' +
            '<button class="cw-create-room-btn" id="chatCreateRoom"><i class="fas fa-plus"></i> Tạo phòng mới</button>' +
          '</div>' +
          // Online tab
          '<div class="cw-tab-pane" id="tabOnline">' +
            '<div class="cw-online-section" id="chatOnlineUsers"></div>' +
          '</div>' +
        '</div>' +
        // Messages view (hidden by default)
        '<div class="cw-messages-view" id="chatMessagesView">' +
          '<div class="cw-msg-header">' +
            '<button class="cw-back-btn" id="chatBack" aria-label="Quay lại"><i class="fas fa-arrow-left"></i></button>' +
            '<div class="cw-room-info">' +
              '<span class="cw-room-title" id="chatRoomTitle">Room</span>' +
              '<span class="cw-room-status"><span class="dot"></span> <span id="chatOnlineCount">0 online</span></span>' +
            '</div>' +
            '<div class="cw-header-actions">' +
              '<button id="chatRoomMembers" title="Thành viên"><i class="fas fa-users"></i></button>' +
            '</div>' +
          '</div>' +
          '<div class="cw-messages" id="chatMessagesList" style="position:relative"></div>' +
          '<div class="cw-new-messages" id="chatNewMsg"><i class="fas fa-arrow-down"></i> Tin nhắn mới</div>' +
          '<div class="cw-typing" id="chatTyping"></div>' +
          '<div class="cw-emoji-picker" id="chatEmojiPicker"></div>' +
          '<div class="cw-input-area">' +
            '<button class="cw-emoji-btn" id="chatEmojiBtn" aria-label="Emoji"><i class="far fa-smile"></i></button>' +
            '<input type="text" id="chatInput" placeholder="Nhập tin nhắn..." maxlength="2000" autocomplete="off" />' +
            '<button class="cw-send-btn" id="chatSend" aria-label="Send"><i class="fas fa-paper-plane"></i></button>' +
          '</div>' +
        '</div>' +
        // Connection status
        '<div class="cw-connection-status" id="chatConnectionStatus"></div>' +
      '</div>';
    document.body.appendChild(wrapper);

    // Build emoji picker
    var picker = document.getElementById("chatEmojiPicker");
    if (picker) {
      EMOJIS.forEach(function (emoji) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = emoji;
        btn.addEventListener("click", function () {
          var input = document.getElementById("chatInput");
          if (input) {
            input.value += emoji;
            input.focus();
          }
        });
        picker.appendChild(btn);
      });
    }
  }

  function connectSocket() {
    if (socket) return;

    var statusEl = document.getElementById("chatConnectionStatus");
    if (statusEl) {
      statusEl.className = "cw-connection-status connecting";
      statusEl.textContent = "Đang kết nối...";
    }

    socket = io({ path: "/socket.io", withCredentials: true });

    socket.on("connect", function () {
      console.log("[Chat] Connected");
      if (statusEl) statusEl.className = "cw-connection-status";
      var dot = document.getElementById("chatStatusDot");
      if (dot) dot.classList.remove("offline");
    });

    socket.on("chat:room:list", function (data) {
      rooms = data.rooms;
      // Update DM names with online users
      if (currentUser) {
        rooms.forEach(function (room) {
          if (room.type === "dm") {
            var parts = room.id.split("_");
            if (parts.length === 2) {
              var otherUserId = parts[0] === String(currentUser.id) ? parts[1] : parts[0];
              var otherUser = onlineUsers.find(function (u) { return String(u.userId) === String(otherUserId); });
              if (otherUser) {
                room.name = otherUser.username;
              }
            }
          }
        });
      }
      renderRoomList();
    });

    socket.on("chat:room:history", function (data) {
      if (data.roomId === currentRoom) renderMessages(data.messages);
      // Update room preview with last message
      if (data.messages && data.messages.length > 0) {
        var lastMsg = data.messages[data.messages.length - 1];
        var room = rooms.find(function (r) { return r.id === data.roomId; });
        if (room && lastMsg.from) {
          room.lastMessage = lastMsg.from.username + ": " + lastMsg.text.substring(0, 40);
        }
      }
    });

    socket.on("chat:message:new", function (data) {
      var msg = data.message;
      if (msg.roomId === currentRoom && panelOpen) {
        appendMessage(msg);
        if (isNearBottom()) {
          scrollMessagesToBottom();
        } else {
          var newMsgBtn = document.getElementById("chatNewMsg");
          if (newMsgBtn) newMsgBtn.classList.add("visible");
        }
      } else {
        unreadCounts[msg.roomId] = (unreadCounts[msg.roomId] || 0) + 1;
        updateBadge();
        // Update room preview
        var room = rooms.find(function (r) { return r.id === msg.roomId; });
        if (room) {
          room.lastMessage = msg.from ? msg.from.username + ": " + msg.text.substring(0, 40) : msg.text.substring(0, 50);
        }
        renderRoomList();
        // Pulse animation
        var trigger = document.getElementById("chatTrigger");
        if (trigger) {
          trigger.classList.add("pulse");
          setTimeout(function () { trigger.classList.remove("pulse"); }, 1800);
        }
        // Show notification toast
        if (msg.from) {
          var roomName = room ? room.name : msg.roomId;
          showChatToast(msg.from.username, msg.text, roomName, msg.roomId);
        }
      }
    });

    socket.on("chat:typing", function (data) {
      if (data.roomId === currentRoom) {
        var el = document.getElementById("chatTyping");
        if (el) {
          if (data.isTyping) {
            el.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div> ' + escapeHTML(data.username) + ' đang nhập...';
          } else {
            el.innerHTML = "";
          }
        }
      }
    });

    socket.on("chat:user:online", function (data) {
      var exists = onlineUsers.find(function (u) { return u.userId === data.userId; });
      if (!exists) {
        onlineUsers.push({ userId: data.userId, username: data.username, role: "user" });
        renderOnlineUsers();
        updateOnlineBadge();
        // Update DM room names with this user
        updateDMRoomNames();
      }
    });

    socket.on("chat:user:offline", function (data) {
      onlineUsers = onlineUsers.filter(function (u) { return u.userId !== data.userId; });
      renderOnlineUsers();
      updateOnlineBadge();
    });

    socket.on("chat:users:online", function (data) {
      onlineUsers = data.users || [];
      renderOnlineUsers();
      updateOnlineBadge();
      updateDMRoomNames();
      var el = document.getElementById("chatOnlineCount");
      if (el) el.textContent = onlineUsers.length + " online";
    });

    socket.on("chat:error", function (data) {
      console.error("[Chat] Error:", data.message);
      if (window.Toasts) window.Toasts.error(data.message);
    });

    socket.on("disconnect", function () {
      console.log("[Chat] Disconnected");
      var dot = document.getElementById("chatStatusDot");
      if (dot) dot.classList.add("offline");
      var statusEl = document.getElementById("chatConnectionStatus");
      if (statusEl) {
        statusEl.className = "cw-connection-status disconnected";
        statusEl.textContent = "Mất kết nối. Đang thử lại...";
      }
    });

    socket.on("reconnect", function () {
      var statusEl = document.getElementById("chatConnectionStatus");
      if (statusEl) statusEl.className = "cw-connection-status";
    });
  }

  // --- Tab switching ---
  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll(".cw-tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.tab === tab);
    });
    document.getElementById("tabRooms").classList.toggle("active", tab === "rooms");
    document.getElementById("tabOnline").classList.toggle("active", tab === "online");
  }

  // --- Render room list ---
  function renderRoomList() {
    var container = document.getElementById("chatRooms");
    if (!container) return;

    var filtered = rooms;
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      filtered = rooms.filter(function (r) {
        return r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
      });
    }

    if (filtered.length === 0) {
      container.innerHTML = '<div class="cw-empty"><i class="fas fa-comments"></i><p>' +
        (searchQuery ? 'Không tìm thấy phòng' : 'Chưa có phòng chat nào') + '</p></div>';
      return;
    }

    // Sort: unread first, then by name
    filtered.sort(function (a, b) {
      var ua = unreadCounts[a.id] || 0;
      var ub = unreadCounts[b.id] || 0;
      if (ua !== ub) return ub - ua;
      return a.name.localeCompare(b.name);
    });

    container.innerHTML = filtered.map(function (room) {
      var unread = unreadCounts[room.id] || 0;
      var isDM = room.type === "dm";
      var icon = isDM ? "fa-user" : "fa-hashtag";
      var iconClass = isDM ? "dm" : "group";
      var preview = room.lastMessage || (room.memberCount || 0) + ' thành viên';
      return '<div class="cw-room-item" data-room="' + room.id + '">' +
        '<div class="cw-room-icon ' + iconClass + '"><i class="fas ' + icon + '"></i></div>' +
        '<div class="cw-room-info">' +
          '<div class="cw-room-name">' + escapeHTML(room.name) + '</div>' +
          '<div class="cw-room-preview">' + escapeHTML(preview) + '</div>' +
        '</div>' +
        '<div class="cw-room-meta">' +
          (unread > 0 ? '<div class="cw-room-unread">' + unread + '</div>' : "") +
        '</div>' +
      '</div>';
    }).join("");

    container.querySelectorAll(".cw-room-item").forEach(function (el) {
      el.addEventListener("click", function () { joinRoom(el.dataset.room); });
    });
  }

  // --- Render online users ---
  function renderOnlineUsers() {
    var container = document.getElementById("chatOnlineUsers");
    if (!container) return;
    var filtered = onlineUsers.filter(function (u) {
      return currentUser && u.userId !== currentUser.id;
    });
    if (filtered.length === 0) {
      container.innerHTML = '<div class="cw-empty"><i class="fas fa-user-slash"></i><p>Không có ai online</p></div>';
      return;
    }
    container.innerHTML = filtered.map(function (u) {
      var roleTag = u.role === "admin" ? "Admin" : "";
      var colors = ["#d4a853","#6b8cae","#5b9a6f","#e07456","#9b85a6"];
      var color = colors[Math.abs(hashCode(u.userId)) % colors.length];
      var initial = (u.username || "?")[0].toUpperCase();
      return '<div class="cw-online-user" data-userid="' + u.userId + '" data-username="' + escapeHTML(u.username) + '">' +
        '<div class="cw-user-avatar" style="background:' + color + '">' + initial +
          '<span class="online-dot"></span>' +
        '</div>' +
        '<div class="cw-user-info">' +
          '<div class="cw-user-name">' + escapeHTML(u.username) + '</div>' +
          (roleTag ? '<div class="cw-user-role">' + roleTag + '</div>' : '') +
        '</div>' +
        '<button class="cw-dm-btn" title="Nhắn riêng"><i class="fas fa-paper-plane"></i></button>' +
      '</div>';
    }).join("");
    container.querySelectorAll(".cw-dm-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var item = btn.closest(".cw-online-user");
        startDM(item.dataset.userid, item.dataset.username);
      });
    });
  }

  function hashCode(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  // --- Chat notification toast (self-contained) ---
  function showChatToast(username, text, roomName, roomId) {
    var colors = ["#d4a853","#6b8cae","#5b9a6f","#e07456","#9b85a6"];
    var color = colors[Math.abs(hashCode(username)) % colors.length];
    var initial = (username || "?")[0].toUpperCase();

    var toast = document.createElement("div");
    toast.className = "cw-toast";
    toast.innerHTML =
      '<div class="cw-toast-avatar" style="background:' + color + '">' + initial + '</div>' +
      '<div class="cw-toast-body">' +
        '<div class="cw-toast-name">' + escapeHTML(username) + '</div>' +
        '<div class="cw-toast-text">' + escapeHTML(text.substring(0, 80)) + '</div>' +
        '<div class="cw-toast-room">' + escapeHTML(roomName) + '</div>' +
      '</div>';

    // Click to open the room
    toast.addEventListener("click", function () {
      if (roomId) {
        panelOpen = true;
        document.getElementById("chatPanel").classList.add("open");
        joinRoom(roomId);
      }
      toast.classList.add("cw-toast-out");
      setTimeout(function () { toast.remove(); }, 200);
    });

    document.body.appendChild(toast);

    // Auto dismiss after 5 seconds
    setTimeout(function () {
      if (toast.parentNode) {
        toast.classList.add("cw-toast-out");
        setTimeout(function () { toast.remove(); }, 200);
      }
    }, 5000);
  }

  // --- Update DM room names based on online users ---
  function updateDMRoomNames() {
    if (!currentUser) return;
    rooms.forEach(function (room) {
      if (room.type === "dm") {
        var parts = room.id.split("_");
        if (parts.length === 2) {
          var otherUserId = parts[0] === String(currentUser.id) ? parts[1] : parts[0];
          var otherUser = onlineUsers.find(function (u) { return String(u.userId) === String(otherUserId); });
          if (otherUser) {
            room.name = otherUser.username;
          }
        }
      }
    });
    renderRoomList();
  }

  // --- Start DM ---
  function startDM(targetUserId, targetUsername) {
    if (!socket || !currentUser) return;
    var roomId = [currentUser.id, targetUserId].sort().join("_");
    fetch("/api/chat/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: roomId, name: targetUsername, type: "dm" }),
    }).then(function (res) {
      if (res.ok) {
        socket.emit("chat:join", { roomId: roomId });
        var exists = rooms.find(function (r) { return r.id === roomId; });
        if (!exists) {
          rooms.push({ id: roomId, name: targetUsername, type: "dm", memberCount: 2 });
        }
        joinRoom(roomId);
        switchTab("rooms");
      }
    }).catch(function () {});
  }

  function joinRoom(roomId) {
    if (currentRoom) socket.emit("chat:leave", { roomId: currentRoom });
    currentRoom = roomId;
    unreadCounts[roomId] = 0;
    updateBadge();
    socket.emit("chat:join", { roomId: roomId });

    // Hide tabs + room list, show messages
    document.querySelector(".cw-tabs").style.display = "none";
    document.getElementById("tabRooms").style.display = "none";
    document.getElementById("tabOnline").style.display = "none";
    document.getElementById("chatMessagesView").classList.add("active");

    var room = rooms.find(function (r) { return r.id === roomId; });
    var displayName = room ? room.name : roomId;

    // For DM rooms, try to show the other person's name
    if (room && room.type === "dm") {
      var parts = roomId.split("_");
      if (parts.length === 2 && currentUser) {
        var otherUserId = parts[0] === String(currentUser.id) ? parts[1] : parts[0];
        var otherUser = onlineUsers.find(function (u) { return String(u.userId) === String(otherUserId); });
        if (otherUser) {
          displayName = otherUser.username;
        }
      }
    }

    document.getElementById("chatRoomTitle").textContent = displayName;
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
    document.querySelector(".cw-tabs").style.display = "";
    document.getElementById("tabRooms").style.display = "";
    document.getElementById("tabOnline").style.display = "";
    renderRoomList();
  }

  function renderMessages(messages) {
    var container = document.getElementById("chatMessagesList");
    if (!container) return;
    container.innerHTML = "";
    var lastDate = "";
    messages.forEach(function (msg) {
      // Date separator
      var msgDate = new Date(msg.timestamp).toLocaleDateString("vi-VN");
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        var sep = document.createElement("div");
        sep.className = "cw-date-sep";
        sep.innerHTML = "<span>" + msgDate + "</span>";
        container.appendChild(sep);
      }
      appendMessage(msg);
    });
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
      div.className = "cw-msg system";
      div.textContent = message.text;
    } else {
      div.className = "cw-msg " + (isOwn ? "own" : "other");
      var roleTag = "";
      if (message.from && message.from.role === "admin") {
        roleTag = '<span class="role-tag">Admin</span>';
      }
      div.innerHTML =
        (isOwn ? "" : '<div class="cw-msg-author">' + escapeHTML(message.from && message.from.username || "Unknown") + roleTag + '</div>') +
        '<div class="cw-msg-text">' + escapeHTML(message.text) + '</div>' +
        '<div class="cw-msg-time">' + time + '</div>';
    }
    container.appendChild(div);
  }

  function scrollMessagesToBottom() {
    var container = document.getElementById("chatMessagesList");
    if (container) requestAnimationFrame(function () { container.scrollTop = container.scrollHeight; });
    var newMsgBtn = document.getElementById("chatNewMsg");
    if (newMsgBtn) newMsgBtn.classList.remove("visible");
  }

  function isNearBottom() {
    var container = document.getElementById("chatMessagesList");
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight < 100;
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
    if (total > 0) {
      document.title = "(" + total + ") " + document.title.replace(/^\(\d+\)\s*/, "");
    } else {
      document.title = document.title.replace(/^\(\d+\)\s*/, "");
    }
  }

  function updateOnlineBadge() {
    var filtered = onlineUsers.filter(function (u) {
      return currentUser && u.userId !== currentUser.id;
    });
    var badge = document.getElementById("onlineBadge");
    if (badge) {
      badge.textContent = filtered.length;
      badge.style.display = filtered.length > 0 ? "" : "none";
    }
  }

  function escapeHTML(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function bindEvents() {
    // Trigger open/close
    document.getElementById("chatTrigger").addEventListener("click", function () {
      var panel = document.getElementById("chatPanel");
      panelOpen = !panelOpen;
      panel.classList.toggle("open", panelOpen);
      if (panelOpen && !socket) connectSocket();
      if (panelOpen && currentRoom) {
        unreadCounts[currentRoom] = 0;
        updateBadge();
      }
      if (panelOpen) {
        setTimeout(function () {
          var searchInput = document.getElementById("chatSearch");
          if (searchInput && !currentRoom) searchInput.focus();
        }, 350);
      }
    });

    document.getElementById("chatClose").addEventListener("click", function () {
      panelOpen = false;
      document.getElementById("chatPanel").classList.remove("open");
    });

    document.getElementById("chatMinimize").addEventListener("click", function () {
      panelOpen = false;
      document.getElementById("chatPanel").classList.remove("open");
    });

    // Tabs
    document.querySelectorAll(".cw-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        switchTab(tab.dataset.tab);
      });
    });

    // Back button
    document.getElementById("chatBack").addEventListener("click", goBackToRooms);

    // Send
    document.getElementById("chatSend").addEventListener("click", sendMessage);
    document.getElementById("chatInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    // Typing
    document.getElementById("chatInput").addEventListener("input", function () {
      if (!currentRoom || !socket) return;
      socket.emit("chat:typing", { roomId: currentRoom, isTyping: true });
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(function () {
        socket.emit("chat:typing", { roomId: currentRoom, isTyping: false });
      }, 2000);
    });

    // Emoji toggle
    document.getElementById("chatEmojiBtn").addEventListener("click", function () {
      var picker = document.getElementById("chatEmojiPicker");
      picker.classList.toggle("open");
    });

    // New messages button
    var newMsgBtn = document.getElementById("chatNewMsg");
    if (newMsgBtn) {
      newMsgBtn.addEventListener("click", function () {
        scrollMessagesToBottom();
      });
    }

    // Scroll detection for messages
    var msgList = document.getElementById("chatMessagesList");
    if (msgList) {
      msgList.addEventListener("scroll", function () {
        if (isNearBottom()) {
          var btn = document.getElementById("chatNewMsg");
          if (btn) btn.classList.remove("visible");
        }
      });
    }

    // Search rooms
    var searchInput = document.getElementById("chatSearch");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        searchQuery = searchInput.value.trim();
        renderRoomList();
      });
    }

    // Create room
    var createBtn = document.getElementById("chatCreateRoom");
    if (createBtn) {
      createBtn.addEventListener("click", function () {
        var roomName = prompt("Tên phòng chat mới:");
        if (!roomName || !roomName.trim()) return;
        var roomId = roomName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        if (!roomId) {
          if (window.Toasts) window.Toasts.error("Tên phòng không hợp lệ");
          return;
        }
        fetch("/api/chat/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: roomId, name: roomName.trim(), type: "group" }),
        }).then(function (res) {
          if (res.ok) {
            socket.emit("chat:join", { roomId: roomId });
            joinRoom(roomId);
            if (window.Toasts) window.Toasts.success("Đã tạo phòng: " + roomName.trim());
          } else {
            if (window.Toasts) window.Toasts.error("Không thể tạo phòng");
          }
        }).catch(function () {
          if (window.Toasts) window.Toasts.error("Lỗi kết nối");
        });
      });
    }
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
