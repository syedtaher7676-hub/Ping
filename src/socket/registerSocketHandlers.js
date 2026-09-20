const { users, rooms, getUserBySocketId, getUserById, recordMatchmakingTime, getMetrics,
  pendingFriendRequests, timeExtensionRequests, addFriendship, areFriends, getFriends, getFriendRoom, getCanonicalPairId, friendRooms,
  appendFriendRoomMessage, getFriendRoomMessages, createFriendRequest, acceptFriendRequest, rejectFriendRequest,
  getPendingRequestsFor, getExistingRequest, removeFriendRequest,
  checkSlidingWindowRateLimit, redisSetUser, redisDeleteUser, purgeUserFromAllState, createFriendRoomEntry,
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
const dbService = require("../services/dbService");
const { validateMessage } = require("../utils/moderation");

// ═══════════════════════════════════════════════════════════════
// MULTI-TIER REAL-TIME MODERATION & FLOOD STATE STORES
// ═══════════════════════════════════════════════════════════════
const messageTimestamps = new Map();     // socketId -> array of message timestamps
const silencedSockets = new Map();       // socketId -> silence expiry timestamp (Date.now() + 10s)
const silenceViolationCounts = new Map(); // socketId -> continuous violation frequency
const recentReports = new Map();         // reporterId_reportedUserId -> timestamp of report
const temporaryBans = new Map();         // userId/IP -> ban expiry timestamp (Date.now() + 1 hour)

function isUserBanned(socket, userId) {
  const now = Date.now();

  // Housekeep expired bans
  for (const [id, expiry] of temporaryBans.entries()) {
    if (now >= expiry) {
      temporaryBans.delete(id);
    }
  }

  // Check user ID ban
  if (temporaryBans.has(userId)) {
    const expiry = temporaryBans.get(userId);
    if (now < expiry) {
      return { banned: true, remaining: expiry - now };
    }
  }

  // Check IP ban
  const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  if (ip && temporaryBans.has(ip)) {
    const expiry = temporaryBans.get(ip);
    if (now < expiry) {
      return { banned: true, remaining: expiry - now };
    }
  }

  return { banned: false };
}

// ═══════════════════════════════════════════════════════════════
// BUG FIX 3: Robust Payload Validation & Sanitization Helpers
// ═══════════════════════════════════════════════════════════════
// Pure validation functions to eliminate Node.js process crashes
// from non-JSON payloads, null/undefined destructuring, or unexpected data types.

function safeObject(val) {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return val;
  }
  return {};
}

function safeString(val, maxLength = 1000) {
  if (typeof val === "string") {
    return val.trim().slice(0, maxLength);
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val).trim().slice(0, maxLength);
  }
  return "";
}

function safeId(val) {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  if (["__proto__", "prototype", "constructor", "toString", "valueOf"].includes(trimmed)) return null;
  return trimmed;
}

function safeBoolean(val, defaultValue = false) {
  if (typeof val === "boolean") return val;
  if (val === "true" || val === 1 || val === "1") return true;
  if (val === "false" || val === 0 || val === "0") return false;
  return defaultValue;
}

function safeReplyTo(val) {
  if (!val || typeof val !== "object" || Array.isArray(val)) return null;
  const text = safeString(val.text, 200);
  const from = safeString(val.from, 64);
  const msgId = safeId(val.msgId) || safeString(val.msgId, 64);
  if (!text && !from && !msgId) return null;
  return { text, from, msgId };
}

function emitState(socket, user) {
  if (!socket || !user) return;
  socket.emit("state_update", {
    status: user.status,
    roomId: user.roomId,
    joinedAt: user.joinedAt,
  });
}

function queueUserForMatch(socket, io, userId) {
  const banStatus = isUserBanned(socket, userId);
  if (banStatus.banned) {
    const mins = Math.ceil(banStatus.remaining / 60000);
    socket.emit("queue_rejected", { reason: "banned", message: `🚫 You are temporarily suspended from matchmaking for another ${mins} minutes.` });
    socket.emit("error_message", { message: `🚫 Matchmaking disabled: Suspended for another ${mins} mins.` });
    return { ok: false };
  }

  const currentUser = users.get(userId);
  if (!currentUser) {
    socket.emit("queue_rejected", { reason: "user_not_found" });
    return { ok: false };
  }

  const result = enqueueForMatchmaking(userId, io);
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
      isFlash,
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
        online,
      });
    }
  });
}

