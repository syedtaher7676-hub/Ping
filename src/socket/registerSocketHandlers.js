const { users, rooms, getUserBySocketId, getUserById, recordMatchmakingTime, getMetrics,
  pendingFriendRequests, timeExtensionRequests, addFriendship, areFriends, getFriends, getFriendRoom, getCanonicalPairId, friendRooms,
  appendFriendRoomMessage, getFriendRoomMessages, createFriendRequest, acceptFriendRequest, rejectFriendRequest,
  getPendingRequestsFor, getExistingRequest, removeFriendRequest,
} = require("../state/store");
const { createId } = require("../utils/ids");
const {
  START_CHAT_COOLDOWN_MS,
  MESSAGE_RATE_LIMIT_MS,
  MAX_MESSAGE_LENGTH,
  NEXT_BUTTON_COOLDOWN_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  METRICS_LOG_INTERVAL_MS,
  CHAT_DURATION_MS,
  MAX_MESSAGES_BURST,
  BURST_WINDOW_MS,
  DUPLICATE_THRESHOLD,
  DUPLICATE_WINDOW_MS,
  THROTTLE_PENALTY_MS,
} = require("../config");
const {
  enqueueForMatchmaking,
  attemptMatchmaking,
  leaveWaitingQueue,
} = require("../services/matchmaking");
const { terminateSession, handlePartnerDisconnect, extendSessionTime } = require("../services/sessionManager");
const {
  sendFriendRequest,
  respondToFriendRequest,
  getFriendsList
} = require("../services/friendService");
const { log } = require("../utils/logger");
const { userStore, reportStore, spamStore, slurFilter, securityStore, moderation } = require("../data");

function emitState(socket, user) {
  if (!socket || !user) return;
  socket.emit("state_update", {
    status: user.status,
    roomId: user.roomId,
    joinedAt: user.joinedAt,
  });
}

function queueUserForMatch(socket, io, userId) {
  const currentUser = users.get(userId);
  if (!currentUser) {
    socket.emit("queue_rejected", { reason: "user_not_found" });
    return { ok: false };
  }

  const result = enqueueForMatchmaking(userId);
  if (!result.ok) {
    socket.emit("queue_rejected", { reason: result.reason });
    emitState(socket, currentUser);
    return { ok: false };
  }

  socket.emit("queue_joined", { status: "waiting" });
  emitState(socket, currentUser);
  attemptMatchmaking(io);
  return { ok: true };
}

// Helper: deliver a message to a room (shared between stranger chat and friend DM)
function deliverMessage(io, socket, userId, roomId, finalMessage, replyToContext, throttleDelay, ack, msgId, isFlash) {
  const deliverFn = () => {
    const room = rooms.get(roomId);
    if (!room || room.status !== "active") {
      log("message_rejected", { userId, reason: "room_inactive" });
      if (typeof ack === "function" && throttleDelay === 0) {
        ack({ ok: false, reason: "room_inactive" });
      }
      return;
    }

    room.lastActivityAt = Date.now();
    if (room.endAt) {
      room.remainingMs = Math.max(0, room.endAt - room.lastActivityAt);
    }

    io.to(roomId).emit("new_message", {
      from: userId,
      message: finalMessage,
      replyTo: replyToContext,
      sentAt: Date.now(),
      roomId,
      msgId,
      isFlash
    });

    log("message_delivered", {
      userId, roomId,
      deliveredTo: room.users.length,
      messageLength: finalMessage.length,
      throttled: throttleDelay > 0,
    });
  };

  if (throttleDelay > 0) {
    setTimeout(deliverFn, throttleDelay);
    if (typeof ack === "function") {
      ack({ ok: true, roomId, sentAt: Date.now(), throttled: true });
    }
  } else {
    deliverFn();
    if (typeof ack === "function") {
      ack({ ok: true, roomId, sentAt: Date.now() });
    }
  }
}

// Shared message validation (slur filter, moderation, spam)
function validateAndModerateMessage(socket, userId, text) {
  // Slur filter - NEVER terminates session, only blocks message
  const slurResult = slurFilter.moderateSlurMessage(userId, text);

  if (!slurResult.allowed) {
    spamStore.addSpamViolation({
      userId, type: "slur_blocked", message: text.slice(0, 50),
      action: slurResult.action, isTargeting: slurResult.isTargeting,
      matchedWords: slurResult.matchedWords, violationCount: slurResult.violationCount,
    });
    securityStore.addSecurityLog("slur_blocked", {
      userId, message: text.slice(0, 100), action: slurResult.action,
      isTargeting: slurResult.isTargeting, matchedWords: slurResult.matchedWords,
      severity: slurResult.action === "mute" ? "high" : "medium",
    });
    log("message_rejected", {
      userId, reason: "slur_blocked", action: slurResult.action,
      isTargeting: slurResult.isTargeting, matchedWords: slurResult.matchedWords,
    });
    socket.emit("error_message", {
      message: slurResult.message, action: slurResult.action, duration: slurResult.duration || 0,
    });
    return { blocked: true, reason: "slur_blocked", action: slurResult.action };
  }

  // Flagged but allowed
  if (slurResult.hasSlur && slurResult.action === "flagged") {
    securityStore.addSecurityLog("slur_flagged", { userId, message: text.slice(0, 100), matchedWords: slurResult.matchedWords, severity: "low" });
    log("message_flagged", { userId, reason: "slur_flagged", matchedWords: slurResult.matchedWords });
    socket.emit("warning_message", { message: "⚠️ please keep it appropriate 🙏", type: "slur_flag" });
  }

  // Moderation (gender/age questions) - NEVER terminates session
  const moderationResult = moderation.moderateMessage(userId, text);

  if (!moderationResult.allowed) {
    spamStore.addSpamViolation({ userId, type: "moderation_blocked", message: text.slice(0, 50), action: moderationResult.action, violationCount: moderationResult.violationCount });
    securityStore.addSecurityLog("moderation_blocked", { userId, message: text.slice(0, 100), action: moderationResult.action, violationCount: moderationResult.violationCount, severity: moderationResult.action === "mute" ? "high" : "medium" });
    log("message_moderated", { userId, action: moderationResult.action, violationCount: moderationResult.violationCount, reason: "low_quality_question" });
    slurFilter.applyPenalty(userId, moderationResult.action, moderationResult.duration);
    socket.emit("error_message", { message: moderationResult.message, action: moderationResult.action, duration: moderationResult.duration });
    return { blocked: true, reason: "moderation_blocked", action: moderationResult.action };
  }

  let finalMessage = text;
  if (moderationResult.action === "replaced") {
    finalMessage = moderationResult.replacement;
    securityStore.addSecurityLog("moderation_replaced", { userId, originalMessage: text.slice(0, 50), replacement: finalMessage, violationCount: moderationResult.violationCount, severity: "low" });
    log("message_replaced", { userId, original: text.slice(0, 30), replacement: finalMessage, violationCount: moderationResult.violationCount });
  }

  return { blocked: false, finalMessage };
}

function notifyFriendsOfStatusChange(io, userId, online) {
  const friendIds = getFriends(userId);
  friendIds.forEach(fId => {
    const friendUser = users.get(fId);
    if (friendUser?.socketId) {
      io.to(friendUser.socketId).emit("friend_status_change", {
        friendId: userId,
        online
      });
    }
  });
}