function registerSocketHandlers(io, getCountryFromSocket) {
  // Periodic metrics broadcast
  const metricsInterval = setInterval(() => {
    const metrics = getMetrics();
    log("system_metrics", metrics);
    io.emit("system_metrics", metrics);
  }, METRICS_LOG_INTERVAL_MS);
  metricsInterval.unref();

  // Cleanup inactive users
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [userId, user] of users.entries()) {
      if (!user.isActive && now - (user.lastDisconnect || user.lastHeartbeat) > HEARTBEAT_TIMEOUT_MS) {
        log("user_inactive_timeout", { userId });
        purgeUserFromAllState(userId, user.socketId);
        users.delete(userId);
      }
    }
  }, HEARTBEAT_INTERVAL_MS * 2);
  cleanupInterval.unref();

  io.engine.on("connection_error", (error) => {
    log("socket_connection_error", { code: error.code, message: error.message, context: error.context });
  });

  io.on("connection", (socket) => {
    // ═══════════════════════════════════════════════════════════════
    // BUG FIX 2 & 4: Verified Identity Extraction & Synchronous Hydration
    // ═══════════════════════════════════════════════════════════════
    // Identity is pre-validated in io.use middleware. Here we ensure
    // the user state is synchronously instantiated before ANY socket
    // event can execute, eliminating race conditions on immediate start_chat.
    const verifiedUserId = socket.data.userId || createId("u");
    const verifiedCountry = socket.data.country || (getCountryFromSocket ? getCountryFromSocket(socket) : "Someone nearby");
    let userId = verifiedUserId;

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
        country: verifiedCountry,
        lastHeartbeat: Date.now(),
        isActive: true,
      };
    } else {
      // Reconnecting user - close any lingering old socket to avoid ghost connections
      if (user.socketId && user.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(user.socketId);
        if (oldSocket) {
          try { oldSocket.disconnect(true); } catch {}
        }
      }
      user.socketId = socket.id;
      user.isActive = true;
      user.lastHeartbeat = Date.now();

      // If they were in an active room, rejoin the socket.io room
      if (user.roomId) {
        const room = rooms.get(user.roomId);
        if (room && room.status === "active") {
          socket.join(user.roomId);
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
    if (typeof redisSetUser === "function") {
      redisSetUser(userId, user).catch(() => {});
    }

    // Subscribe socket to its personal user room for targeted notifications
    socket.join(`user_${userId}`);

    // Allow explicit client authentication / auto-rejoin of active friend room
    socket.on("authenticate", async (rawPayload, ack) => {
      try {
        const payload = safeObject(rawPayload);
        const authUserId = safeId(payload.userId) || userId;
        const activeFriendId = safeId(payload.activeFriendId);

        const oldUserId = userId;
        if (authUserId !== oldUserId) {
          log("session_upgrade", { oldUserId, authUserId });
          const oldUser = users.get(oldUserId);
          if (oldUser) {
            users.delete(oldUserId);
            oldUser.id = authUserId;
            users.set(authUserId, oldUser);
            if (typeof redisDeleteUser === "function") {
              redisDeleteUser(oldUserId).catch(() => {});
            }
            if (typeof redisSetUser === "function") {
              redisSetUser(authUserId, oldUser).catch(() => {});
            }
          }
          userId = authUserId;
        }

        // Ensure socket is subscribed to personal room
        socket.join(`user_${authUserId}`);

        // If an active friend conversation is specified, auto-rejoin canonical room
        if (activeFriendId) {
          const roomId = ['friend_chat', ...[authUserId, activeFriendId].sort()].join('_');
          socket.join(roomId);
        }

        // Trigger immediate DB Sync for the newly authenticated user
        dbService.syncUserOnAuth(authUserId, { country: user.country }).then(async (profile) => {
          if (profile) {
            user.profile = profile;
            if (typeof profile.totalMatches === "number") {
              user.totalMatches = profile.totalMatches;
            }
            userStore.setUserData(authUserId, profile);
          }
        }).catch(() => {});

        if (typeof ack === "function") {
          ack({ success: true, ok: true, userId: authUserId });
        }
      } catch (err) {
        log("authenticate_error", { userId, error: err?.message });
        if (typeof ack === "function") {
          ack({ success: false, ok: false });
        }
      }
    });

    // Asynchronously fetch user profile and friend list from Firestore upon authentication
    dbService.syncUserOnAuth(userId, { country: user.country }).then(async (profile) => {
      if (profile) {
        user.profile = profile;
        if (typeof profile.totalMatches === "number") {
          user.totalMatches = profile.totalMatches;
        }
        userStore.setUserData(userId, profile);
      }

      // Fetch persistent friends from Firestore and sync into local/Redis state
      const persistentFriends = await dbService.getUserFriends(userId);
      if (Array.isArray(persistentFriends) && persistentFriends.length > 0) {
        persistentFriends.forEach((f) => {
          if (f.friendId && !areFriends(userId, f.friendId)) {
            addFriendship(userId, f.friendId);
          }
        });
      }
    }).catch(() => {});

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

      if (currentUser.socketId !== socket.id) {
        clearInterval(heartbeatInterval);
        return;
      }

      if (socket.connected) {
        currentUser.lastHeartbeat = Date.now();
      }

      const timeSinceHeartbeat = Date.now() - (currentUser.lastHeartbeat || 0);
      if (timeSinceHeartbeat > HEARTBEAT_TIMEOUT_MS && !socket.connected) {
        log("user_heartbeat_timeout", { userId, timeSinceHeartbeat });
        purgeUserFromAllState(userId, socket.id);
        if (currentUser.status === "matched" && currentUser.roomId) {
          const room = rooms.get(currentUser.roomId);
          if (room && room.type !== "friend_dm") {
            terminateSession(io, currentUser.roomId, "heartbeat_timeout");
          }
        } else if (currentUser.status === "waiting") {
          leaveWaitingQueue(userId);
        }
        users.delete(userId);
        if (typeof redisDeleteUser === "function") {
          redisDeleteUser(userId).catch(() => {});
        }
        clearInterval(heartbeatInterval);
        socket.disconnect(true);
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Notify friends that user is online
    notifyFriendsOfStatusChange(io, userId, true);

    socket.on("heartbeat", () => {
      try {
        const currentUser = users.get(userId);
        if (currentUser) {
          currentUser.lastHeartbeat = Date.now();
          currentUser.isActive = true;
          if (typeof redisSetUser === "function") {
            redisSetUser(userId, currentUser).catch(() => {});
          }
        }
      } catch (err) {
        log("heartbeat_handler_error", { userId, message: err.message });
      }
    });

    // ═══════════════════════════════════════════════
    //  MATCHMAKING
    // ═══════════════════════════════════════════════

    socket.on("start_chat", async () => {
      try {
        if (!socket.connected) return;
        const currentUser = users.get(userId);
        if (!currentUser) return;

        const now = Date.now();

        // Check Redis sliding window rate limit
        if (typeof checkSlidingWindowRateLimit === "function") {
          const rateLimit = await checkSlidingWindowRateLimit(`start_chat:${userId}`, START_CHAT_COOLDOWN_MS, 1);
          if (!rateLimit.allowed) {
            socket.emit("queue_rejected", {
              reason: "start_chat_rate_limited",
              retryAfter: rateLimit.retryAfter || (START_CHAT_COOLDOWN_MS - (now - currentUser.lastStartChatAt)),
            });
            emitState(socket, currentUser);
            return;
          }
        } else if (now - currentUser.lastStartChatAt < START_CHAT_COOLDOWN_MS) {
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
        currentUser.isActive = true;
        if (typeof redisSetUser === "function") {
          redisSetUser(userId, currentUser).catch(() => {});
        }
        queueUserForMatch(socket, io, userId);
      } catch (err) {
        log("start_chat_error", { userId, message: err.message });
      }
    });

    // ═══════════════════════════════════════════════
    //  SEND MESSAGE (stranger chat)
    // ═══════════════════════════════════════════════

    socket.on("send_message", async (rawPayload, ack) => {
      try {
        const payload = safeObject(rawPayload);
        const currentUser = users.get(userId);
        if (!currentUser || currentUser.status !== "matched" || !currentUser.roomId) {
          socket.emit("error_message", { message: "💀 you're not in a chat rn. hit find someone first!" });
          if (typeof ack === "function") ack({ ok: false, reason: "not_in_active_session" });
          return;
        }

        const now = Date.now();

        // Check if silenced due to spam
        const silenceEndTime = silencedSockets.get(socket.id);
        if (silenceEndTime && now < silenceEndTime) {
          const remaining = Math.ceil((silenceEndTime - now) / 1000);
          socket.emit("error_message", { message: `⏳ You are silenced! Please wait ${remaining}s before sending messages.` });
          if (typeof ack === "function") ack({ ok: false, reason: "silenced" });
          return;
        }

        // Track and check message rate (< 1000ms window)
        let userTimes = messageTimestamps.get(socket.id) || [];
        userTimes = userTimes.filter(t => now - t < 1000);
        userTimes.push(now);
        messageTimestamps.set(socket.id, userTimes);

        if (userTimes.length > 3) {
          silencedSockets.set(socket.id, now + 10000);
          const vCount = (silenceViolationCounts.get(socket.id) || 0) + 1;
          silenceViolationCounts.set(socket.id, vCount);
          log("socket_rate_limited_and_silenced", { userId, socketId: socket.id, vCount });

          if (vCount >= 3) {
            socket.emit("error_message", { message: "🚫 Terminating session due to repeated spamming." });
            terminateSession(io, currentUser.roomId, "system_rate_limit_exceeded");
          } else {
            socket.emit("error_message", { message: "⏳ Slow down! Sending messages too fast. You have been silenced for 10 seconds." });
          }
          if (typeof ack === "function") ack({ ok: false, reason: "rate_limited" });
          return;
        }

        const text = safeString(payload.message, MAX_MESSAGE_LENGTH + 50);
        const replyToContext = safeReplyTo(payload.replyTo);
        const msgId = safeId(payload.msgId) || safeString(payload.msgId, 64) || createId("m");
        const isFlash = safeBoolean(payload.isFlash, false);

        if (!text) {
          if (typeof ack === "function") ack({ ok: false, reason: "empty_message" });
          return;
        }

        // ═══════════════════════════════════════════════
        // TIER 2: Real-time Regex, ASL & Handle Filter
        // ═══════════════════════════════════════════════
        const customMod = await validateMessage(text);
        if (!customMod.valid) {
          log("message_rejected_custom_mod", { userId, reason: customMod.reason, text: text.slice(0, 100) });
          if (customMod.action === 'ban_15min' || customMod.action === 'ban_1hour') {
            const banExpiry = Date.now() + 900000; // 15 minutes ban
            temporaryBans.set(userId, banExpiry);
            const ip = socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;
            if (ip) temporaryBans.set(ip, banExpiry);

            const offenderMsg = "You have been banned for 15 minutes due to inappropriate behavior, slurs, or restricted tags (e.g. M18).";
            socket.emit("chat_ended_banned", { message: offenderMsg, remainingMs: 900000 });
            socket.emit("error_message", { message: offenderMsg });

            if (currentUser.roomId) {
              const room = rooms.get(currentUser.roomId);
              if (room && room.users) {
                const partnerId = room.users.find(id => id !== userId);
                if (partnerId) {
                  const partner = users.get(partnerId);
                  if (partner && partner.socketId) {
                    const partnerSocket = io.sockets.sockets.get(partner.socketId);
                    if (partnerSocket) {
                      const victimMsg = "The stranger used slurs/inappropriate language and has been banned for 15 minutes.";
                      partnerSocket.emit("chat_ended_banned", { message: victimMsg, isVictim: true });
                      partnerSocket.emit("error_message", { message: victimMsg });
                      setTimeout(() => {
                        queueUserForMatch(partnerSocket, io, partnerId);
                      }, 1500);
                    }
                  }
                }
              }
              terminateSession(io, currentUser.roomId, "banned_violation");
            }

            try { socket.disconnect(true); } catch (e) {}
            if (typeof ack === "function") ack({ ok: false, reason: "banned_15min" });
            return;
          }
          socket.emit("message_rejected", { message: "⚠️ Message blocked: Keep chats safe and respectful.", reason: customMod.reason });
          socket.emit("error_message", { message: "⚠️ Message blocked: Keep chats safe and respectful." });
          if (typeof ack === "function") ack({ ok: false, reason: "custom_moderation_blocked" });
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

        // Rate limiting via Redis sliding window
        let throttleDelay = 0;
        if (typeof checkSlidingWindowRateLimit === "function") {
          const burstCheck = await checkSlidingWindowRateLimit(`msg_burst:${userId}`, BURST_WINDOW_MS, MAX_MESSAGES_BURST);
          if (!burstCheck.allowed) {
            log("message_throttled", { userId, recentCount: burstCheck.currentCount, reason: "burst_exceeded" });
            throttleDelay = THROTTLE_PENALTY_MS;
          }
        }

        if (!currentUser.messageHistory) currentUser.messageHistory = [];
        currentUser.messageHistory.push({ text, timestamp: now });
        currentUser.messageHistory = currentUser.messageHistory.filter(m => now - m.timestamp < BURST_WINDOW_MS);

        const recentCount = currentUser.messageHistory.length;
        if (recentCount > MAX_MESSAGES_BURST && throttleDelay === 0) {
          log("message_throttled", { userId, recentCount, reason: "burst_exceeded" });
          throttleDelay = THROTTLE_PENALTY_MS;
        }

        // Duplicate detection
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
      } catch (err) {
        log("send_message_error", { userId, message: err.message });
        if (typeof ack === "function") ack({ ok: false, reason: "internal_error" });
      }
    });

    // ═══════════════════════════════════════════════
    //  SEND DM (friend chat)
    // ═══════════════════════════════════════════════

    socket.on("send_dm", async (rawPayload, ack) => {
      try {
        const payload = safeObject(rawPayload);
        let currentUser = users.get(userId);
        let dmRoomId = safeId(payload.roomId);
        let friendId = safeId(payload.friendId);

        if (!currentUser) {
          currentUser = {
            id: userId,
            socketId: socket.id,
            status: "idle",
            roomId: dmRoomId || null,
            joinedAt: Date.now(),
            lastStartChatAt: 0,
            lastMessageAt: 0,
            lastActionAt: 0,
            country: socket.data.country || "Someone nearby",
            lastHeartbeat: Date.now(),
            isActive: true,
          };
          users.set(userId, currentUser);
        }

        // Determine partnerId / friendId
        let partnerId = friendId;
        if (!partnerId && dmRoomId) {
          const room = rooms.get(dmRoomId);
          if (room?.users) {
            partnerId = room.users.find((id) => id !== userId);
          }
        }
        if (!partnerId && dmRoomId && dmRoomId.startsWith("friend_chat_")) {
          const parts = dmRoomId.replace("friend_chat_", "").split("_");
          partnerId = parts.find((id) => id !== userId);
        }
        if (!partnerId && dmRoomId && dmRoomId.startsWith("dm_")) {
          const parts = dmRoomId.replace("dm_", "").split("_");
          partnerId = parts.find((id) => id !== userId);
        }

        // Verify friendship with fallback check to persistent Firestore storage
        let isFriend = partnerId ? areFriends(userId, partnerId) : false;
        if (!isFriend && partnerId) {
          try {
            const persistentFriends = await dbService.getUserFriends(userId);
            if (Array.isArray(persistentFriends) && persistentFriends.some((f) => f.friendId === partnerId)) {
              addFriendship(userId, partnerId);
              isFriend = true;
            }
          } catch (dbErr) {
            log("friend_check_db_error", { userId, error: dbErr?.message });
          }
        }

        if (!partnerId || !isFriend) {
          socket.emit("error_message", { message: "This DM room doesn't exist or you don't have access." });
          if (typeof ack === "function") ack({ ok: false, success: false, reason: "invalid_room" });
          return;
        }

        // Fallback Guard: Auto re-verify and join canonical room on the fly if not joined
        const roomId = ['friend_chat', ...[userId, partnerId].sort()].join('_');
        if (!socket.rooms.has(roomId)) {
          log("fallback_join_friend_dm", { userId, roomId });
          socket.join(roomId);
        }

        let room = rooms.get(roomId);
        if (!room) {
          room = {
            roomId,
            status: "active",
            type: "friend_dm",
            users: [userId, partnerId],
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
          };
          rooms.set(roomId, room);
        } else {
          room.lastActivityAt = Date.now();
        }

        const text = safeString(payload.message, MAX_MESSAGE_LENGTH + 50);
        const replyToContext = safeReplyTo(payload.replyTo);
        const msgId = safeId(payload.msgId) || safeString(payload.msgId, 64) || createId("m");
        const isFlash = safeBoolean(payload.isFlash, false);

        if (!text) {
          if (typeof ack === "function") ack({ ok: false, success: false, reason: "empty_message" });
          return;
        }
        if (text.length > MAX_MESSAGE_LENGTH) {
          socket.emit("error_message", { message: `✂️ message too long! keep it under ${MAX_MESSAGE_LENGTH} chars bestie` });
          if (typeof ack === "function") ack({ ok: false, success: false, reason: "message_too_long" });
          return;
        }

        const customMod = await validateMessage(text);
        if (!customMod.valid) {
          log("dm_rejected_custom_mod", { userId, reason: customMod.reason, text: text.slice(0, 100) });
          if (customMod.action === 'ban_15min' || customMod.action === 'ban_1hour') {
            const banExpiry = Date.now() + 900000; // 15 minutes ban
            temporaryBans.set(userId, banExpiry);
            const ip = socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;
            if (ip) temporaryBans.set(ip, banExpiry);
            const offenderMsg = "You have been banned for 15 minutes due to inappropriate behavior, slurs, or restricted tags (e.g. M18).";
            socket.emit("chat_ended_banned", { message: offenderMsg, remainingMs: 900000 });
            socket.emit("error_message", { message: offenderMsg });
            try { socket.disconnect(true); } catch (e) {}
            if (typeof ack === "function") ack({ ok: false, success: false, reason: "banned_15min" });
            return;
          }
          socket.emit("message_rejected", { message: "⚠️ Message blocked: Keep chats safe and respectful.", reason: customMod.reason });
          if (typeof ack === "function") ack({ ok: false, success: false, reason: "custom_moderation_blocked" });
          return;
        }

        // Run moderation (never disconnects)
        const modResult = validateAndModerateMessage(socket, userId, text);
        if (modResult.blocked) {
          if (typeof ack === "function") ack({ ok: false, success: false, reason: modResult.reason, action: modResult.action });
          return;
        }

        const sentAt = Date.now();

        // 1. In-memory / redis store
        appendFriendRoomMessage(userId, partnerId, {
          from: userId,
          message: modResult.finalMessage,
          replyTo: replyToContext,
          sentAt,
          msgId,
          isFlash,
        });

        // 2. Persist to Cloud Firestore via dbService.saveFriendChatMessage()
        const canonicalChatId = dbService.getCanonicalPairId(userId, partnerId);
        dbService.saveFriendChatMessage({
          chatId: canonicalChatId,
          messageId: msgId,
          fromUserId: userId,
          message: modResult.finalMessage,
          replyTo: replyToContext,
          isFlash,
          sentAt,
        }).catch((err) => {
          log("firestore_save_friend_dm_error", { userId, error: err?.message });
        });

        const dmPayload = {
          from: userId,
          fromUserId: userId,
          message: modResult.finalMessage,
          replyTo: replyToContext,
          sentAt,
          roomId,
          msgId,
          isFlash,
        };

        // 3. Emit 'new_dm' and 'dm_message' to shared conversation room
        io.to(roomId).emit("new_dm", dmPayload);
        io.to(roomId).emit("dm_message", dmPayload);

        // 4. Emit 'friend_dm_notification' directly to friend's personal socket room (even if friend is not in room)
        const notificationPayload = {
          ...dmPayload,
          friendId: userId,
          friendCountry: currentUser.country || "Someone nearby",
        };
        io.to(`user_${partnerId}`).emit("friend_dm_notification", notificationPayload);

        const partnerUser = users.get(partnerId);
        if (partnerUser?.socketId) {
          io.to(partnerUser.socketId).emit("friend_dm_notification", notificationPayload);
        }

        // 5. Positive confirmation callback ack({ success: true, message: dmPayload })
        if (typeof ack === "function") {
          ack({ ok: true, success: true, roomId, sentAt, msgId, message: dmPayload });
        }
      } catch (err) {
        log("send_dm_error", { userId, message: err.message });
        if (typeof ack === "function") ack({ ok: false, success: false, reason: "internal_error" });
      }
    });

    socket.on("send_ping", (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const roomId = safeId(payload.roomId);
        if (!roomId) return;

        const room = rooms.get(roomId) || Array.from(friendRooms.values()).find(r => r.roomId === roomId);
        if (!room) return;

        const members = room.users || room.userIds || [];
        if (members.includes(userId)) {
          socket.to(roomId).emit("incoming_ping");
        }
      } catch (err) {
        log("send_ping_error", { userId, message: err.message });
      }
    });

    // BUG FIX 3: Flash Feature Backend Handler
    socket.on("send_flash", (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const roomId = safeId(payload.roomId);
        if (!roomId) return;

        const room = rooms.get(roomId) || Array.from(friendRooms.values()).find(r => r.roomId === roomId);
        if (!room) return;

        const members = room.users || room.userIds || [];
        if (members.includes(userId)) {
          io.to(roomId).emit("flash_received", { senderId: userId });
        }
      } catch (err) {
        log("send_flash_error", { userId, message: err.message });
      }
    });

    socket.on("edit_dm", (rawPayload, ack) => {
      try {
        const payload = safeObject(rawPayload);
        const roomId = safeId(payload.roomId);
        const msgId = safeId(payload.msgId) || safeString(payload.msgId, 64);
        const newMessage = safeString(payload.newMessage, MAX_MESSAGE_LENGTH);

        if (!roomId || !msgId || !newMessage) {
          if (typeof ack === "function") ack({ ok: false, reason: "invalid_payload" });
          return;
        }

        let targetRoom = null;
        for (const r of friendRooms.values()) {
          if (r.roomId === roomId && r.userIds.includes(userId)) {
            targetRoom = r;
            break;
          }
        }

        if (!targetRoom) {
          if (typeof ack === "function") ack({ ok: false, reason: "room_not_found" });
          return;
        }

        const msg = targetRoom.messages.find(m => m.msgId === msgId && m.from === userId);
        if (msg) {
          msg.message = newMessage;
          msg.isEdited = true;

          // Sync edit to Firestore
          const partnerId = targetRoom.userIds.find(id => id !== userId);
          if (partnerId) {
            const canonicalChatId = dbService.getCanonicalPairId(userId, partnerId);
            dbService.editFriendChatMessage(canonicalChatId, msgId, userId, newMessage).catch(() => {});
          }

          io.to(roomId).emit("dm_edited", { msgId, newMessage, roomId });
          if (typeof ack === "function") ack({ ok: true });
        } else if (typeof ack === "function") {
          ack({ ok: false, reason: "message_not_found" });
        }
      } catch (err) {
        log("edit_dm_error", { userId, message: err.message });
        if (typeof ack === "function") ack({ ok: false, reason: "internal_error" });
      }
    });

    socket.on("delete_dm", (rawPayload, ack) => {
      try {
        const payload = safeObject(rawPayload);
        const roomId = safeId(payload.roomId);
        const msgId = safeId(payload.msgId) || safeString(payload.msgId, 64);

        if (!roomId || !msgId) {
          if (typeof ack === "function") ack({ ok: false, reason: "invalid_payload" });
          return;
        }

        let targetRoom = null;
        for (const r of friendRooms.values()) {
          if (r.roomId === roomId && r.userIds.includes(userId)) {
            targetRoom = r;
            break;
          }
        }

        if (!targetRoom) {
          if (typeof ack === "function") ack({ ok: false, reason: "room_not_found" });
          return;
        }

        const idx = targetRoom.messages.findIndex(m => m.msgId === msgId && m.from === userId);
        if (idx !== -1) {
          targetRoom.messages.splice(idx, 1);

          // Sync delete to Firestore
          const partnerId = targetRoom.userIds.find(id => id !== userId);
          if (partnerId) {
            const canonicalChatId = dbService.getCanonicalPairId(userId, partnerId);
            dbService.deleteFriendChatMessage(canonicalChatId, msgId, userId).catch(() => {});
          }

          io.to(roomId).emit("dm_deleted", { msgId, roomId });
          if (typeof ack === "function") ack({ ok: true });
        } else if (typeof ack === "function") {
          ack({ ok: false, reason: "message_not_found" });
        }
      } catch (err) {
        log("delete_dm_error", { userId, message: err.message });
        if (typeof ack === "function") ack({ ok: false, reason: "internal_error" });
      }
    });

    socket.on("edit_message", (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const roomId = safeId(payload.roomId);
        const msgId = safeId(payload.msgId) || safeString(payload.msgId, 64);
        const newMessage = safeString(payload.newMessage, MAX_MESSAGE_LENGTH);

        if (!roomId || !msgId || !newMessage) return;
        const room = rooms.get(roomId);
        if (room && room.users.includes(userId)) {
          io.to(roomId).emit("message_edited", { msgId, newMessage, roomId });
        }
      } catch (err) {
        log("edit_message_error", { userId, message: err.message });
      }
    });

    socket.on("delete_message", (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const roomId = safeId(payload.roomId);
        const msgId = safeId(payload.msgId) || safeString(payload.msgId, 64);

        if (!roomId || !msgId) return;
        const room = rooms.get(roomId);
        if (room && room.users.includes(userId)) {
          io.to(roomId).emit("message_deleted", { msgId, roomId });
        }
      } catch (err) {
        log("delete_message_error", { userId, message: err.message });
      }
    });

    socket.on("mark_read", (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const roomId = safeId(payload.roomId);
        if (!roomId) return;
        const currentUser = users.get(userId);
        if (!currentUser) return;
        const room = rooms.get(roomId);
        if (!room || room.status !== "active") return;
        if (!room.users.includes(userId)) return;
        socket.to(roomId).emit("message_seen", { roomId });
      } catch (err) {
        log("mark_read_error", { userId, message: err.message });
      }
    });

    // ═══════════════════════════════════════════════
    //  TIME EXTENSION
    // ═══════════════════════════════════════════════

    socket.on("request_time_extension", () => {
      try {
        const currentUser = users.get(userId);
        if (!currentUser || currentUser.status !== "matched" || !currentUser.roomId) return;

        const roomId = currentUser.roomId;
        const room = rooms.get(roomId);
        if (!room || room.status !== "active" || room.type === "friend_dm") return;

        const existing = timeExtensionRequests.get(roomId);
        if (existing && existing.requestedBy === userId) {
          socket.emit("error_message", { message: "⏳ you already requested more time. waiting for partner!" });
          return;
        }

        if (existing && existing.requestedBy !== userId) {
          timeExtensionRequests.delete(roomId);
          extendSessionTime(io, roomId);
          return;
        }

        timeExtensionRequests.set(roomId, { requestedBy: userId, createdAt: Date.now() });

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
      } catch (err) {
        log("request_time_extension_error", { userId, message: err.message });
      }
    });

    socket.on("time_extension_response", (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const accept = safeBoolean(payload.accept, false);
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
          const requesterUser = users.get(existing.requestedBy);
          if (requesterUser?.socketId) {
            const requesterSocket = io.sockets.sockets.get(requesterUser.socketId);
            requesterSocket?.emit("time_extension_declined", { roomId });
          }
        }
      } catch (err) {
        log("time_extension_response_error", { userId, message: err.message });
      }
    });

    // ═══════════════════════════════════════════════
    //  FRIEND SYSTEM
    // ═══════════════════════════════════════════════

    socket.on("send_friend_request", () => {
      try {
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

        const partnerUser = users.get(partnerId);
        if (partnerUser?.socketId) {
          io.to(partnerUser.socketId).emit("friend_request_received", {
            requestId: result.requestId,
            fromUserId: userId,
            fromCountry: currentUser.country || "Unknown",
          });
        }

        socket.emit("friend_request_sent", {
          requestId: result.requestId,
          toUserId: partnerId,
        });

        dbService.createFriendRequest({
          requestId: result.requestId,
          fromUserId: userId,
          toUserId: partnerId,
          roomId: currentUser.roomId,
        }).catch(() => {});
      } catch (err) {
        log("send_friend_request_error", { userId, message: err.message });
      }
    });

    socket.on("friend_request_response", (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const requestId = safeId(payload.requestId);
        const accept = safeBoolean(payload.accept, false);

        if (!requestId) {
          socket.emit("error_message", { message: "Invalid request ID format." });
          return;
        }

        const result = respondToFriendRequest(requestId, userId, accept, io);
        if (!result.ok) {
          socket.emit("error_message", { message: "Request expired or invalid." });
          return;
        }

        if (accept && result.accepted) {
          const fromUserId = result.fromUserId;
          const dmRoomId = result.roomId;

          dbService.updateFriendRequestStatus(requestId, "accepted").catch(() => {});
          dbService.saveFriendship(fromUserId, userId).catch(() => {});

          const userA = users.get(fromUserId);
          const userB = users.get(userId);

          if (userA?.socketId) {
            const sA = io.sockets.sockets.get(userA.socketId);
            sA?.join(dmRoomId);
            sA?.emit("friend_request_accepted", {
              friendId: userId,
              friendCountry: userB?.country || "Unknown",
              dmRoomId,
            });
          }

          socket.join(dmRoomId);
          socket.emit("friend_request_accepted", {
            friendId: fromUserId,
            friendCountry: userA?.country || "Unknown",
            dmRoomId,
          });
        } else if (!accept) {
          dbService.updateFriendRequestStatus(requestId, "rejected").catch(() => {});
          const requester = users.get(result.fromUserId);
          if (requester?.socketId) {
            io.to(requester.socketId).emit("friend_request_declined", { fromUserId: userId });
          }
        }
      } catch (err) {
        log("friend_request_response_error", { userId, message: err.message });
      }
    });

    socket.on("get_friends", (ack) => {
      try {
        const friends = getFriendsList(userId);
        if (typeof ack === "function") ack({ friends });
        else socket.emit("friends_list", { friends });
      } catch (err) {
        log("get_friends_error", { userId, message: err.message });
        if (typeof ack === "function") ack({ friends: [] });
      }
    });

    socket.on("open_friend_dm", async (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const friendId = safeId(payload.friendId);
        if (!friendId) {
          socket.emit("error_message", { message: "Invalid friend ID." });
          return;
        }

        // Verify friendship with fallback check to persistent DB
        let isFriend = areFriends(userId, friendId);
        if (!isFriend) {
          try {
            const persistentFriends = await dbService.getUserFriends(userId);
            if (Array.isArray(persistentFriends) && persistentFriends.some((f) => f.friendId === friendId)) {
              addFriendship(userId, friendId);
              isFriend = true;
            }
          } catch (dbErr) {
            log("friend_check_open_dm_error", { userId, error: dbErr?.message });
          }
        }

        if (!isFriend) {
          socket.emit("error_message", { message: "You are not friends yet! 🫂" });
          return;
        }

        // 1. Generate deterministic canonical room ID
        const roomId = ['friend_chat', ...[userId, friendId].sort()].join('_');

        // 2. Explicitly subscribe socket to friend conversation room
        socket.join(roomId);

        let friendRoom = getFriendRoom(userId, friendId);
        if (!friendRoom) {
          friendRoom = createFriendRoomEntry(userId, friendId);
        }
        friendRoom.roomId = roomId;

        if (!rooms.has(roomId)) {
          rooms.set(roomId, {
            roomId,
            status: "active",
            type: "friend_dm",
            users: [userId, friendId],
            createdAt: friendRoom.createdAt || Date.now(),
            lastActivityAt: Date.now(),
            endAt: null,
            remainingMs: null,
          });
        }

        const currentUser = users.get(userId);
        if (currentUser) {
          currentUser.roomId = roomId;
          currentUser.status = "matched";
        }

        const friendUser = users.get(friendId);
        let messages = getFriendRoomMessages(userId, friendId);

        // If local room memory is empty, fetch persistent history from Cloud Firestore
        if (!messages || messages.length === 0) {
          const canonicalChatId = dbService.getCanonicalPairId(userId, friendId);
          const persistentHistory = await dbService.getFriendChatMessages(canonicalChatId, 50);
          if (Array.isArray(persistentHistory) && persistentHistory.length > 0) {
            messages = persistentHistory;
            persistentHistory.forEach((m) => {
              appendFriendRoomMessage(m.from, m.from === userId ? friendId : userId, m);
            });
          }
        }

        socket.emit("friend_dm_opened", {
          roomId,
          friendId,
          friendCountry: friendUser?.country || "Unknown",
          friendOnline: friendUser?.isActive || false,
          messages: messages || [],
        });
      } catch (err) {
        log("open_friend_dm_error", { userId, message: err.message });
      }
    });

    socket.on("leave_friend_dm", (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const rId = safeId(payload.roomId);
        if (rId) {
          socket.leave(rId);
        }
        const currentUser = users.get(userId);
        if (currentUser && currentUser.roomId === rId) {
          currentUser.roomId = null;
          currentUser.status = "idle";
          if (typeof redisSetUser === "function") {
            redisSetUser(userId, currentUser).catch(() => {});
          }
        }
      } catch (err) {
        log("leave_friend_dm_error", { userId, message: err.message });
      }
    });

    socket.on("get_pending_requests", (rawPayload, ack) => {
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

    socket.on("dm_typing", (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const roomId = safeId(payload.roomId);
        const isTyping = safeBoolean(payload.isTyping, false);
        if (!roomId) return;

        const room = rooms.get(roomId);
        if (!room || room.type !== "friend_dm" || !room.users.includes(userId)) return;
        socket.to(roomId).emit("dm_partner_typing", { roomId, isTyping, fromUserId: userId });
      } catch (err) {
        log("dm_typing_error", { userId, message: err.message });
      }
    });

    // ═══════════════════════════════════════════════
    //  NAVIGATION
    // ═══════════════════════════════════════════════

    socket.on("next_chat", (rawPayload = {}) => {
      try {
        const payload = safeObject(rawPayload);
        const autoStart = safeBoolean(payload.autoStart, false);
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
      } catch (err) {
        log("next_chat_error", { userId, message: err.message });
      }
    });

    socket.on("cancel_search", () => {
      try {
        const currentUser = users.get(userId);
        if (!currentUser) return;
        if (currentUser.status === "waiting") {
          leaveWaitingQueue(userId);
          socket.emit("chat_end", { reason: "left_queue" });
        }
        emitState(socket, currentUser);
      } catch (err) {
        log("cancel_search_error", { userId, message: err.message });
      }
    });

    // ═══════════════════════════════════════════════
    //  STATE & METRICS
    // ═══════════════════════════════════════════════

    socket.on("get_status", (_rawPayload, ack) => {
      try {
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
      } catch (err) {
        log("get_status_error", { userId, message: err.message });
      }
    });

    socket.on("get_metrics", (_rawPayload, ack) => {
      try {
        if (typeof ack === "function") ack(getMetrics());
      } catch (err) {
        log("get_metrics_error", { userId, message: err.message });
      }
    });

    socket.on("get_stats", (_rawPayload, ack) => {
      try {
        const currentUser = users.get(userId);
        const metrics = getMetrics();
        const statsPayload = {
          status: currentUser?.status || "idle",
          roomId: currentUser?.roomId || null,
          activeUsers: metrics?.activeUsers || 0,
          totalMatches: metrics?.totalMatches || 0,
          totalChats: metrics?.totalMatches || 0,
        };
        if (typeof ack === "function") {
          ack(statsPayload);
        }
        socket.emit("stats", statsPayload);
      } catch (err) {
        log("get_stats_error", { userId, message: err.message });
      }
    });

    socket.on("update_profile", async (rawProfileData, ack) => {
      try {
        const profileData = safeObject(rawProfileData);
        userStore.setUserData(userId, profileData);
        const currentUser = users.get(userId);
        if (currentUser) {
          currentUser.profile = { ...(currentUser.profile || {}), ...profileData };
        }
        await dbService.updateUserProfile(userId, profileData);
        if (typeof ack === "function") ack({ ok: true });
        socket.emit("profile_updated", { userId, profile: profileData });
      } catch (err) {
        if (typeof ack === "function") ack({ ok: false, error: err.message });
      }
    });

    socket.on("send_flash", (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const roomId = safeId(payload.roomId);
        if (!roomId) return;

        const room = rooms.get(roomId);
        if (!room || room.status !== "active") return;
        if (!room.users.includes(userId)) return;

        // Broadcast to other users in the room
        socket.to(roomId).emit("flash_received", { senderId: userId });
        log("send_flash_success", { roomId, userId });
      } catch (err) {
        log("send_flash_error", { userId, message: err.message });
      }
    });

    // ═══════════════════════════════════════════════
    //  TYPING
    // ═══════════════════════════════════════════════

    socket.on("typing", (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const isTyping = safeBoolean(payload.isTyping, false);
        const currentUser = users.get(userId);
        if (!currentUser || !currentUser.roomId) return;

        const room = rooms.get(currentUser.roomId);
        if (!room) return;

        room.users.forEach((partnerId) => {
          if (partnerId !== userId) {
            const partnerSocket = io.sockets.sockets.get(users.get(partnerId)?.socketId);
            if (partnerSocket) {
              partnerSocket.emit("partner_typing", { isTyping });
            }
          }
        });
      } catch (err) {
        log("typing_error", { userId, message: err.message });
      }
    });

    // ═══════════════════════════════════════════════
    //  REPORT & END CHAT
    // ═══════════════════════════════════════════════

    socket.on("report_user", (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const currentUser = users.get(userId);
        if (!currentUser) return;

        const targetRoomId = safeId(payload.roomId) || currentUser.roomId;
        if (!targetRoomId) return;

        const room = rooms.get(targetRoomId) || Array.from(friendRooms.values()).find(r => r.roomId === targetRoomId);
        const partnerId = room?.users ? room.users.find(id => id !== userId) : (room?.userIds ? room.userIds.find(id => id !== userId) : null);
        const partner = partnerId ? users.get(partnerId) : null;

        const reason = safeString(payload.reason, 120) || "user_reported";

        const report = reportStore.addReport({
          reporterId: userId,
          reporterCountry: currentUser.country,
          reportedUserId: partnerId || "unknown",
          reportedUserCountry: partner?.country || "unknown",
          roomId: currentUser.roomId,
          reason,
        });

        securityStore.addSecurityLog("user_reported", {
          userId, reportedUserId: partnerId, roomId: currentUser.roomId,
          reportId: report.id, severity: "medium",
        });

        dbService.saveReport({
          reportId: report.id,
          reporterId: userId,
          reporterCountry: currentUser.country,
          reportedUserId: partnerId || "unknown",
          reportedUserCountry: partner?.country || "unknown",
          roomId: currentUser.roomId,
          reason,
          moderationFlags: report.flags || [],
        }).catch(() => {});

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

        // Increment partner's report score and apply temporary ban if necessary (2 reports in 10 minutes)
        if (partnerId && partnerId !== "unknown") {
          const now = Date.now();
          const reportKey = `${userId}_${partnerId}`;

          if (!recentReports.has(reportKey)) {
            recentReports.set(reportKey, now);

            // Clean stale reports (>10 mins)
            for (const [key, value] of recentReports.entries()) {
              if (now - value > 600000) {
                recentReports.delete(key);
              }
            }

            // Count reports on this partner
            let reportCount = 0;
            for (const [key, valTime] of recentReports.entries()) {
              if (key.endsWith(`_${partnerId}`) && (now - valTime <= 600000)) {
                reportCount++;
              }
            }

            log("report_score_incremented", { partnerId, reportCount });

            if (reportCount >= 2) {
              const banExpiry = now + 900000; // 15 minutes ban
              temporaryBans.set(partnerId, banExpiry);

              if (partner && partner.socketId) {
                const partnerSocket = io.sockets.sockets.get(partner.socketId);
                if (partnerSocket) {
                  const ip = partnerSocket.handshake.headers["x-forwarded-for"] || partnerSocket.handshake.address;
                  if (ip) {
                    temporaryBans.set(ip, banExpiry);
                    log("ip_banned_via_reports", { ip, partnerId });
                  }
                  const banMsg = "You have been banned for 15 minutes due to multiple user reports.";
                  partnerSocket.emit("chat_ended_banned", { message: banMsg, remainingMs: 900000 });
                  partnerSocket.emit("error_message", { message: banMsg });
                  try { partnerSocket.disconnect(true); } catch (e) {}
                }
              }
              log("temporary_ban_applied", { partnerId });
            }
          }
        }

        // Cleanly auto-requeue reporting user if it's an Explore chat
        const isFriendDm = targetRoomId && targetRoomId.startsWith("friend_chat_");
        if (!isFriendDm) {
          log("auto_requeue_after_report", { userId });
          setTimeout(() => {
            queueUserForMatch(socket, io, userId);
          }, 500);
        }
      } catch (err) {
        log("report_user_error", { userId, message: err.message });
      }
    });

    socket.on("end_chat", () => {
      try {
        const currentUser = users.get(userId);
        if (!currentUser || !currentUser.roomId) return;

        log("user_ended_chat", { userId, roomId: currentUser.roomId, endedAt: Date.now() });

        terminateSession(io, currentUser.roomId, "user_ended");
        socket.emit("chat_end", { reason: "you_ended" });
      } catch (err) {
        log("end_chat_error", { userId, message: err.message });
      }
    });

    // ═══════════════════════════════════════════════
    //  BUG FIX 1: Instant & Atomic Memory Purge on Disconnect
    // ═══════════════════════════════════════════════

    socket.on("disconnect", (reason) => {
      try {
        clearInterval(heartbeatInterval);

        const disconnectedUser = users.get(userId) || getUserBySocketId(socket.id);
        if (!disconnectedUser) return;

        // CRITICAL: Guard against stale socket disconnect events.
        // If the user has already reconnected with a newer socket, do NOT tear down their state or session!
        if (disconnectedUser.socketId && disconnectedUser.socketId !== socket.id) {
          log("stale_socket_disconnect_ignored", {
            userId,
            staleSocketId: socket.id,
            activeSocketId: disconnectedUser.socketId,
            reason,
          });
          return;
        }

        // 1. Instantly and atomically purge user from all waiting queues and Redis state
        purgeUserFromAllState(disconnectedUser.id, socket.id);

        if (disconnectedUser.status === "waiting") {
          leaveWaitingQueue(disconnectedUser.id);
        }

        disconnectedUser.isActive = false;
        disconnectedUser.lastDisconnect = Date.now();

        // 2. Handle active room cleanup or partner notification
        if (disconnectedUser.status === "matched" && disconnectedUser.roomId) {
          const room = rooms.get(disconnectedUser.roomId);
          if (room && room.type !== "friend_dm") {
            log("user_disconnected_while_matched_explore_instant_purge", {
              userId: disconnectedUser.id, socketId: socket.id,
              roomId: disconnectedUser.roomId, reason: "explore_instant_purge",
            });
            terminateSession(io, disconnectedUser.roomId, "user_ended");
          }
        }

        // 3. Notify friends that user is offline
        notifyFriendsOfStatusChange(io, userId, false);
      } catch (err) {
        log("disconnect_handler_error", { userId, message: err.message });
      }
    });

    socket.on("error", (error) => {
      log("socket_runtime_error", { userId, socketId: socket.id, message: error?.message });
    });
  });
}

module.exports = {
  registerSocketHandlers,
};