function registerSocketHandlers(io, getCountryFromSocket) {
  // Periodic metrics broadcast
  setInterval(() => {
    const metrics = getMetrics();
    log("system_metrics", metrics);
    io.emit("system_metrics", metrics);
  }, METRICS_LOG_INTERVAL_MS);

  // Cleanup inactive users
  setInterval(() => {
    const now = Date.now();
    for (const [userId, user] of users.entries()) {
      if (!user.isActive && now - (user.lastDisconnect || user.lastHeartbeat) > HEARTBEAT_TIMEOUT_MS) {
        log("user_inactive_timeout", { userId });
        users.delete(userId);
      }
    }
  }, HEARTBEAT_INTERVAL_MS * 2);

  io.engine.on("connection_error", (error) => {
    log("socket_connection_error", { code: error.code, message: error.message, context: error.context });
  });

  io.on("connection", (socket) => {
    const clientUserId = socket.handshake.auth?.userId;
    let userId = clientUserId && users.has(clientUserId) ? clientUserId : createId();
    let isNewUser = !users.has(userId);

    let user = users.get(userId);
    if (!user) {
      user = {
        id: userId,
        socketId: socket.id,
        status: "idle",
        roomId: null,
        joinedAt: Date.now(),
        lastStartChatAt: 0,
        lastMessageAt: 0,
        lastActionAt: 0,
        country: getCountryFromSocket ? getCountryFromSocket(socket) : "Unknown",
        lastHeartbeat: Date.now(),
        isActive: true,
      };
    } else {
      // Reconnecting user - update socket
      user.socketId = socket.id;
      user.isActive = true;
      user.lastHeartbeat = Date.now();

      // If they were in a room, rejoin the socket.io room
      if (user.roomId) {
        const room = rooms.get(user.roomId);
        if (room && room.status === "active") {
          socket.join(user.roomId);
          // Clear any pending disconnect timeout
          if (room.disconnectTimeoutRef) {
            clearTimeout(room.disconnectTimeoutRef);
            room.disconnectTimeoutRef = null;
          }
          // Notify partner that this user reconnected
          room.users.forEach(uid => {
            if (uid !== userId) {
              const partnerUser = users.get(uid);
              if (partnerUser?.socketId) {
                const partnerSocket = io.sockets.sockets.get(partnerUser.socketId);
                partnerSocket?.emit("partner_reconnected", { roomId: user.roomId });
              }
            }
          });
        }
      }
    }

    users.set(userId, user);

    socket.emit("self", { userId, country: user.country, isNewUser });
    emitState(socket, user);

    log(isNewUser ? "user_connected" : "user_reconnected", {
      userId, socketId: socket.id, activeUsers: users.size,
    });

    // Heartbeat mechanism
    const heartbeatInterval = setInterval(() => {
      const currentUser = users.get(userId);
      if (!currentUser) {
        clearInterval(heartbeatInterval);
        return;
      }

      const timeSinceHeartbeat = Date.now() - (currentUser.lastHeartbeat || 0);
      if (timeSinceHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        log("user_heartbeat_timeout", { userId, timeSinceHeartbeat });
        if (currentUser.status === "matched" && currentUser.roomId) {
          const room = rooms.get(currentUser.roomId);
          // Only terminate stranger rooms, not friend DMs
          if (room && room.type !== "friend_dm") {
            terminateSession(io, currentUser.roomId, "heartbeat_timeout");
          }
        } else if (currentUser.status === "waiting") {
          leaveWaitingQueue(userId);
        }
        users.delete(userId);
        clearInterval(heartbeatInterval);
        socket.disconnect(true);
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Notify friends that user is online
    notifyFriendsOfStatusChange(io, userId, true);

    socket.on("heartbeat", () => {
      const currentUser = users.get(userId);
      if (currentUser) {
        currentUser.lastHeartbeat = Date.now();
        currentUser.isActive = true;
      }
    });

    // ═══════════════════════════════════════════════
    //  MATCHMAKING
    // ═══════════════════════════════════════════════

    socket.on("start_chat", () => {
      const currentUser = users.get(userId);
      if (!currentUser) return;

      const now = Date.now();
      if (now - currentUser.lastStartChatAt < START_CHAT_COOLDOWN_MS) {
        socket.emit("queue_rejected", { reason: "start_chat_rate_limited", retryAfter: START_CHAT_COOLDOWN_MS - (now - currentUser.lastStartChatAt) });
        emitState(socket, currentUser);
        return;
      }
      if (now - currentUser.lastActionAt < NEXT_BUTTON_COOLDOWN_MS) {
        socket.emit("queue_rejected", { reason: "action_rate_limited" });
        return;
      }

      currentUser.lastStartChatAt = now;
      currentUser.lastActionAt = now;
      queueUserForMatch(socket, io, userId);
    });

    // ═══════════════════════════════════════════════
    //  SEND MESSAGE (stranger chat)
    // ═══════════════════════════════════════════════

    socket.on("send_message", (payload, ack) => {
      const currentUser = users.get(userId);
      if (!currentUser || currentUser.status !== "matched" || !currentUser.roomId) {
        socket.emit("error_message", { message: "💀 you're not in a chat rn. hit find someone first!" });
        if (typeof ack === "function") ack({ ok: false, reason: "not_in_active_session" });
        return;
      }

      const now = Date.now();
      const text = String(payload?.message || "").trim();
      const replyToContext = payload?.replyTo || null;
      const msgId = payload?.msgId;
      const isFlash = Boolean(payload?.isFlash);

      if (!text) {
        if (typeof ack === "function") ack({ ok: false, reason: "empty_message" });
        return;
      }

      if (text.length > MAX_MESSAGE_LENGTH) {
        socket.emit("error_message", { message: `✂️ message too long! keep it under ${MAX_MESSAGE_LENGTH} chars bestie` });
        if (typeof ack === "function") ack({ ok: false, reason: "message_too_long" });
        return;
      }

      // Run moderation (never terminates session)
      const modResult = validateAndModerateMessage(socket, userId, text);
      if (modResult.blocked) {
        if (typeof ack === "function") ack({ ok: false, reason: modResult.reason, action: modResult.action });
        return;
      }

      const finalMessage = modResult.finalMessage;

      // Rate limiting
      if (!currentUser.messageHistory) currentUser.messageHistory = [];
      currentUser.messageHistory.push({ text, timestamp: now });
      currentUser.messageHistory = currentUser.messageHistory.filter(m => now - m.timestamp < BURST_WINDOW_MS);

      const recentCount = currentUser.messageHistory.length;
      let throttleDelay = 0;
      if (recentCount > MAX_MESSAGES_BURST) {
        log("message_throttled", { userId, recentCount, reason: "burst_exceeded" });
        throttleDelay = THROTTLE_PENALTY_MS;
      }

      // Duplicate detection - relaxed for very short messages (emojis/reactions)
      const identicalMessages = currentUser.messageHistory.filter(m => m.text === text && (now - m.timestamp < DUPLICATE_WINDOW_MS));
      const isShort = text.length < 5;
      const threshold = isShort ? (DUPLICATE_THRESHOLD + 2) : DUPLICATE_THRESHOLD;

      if (identicalMessages.length > threshold) {
        spamStore.addSpamViolation({ userId, type: "rapid_duplicates", message: text.slice(0, 50), count: identicalMessages.length });
        socket.emit("error_message", { message: "🔁 chill! you're sending the same thing too many times 💀" });
        if (typeof ack === "function") ack({ ok: false, reason: "rapid_duplicates" });
        return;
      }

      deliverMessage(io, socket, userId, currentUser.roomId, finalMessage, replyToContext, throttleDelay, ack, msgId, isFlash);
    });

    // ═══════════════════════════════════════════════
    //  SEND DM (friend chat)
    // ═══════════════════════════════════════════════

    socket.on("send_dm", (payload, ack) => {
      const currentUser = users.get(userId);
      const dmRoomId = payload?.roomId;
      if (!currentUser || !dmRoomId) {
        if (typeof ack === "function") ack({ ok: false, reason: "invalid" });
        return;
      }

      const room = rooms.get(dmRoomId);
      if (!room || room.type !== "friend_dm" || !room.users.includes(userId)) {
        socket.emit("error_message", { message: "This DM room doesn't exist or you don't have access." });
        if (typeof ack === "function") ack({ ok: false, reason: "invalid_room" });
        return;
      }

      const text = String(payload?.message || "").trim();
      const replyToContext = payload?.replyTo || null;
      const msgId = payload?.msgId;
      const isFlash = Boolean(payload?.isFlash);

      if (!text) {
        if (typeof ack === "function") ack({ ok: false, reason: "empty_message" });
        return;
      }
      if (text.length > MAX_MESSAGE_LENGTH) {
        socket.emit("error_message", { message: `✂️ message too long! keep it under ${MAX_MESSAGE_LENGTH} chars bestie` });
        if (typeof ack === "function") ack({ ok: false, reason: "message_too_long" });
        return;
      }

      // Run moderation (same as stranger — never disconnects)
      const modResult = validateAndModerateMessage(socket, userId, text);
      if (modResult.blocked) {
        if (typeof ack === "function") ack({ ok: false, reason: modResult.reason, action: modResult.action });
        return;
      }

      // Update room activity
      room.lastActivityAt = Date.now();
      const sentAt = Date.now();
      const partnerId = room.users.find((id) => id !== userId);

      // Persist DM history for this friend room.
      appendFriendRoomMessage(userId, partnerId, {
        from: userId,
        message: modResult.finalMessage,
        replyTo: replyToContext,
        sentAt,
        msgId,
        isFlash
      });

      io.to(dmRoomId).emit("dm_message", {
        from: userId,
        message: modResult.finalMessage,
        replyTo: replyToContext,
        sentAt,
        roomId: dmRoomId,
        msgId,
        isFlash
      });

      if (typeof ack === "function") {
        ack({ ok: true, roomId: dmRoomId, sentAt });
      }
    });

    socket.on("send_ping", ({ roomId }) => {
      const room = rooms.get(roomId) || Array.from(friendRooms.values()).find(r => r.roomId === roomId);
      if (!room) return;

      const members = room.users || room.userIds || [];
      if (members.includes(userId)) {
        socket.to(roomId).emit("incoming_ping");
      }
    });

    socket.on("edit_dm", ({ roomId, msgId, newMessage }, ack) => {
      let targetRoom = null;
      for (const r of friendRooms.values()) {
        if (r.roomId === roomId && r.userIds.includes(userId)) {
          targetRoom = r;
          break;
        }
      }

      if (!targetRoom) return;

      const msg = targetRoom.messages.find(m => m.msgId === msgId && m.from === userId);
      if (msg) {
        msg.message = newMessage;
        msg.isEdited = true;
        io.to(roomId).emit("dm_edited", { msgId, newMessage, roomId });
        if (typeof ack === "function") ack({ ok: true });
      }
    });

    socket.on("delete_dm", ({ roomId, msgId }, ack) => {
      let targetRoom = null;
      for (const r of friendRooms.values()) {
        if (r.roomId === roomId && r.userIds.includes(userId)) {
          targetRoom = r;
          break;
        }
      }

      if (!targetRoom) return;

      const idx = targetRoom.messages.findIndex(m => m.msgId === msgId && m.from === userId);
      if (idx !== -1) {
        targetRoom.messages.splice(idx, 1);
        io.to(roomId).emit("dm_deleted", { msgId, roomId });
        if (typeof ack === "function") ack({ ok: true });
      }
    });

    socket.on("edit_message", ({ roomId, msgId, newMessage }) => {
      const room = rooms.get(roomId);
      if (room && room.users.includes(userId)) {
        io.to(roomId).emit("message_edited", { msgId, newMessage, roomId });
      }
    });

    socket.on("delete_message", ({ roomId, msgId }) => {
      const room = rooms.get(roomId);
      if (room && room.users.includes(userId)) {
        io.to(roomId).emit("message_deleted", { msgId, roomId });
      }
    });

    socket.on("mark_read", ({ roomId }) => {
      const currentUser = users.get(userId);
      if (!currentUser) return;
      const room = rooms.get(roomId);
      if (!room || room.status !== "active") return;
      if (!room.users.includes(userId)) return;
      socket.to(roomId).emit("message_seen", { roomId });
    });

    // ═══════════════════════════════════════════════
    //  TIME EXTENSION
    // ═══════════════════════════════════════════════

    socket.on("request_time_extension", () => {
      const currentUser = users.get(userId);
      if (!currentUser || currentUser.status !== "matched" || !currentUser.roomId) return;

      const roomId = currentUser.roomId;
      const room = rooms.get(roomId);
      if (!room || room.status !== "active" || room.type === "friend_dm") return;

      // Check if an extension was already requested for this room
      const existing = timeExtensionRequests.get(roomId);
      if (existing && existing.requestedBy === userId) {
        socket.emit("error_message", { message: "⏳ you already requested more time. waiting for partner!" });
        return;
      }

      if (existing && existing.requestedBy !== userId) {
        // Both users agreed! Extend the time
        timeExtensionRequests.delete(roomId);
        extendSessionTime(io, roomId);
        return;
      }

      // First request — store and notify partner
      timeExtensionRequests.set(roomId, { requestedBy: userId, createdAt: Date.now() });

      // Notify partner
      room.users.forEach(uid => {
        if (uid !== userId) {
          const partnerUser = users.get(uid);
          if (partnerUser?.socketId) {
            const partnerSocket = io.sockets.sockets.get(partnerUser.socketId);
            partnerSocket?.emit("time_extension_offer", { roomId, fromUserId: userId });
          }
        }
      });

      socket.emit("time_extension_pending", { roomId });
      log("time_extension_requested", { roomId, userId });
    });

    socket.on("time_extension_response", ({ accept }) => {
      const currentUser = users.get(userId);
      if (!currentUser || !currentUser.roomId) return;

      const roomId = currentUser.roomId;
      const existing = timeExtensionRequests.get(roomId);
      if (!existing) return;

      if (accept) {
        timeExtensionRequests.delete(roomId);
        extendSessionTime(io, roomId);
      } else {
        timeExtensionRequests.delete(roomId);
        // Notify requester that extension was declined
        const requesterUser = users.get(existing.requestedBy);
        if (requesterUser?.socketId) {
          const requesterSocket = io.sockets.sockets.get(requesterUser.socketId);
          requesterSocket?.emit("time_extension_declined", { roomId });
        }
      }
    });

    // ═══════════════════════════════════════════════
    //  FRIEND SYSTEM
    // ═══════════════════════════════════════════════

    socket.on("send_friend_request", () => {
      const currentUser = users.get(userId);
      if (!currentUser || currentUser.status !== "matched" || !currentUser.roomId) {
        socket.emit("error_message", { message: "You need to be in a chat to add a friend! ⚡" });
        return;
      }

      const room = rooms.get(currentUser.roomId);
      if (!room || room.status !== "active") return;

      const partnerId = room.users.find(id => id !== userId);
      if (!partnerId) return;

      const result = sendFriendRequest(userId, partnerId, currentUser.roomId);
      if (!result.ok) {
        let msg = "Could not send request.";
        if (result.reason === "already_friends") msg = "You're already friends! 🫂";
        if (result.reason === "already_pending") msg = "Friend request already pending ⏳";
        if (result.reason === "self_request") msg = "You can't friend yourself! 😅";
        socket.emit("error_message", { message: msg });
        return;
      }

      // Notify recipient
      const partnerUser = users.get(partnerId);
      if (partnerUser?.socketId) {
        io.to(partnerUser.socketId).emit("friend_request_received", {
          requestId: result.requestId,
          fromUserId: userId,
          fromCountry: currentUser.country || "Unknown",
        });
      }

      // Notify sender
      socket.emit("friend_request_sent", {
        requestId: result.requestId,
        toUserId: partnerId
      });
    });

    socket.on("friend_request_response", ({ requestId, accept }) => {
      const result = respondToFriendRequest(requestId, userId, accept, io);
      if (!result.ok) {
        socket.emit("error_message", { message: "Request expired or invalid." });
        return;
      }

      if (accept && result.accepted) {
        const fromUserId = result.fromUserId;
        const dmRoomId = result.roomId;

        // Join both users to the stable DM room
        const userA = users.get(fromUserId);
        const userB = users.get(userId);

        if (userA?.socketId) {
          const sA = io.sockets.sockets.get(userA.socketId);
          sA?.join(dmRoomId);
          sA?.emit("friend_request_accepted", {
            friendId: userId,
            friendCountry: userB?.country || "Unknown",
            dmRoomId
          });
        }

        socket.join(dmRoomId);
        socket.emit("friend_request_accepted", {
          friendId: fromUserId,
          friendCountry: userA?.country || "Unknown",
          dmRoomId
        });
      } else if (!accept) {
        // Notify requester it was declined
        const requester = users.get(result.fromUserId);
        if (requester?.socketId) {
          io.to(requester.socketId).emit("friend_request_declined", { fromUserId: userId });
        }
      }
    });

    socket.on("get_friends", (ack) => {
      const friends = getFriendsList(userId);
      if (typeof ack === "function") ack({ friends });
      else socket.emit("friends_list", { friends });
    });

    socket.on("open_friend_dm", ({ friendId }) => {
      if (!areFriends(userId, friendId)) {
        socket.emit("error_message", { message: "You are not friends yet! 🫂" });
        return;
      }

      const friendRoom = getFriendRoom(userId, friendId);
      if (!friendRoom) {
        socket.emit("error_message", { message: "Chat room not found." });
        return;
      }

      // Join the socket.io room
      socket.join(friendRoom.roomId);

      // Update user state to track current room (crucial for reporting/status)
      const currentUser = users.get(userId);
      if (currentUser) {
        currentUser.roomId = friendRoom.roomId;
        currentUser.status = "matched"; // Mark as matched so report/end-chat works
      }

      const friendUser = users.get(friendId);
      socket.emit("friend_dm_opened", {
        roomId: friendRoom.roomId,
        friendId,
        friendCountry: friendUser?.country || "Unknown",
        friendOnline: friendUser?.isActive || false,
        messages: getFriendRoomMessages(userId, friendId),
      });
    });

    socket.on("get_pending_requests", (payload, ack) => {
      try {
        const pendingRequests = getPendingRequestsFor(userId);
        const requestsList = pendingRequests.map(req => {
          const senderUser = users.get(req.fromUserId);
          return {
            requestId: req.id,
            fromUserId: req.fromUserId,
            fromCountry: senderUser?.country || "Unknown",
            createdAt: req.createdAt,
          };
        }).sort((a, b) => b.createdAt - a.createdAt);

        if (typeof ack === "function") {
          ack({ requests: requestsList });
        } else {
          socket.emit("pending_requests_list", { requests: requestsList });
        }
      } catch (err) {
        log("get_pending_requests_error", { userId, error: err.message });
        if (typeof ack === "function") {
          ack({ ok: false, reason: "error", requests: [] });
        }
      }
    });

    // DM typing
    socket.on("dm_typing", ({ roomId, isTyping }) => {
      const room = rooms.get(roomId);
      if (!room || room.type !== "friend_dm" || !room.users.includes(userId)) return;
      socket.to(roomId).emit("dm_partner_typing", { roomId, isTyping, fromUserId: userId });
    });

    // ═══════════════════════════════════════════════
    //  NAVIGATION
    // ═══════════════════════════════════════════════

    socket.on("next_chat", (payload = {}) => {
      const autoStart = Boolean(payload.autoStart);
      const currentUser = users.get(userId);
      if (!currentUser) return;

      const now = Date.now();
      if (now - currentUser.lastActionAt < NEXT_BUTTON_COOLDOWN_MS) {
        socket.emit("error_message", { message: "⏳ slow down! wait a sec before your next move ✌️" });
        return;
      }

      currentUser.lastActionAt = now;

      if (currentUser.status === "matched" && currentUser.roomId) {
        terminateSession(io, currentUser.roomId, "next_clicked");
        if (autoStart) queueUserForMatch(socket, io, userId);
      } else if (currentUser.status === "waiting") {
        leaveWaitingQueue(userId);
        if (autoStart) {
          queueUserForMatch(socket, io, userId);
        } else {
          socket.emit("chat_end", { reason: "left_queue" });
          emitState(socket, currentUser);
        }
      } else {
        if (autoStart) {
          queueUserForMatch(socket, io, userId);
        } else {
          socket.emit("queue_rejected", { reason: "not_in_queue_or_chat" });
          emitState(socket, currentUser);
        }
      }
    });

    socket.on("cancel_search", () => {
      const currentUser = users.get(userId);
      if (!currentUser) return;
      if (currentUser.status === "waiting") {
        leaveWaitingQueue(userId);
        socket.emit("chat_end", { reason: "left_queue" });
      }
      emitState(socket, currentUser);
    });

    // ═══════════════════════════════════════════════
    //  STATE & METRICS
    // ═══════════════════════════════════════════════

    socket.on("get_status", (payload, ack) => {
      const currentUser = users.get(userId);
      if (typeof ack === "function") {
        ack({
          status: currentUser?.status || "idle",
          roomId: currentUser?.roomId || null,
          joinedAt: currentUser?.joinedAt || null,
        });
      }
      if (currentUser) {
        socket.emit("state_update", {
          status: currentUser.status,
          roomId: currentUser.roomId,
          joinedAt: currentUser.joinedAt,
        });
      }
    });

    socket.on("get_metrics", (payload, ack) => {
      if (typeof ack === "function") ack(getMetrics());
    });

    socket.on("get_stats", (payload, ack) => {
      const currentUser = users.get(userId);
      const metrics = getMetrics();
      const statsPayload = {
        status: currentUser?.status || "idle",
        roomId: currentUser?.roomId || null,
        activeUsers: metrics?.activeUsers || 0,
        totalMatches: metrics?.totalMatches || 0,
        totalChats: metrics?.totalMatches || 0,
      };
      // Support both callback and event patterns
      if (typeof ack === "function") {
        ack(statsPayload);
      }
      socket.emit("stats", statsPayload);
    });

    // ═══════════════════════════════════════════════
    //  TYPING
    // ═══════════════════════════════════════════════

    socket.on("typing", (payload) => {
      const currentUser = users.get(userId);
      if (!currentUser || !currentUser.roomId) return;

      const room = rooms.get(currentUser.roomId);
      if (!room) return;

      room.users.forEach((partnerId) => {
        if (partnerId !== userId) {
          const partnerSocket = io.sockets.sockets.get(users.get(partnerId)?.socketId);
          if (partnerSocket) {
            partnerSocket.emit("partner_typing", { isTyping: payload.isTyping });
          }
        }
      });
    });

    // ═══════════════════════════════════════════════
    //  REPORT & END CHAT
    // ═══════════════════════════════════════════════

    socket.on("report_user", (payload) => {
      const currentUser = users.get(userId);
      if (!currentUser) return;

      // Use roomId from payload or currentUser state
      const targetRoomId = payload?.roomId || currentUser.roomId;
      if (!targetRoomId) return;

      const room = rooms.get(targetRoomId) || Array.from(friendRooms.values()).find(r => r.roomId === targetRoomId);
      const partnerId = room?.users ? room.users.find(id => id !== userId) : (room?.userIds ? room.userIds.find(id => id !== userId) : null);
      const partner = partnerId ? users.get(partnerId) : null;

      const report = reportStore.addReport({
        reporterId: userId,
        reporterCountry: currentUser.country,
        reportedUserId: partnerId || "unknown",
        reportedUserCountry: partner?.country || "unknown",
        roomId: currentUser.roomId,
        reason: payload?.reason || "user_reported",
      });

      securityStore.addSecurityLog("user_reported", {
        userId, reportedUserId: partnerId, roomId: currentUser.roomId,
        reportId: report.id, severity: "medium",
      });

      log("user_reported", {
        reportId: report.id, reporterId: userId,
        reporterCountry: currentUser.country,
        reportedUserId: partnerId || "unknown",
        reportedUserCountry: partner?.country || "unknown",
        roomId: currentUser.roomId,
        reportedAt: Date.now(), roomCreatedAt: room?.createdAt,
      });

      terminateSession(io, currentUser.roomId, "user_reported");
      socket.emit("chat_end", { reason: "user_reported" });
    });

    socket.on("end_chat", (payload) => {
      const currentUser = users.get(userId);
      if (!currentUser || !currentUser.roomId) return;

      log("user_ended_chat", { userId, roomId: currentUser.roomId, endedAt: Date.now() });

      terminateSession(io, currentUser.roomId, "user_ended");
      socket.emit("chat_end", { reason: "you_ended" });
    });

    // ═══════════════════════════════════════════════
    //  DISCONNECT
    // ═══════════════════════════════════════════════

    socket.on("disconnect", () => {
      const disconnectedUser = users.get(userId) || getUserBySocketId(socket.id);
      if (!disconnectedUser) return;

      if (disconnectedUser.status === "waiting") {
        leaveWaitingQueue(disconnectedUser.id);
      }

      clearInterval(heartbeatInterval);

      disconnectedUser.isActive = false;
      disconnectedUser.lastDisconnect = Date.now();

      if (disconnectedUser.status === "matched" && disconnectedUser.roomId) {
        const room = rooms.get(disconnectedUser.roomId);
        // Only handle disconnect for stranger chats, not friend DMs
        if (room && room.type !== "friend_dm") {
          log("user_disconnected_while_matched", {
            userId: disconnectedUser.id, socketId: socket.id,
            roomId: disconnectedUser.roomId, reason: "socket_disconnect_allowing_reconnect",
          });
          handlePartnerDisconnect(io, disconnectedUser.roomId, disconnectedUser.id);
        }
      }

      // Notify friends that user is offline
      notifyFriendsOfStatusChange(io, userId, false);
    });

    socket.on("error", (error) => {
      log("socket_runtime_error", { userId, socketId: socket.id, message: error.message });
    });
  });
}

module.exports = {
  registerSocketHandlers,
};
