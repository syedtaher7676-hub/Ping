const { users, rooms, getUserBySocketId, getUserById, recordMatchmakingTime, getMetrics,
  pendingFriendRequests, timeExtensionRequests, addFriendship, areFriends, getFriends, getFriendRoom, getCanonicalPairId, friendRooms,
  appendFriendRoomMessage, getFriendRoomMessages, createFriendRequest, acceptFriendRequest, rejectFriendRequest,
  getPendingRequestsFor, getExistingRequest, removeFriendRequest,
  checkSlidingWindowRateLimit, redisSetUser, redisGetUser, redisGetRoom, redisDeleteUser, purgeUserFromAllState, createFriendRoomEntry,
  addRecentPartnerLock, areRecentPartners, addTemporaryBan, isTemporaryBanned, temporaryBans,
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
const vpnDetector = require("../services/vpnDetector");
const { validateMessage } = require("../utils/moderation");
const { recordReport, isDeviceBanned, banDevice, linkDeviceAndIp } = require("../state/reports");
const {
  detectPhoneNumber,
  detectAskingForPhoneNumber,
  detectSocialMediaSharing,
  detectRestrictedSymbols,
  evaluateMessage,
  POLITE_MESSAGES
} = require("../utils/unifiedModerator");
const {
  recordMessageDelivered,
  recordViolationEvent
} = require("../services/behaviorAnalytics");
const {
  evaluateConversationTrajectory,
  getRoomRecentMessages,
  cleanupRoomTrajectory
} = require("../utils/conversationTrajectory");
const {
  ingestIncomingChatMessage,
  ingestReportedConversation
} = require("../services/modelTrainer");

// ═══════════════════════════════════════════════════════════════
// MULTI-TIER REAL-TIME MODERATION & FLOOD STATE STORES
// ═══════════════════════════════════════════════════════════════
const roomsMap = rooms; // Direct alias for rooms Map
const messageTimestamps = new Map();     // socketId -> array of message timestamps
const silencedSockets = new Map();       // socketId -> silence expiry timestamp (Date.now() + 10s)
const silenceViolationCounts = new Map(); // socketId -> continuous violation frequency
const recentReports = new Map();         // reporterId_reportedUserId -> timestamp of report

const exploreViolations = new Map();     // userId -> array of timestamps for Explore chat
const friendViolations = new Map();      // userId -> array of timestamps for Friends chat
const reportsByTarget = new Map();       // targetKey -> Array of { reporterId, reporterDeviceHash, reportedAt }
const rapidReportsByReporter = new Map(); // reporterKey -> Array of rapid report timestamps
const rapidBurstTimestamps = new Map();   // socketId -> Array of timestamps for rapid spam detection (10 msgs threshold)

// Link and URL detector for Telegram, Discord, NSFW, and general link spam
const URL_REGEX = /(https?:\/\/|www\d{0,3}\.|\.com\/|\.org\/|\.net\/|\.io\/|\.gg\/|\.xyz\/|\.me\/|t\.me\/|telegram\.me|discord\.gg|wa\.me|bit\.ly|tinyurl\.com|linktr\.ee|[a-z0-9-]+\.(com|net|org|io|gg|xyz|me|ru|cn|top|site|club|vip|online|live)\b)/i;

function hasBlockedLinks(text) {
  if (typeof text !== "string") return false;
  return URL_REGEX.test(text);
}

// ═══════════════════════════════════════════════════════════════
// 100K SCALE LOAD GOVERNOR, RAID DEFENSE & SHADOWBAN STATE
// ═══════════════════════════════════════════════════════════════
let globalSlowModeCooldownMs = 0; // 0 = off, 1000 = 1s, etc.
let raidShieldEnabled = false;
let blockExternalLinksEnabled = true;
const quarantinedCountries = new Set();
const shadowbannedEntities = new Map(); // target -> { reason, bannedAt, expiresAt }

function setGlobalSlowMode(seconds) {
  const secs = Math.max(0, Number(seconds) || 0);
  globalSlowModeCooldownMs = secs * 1000;
  return secs;
}

function getGlobalSlowMode() {
  return Math.round(globalSlowModeCooldownMs / 1000);
}

function setRaidShield(enabled) {
  raidShieldEnabled = Boolean(enabled);
  return raidShieldEnabled;
}

function isRaidShield() {
  return raidShieldEnabled;
}

function setBlockExternalLinks(enabled) {
  blockExternalLinksEnabled = Boolean(enabled);
  return blockExternalLinksEnabled;
}

function isBlockExternalLinks() {
  return blockExternalLinksEnabled;
}

function toggleCountryQuarantine(countryNameOrCode, shouldQuarantine) {
  if (!countryNameOrCode) return false;
  const key = String(countryNameOrCode).trim().toLowerCase();
  if (shouldQuarantine) {
    quarantinedCountries.add(key);
  } else {
    quarantinedCountries.delete(key);
  }
  return quarantinedCountries.has(key);
}

function isCountryQuarantined(countryStr) {
  if (!countryStr || quarantinedCountries.size === 0) return false;
  const s = String(countryStr).trim().toLowerCase();
  for (const q of quarantinedCountries) {
    if (s.includes(q)) return true;
  }
  return false;
}

function getQuarantinedCountries() {
  return Array.from(quarantinedCountries);
}

function addShadowban(target, durationMs = 24 * 3600 * 1000, reason = "Spam bot or persistent harassment") {
  if (!target) return false;
  const clean = String(target).trim();
  const now = Date.now();
  shadowbannedEntities.set(clean, {
    reason: String(reason || "Silent ghost quarantine").slice(0, 150),
    bannedAt: now,
    expiresAt: now + durationMs,
  });
  return true;
}

function removeShadowban(target) {
  if (!target) return false;
  const clean = String(target).trim();
  return shadowbannedEntities.delete(clean);
}

function isShadowbanned(userId, socket = null) {
  const now = Date.now();
  const candidates = [
    userId,
    socket?.id,
    socket?.data?.userId,
    socket?.data?.deviceHash,
    getSocketIp(socket),
  ].filter(Boolean);

  for (const c of candidates) {
    const entry = shadowbannedEntities.get(c);
    if (entry) {
      if (now >= entry.expiresAt) {
        shadowbannedEntities.delete(c);
      } else {
        return true;
      }
    }
  }
  return false;
}

function getAllShadowbans() {
  const now = Date.now();
  const list = [];
  for (const [target, meta] of shadowbannedEntities.entries()) {
    if (now >= meta.expiresAt) {
      shadowbannedEntities.delete(target);
    } else {
      const minutesLeft = Math.max(1, Math.ceil((meta.expiresAt - now) / 60000));
      list.push({
        target,
        reason: meta.reason,
        bannedAt: meta.bannedAt,
        expiresAt: meta.expiresAt,
        minutesLeft,
      });
    }
  }
  return list;
}

function calculateUserRiskScore(target) {
  if (!target) return { score: 0, tier: "Normal", reasons: [] };
  const reasons = [];
  let score = 0;

  // 1. Slur violation strikes (25 pts each)
  const exploreStrikes = (exploreViolations.get(target) || []).length;
  const friendStrikes = (friendViolations.get(target) || []).length;
  const totalStrikes = exploreStrikes + friendStrikes;
  if (totalStrikes > 0) {
    score += Math.min(50, totalStrikes * 25);
    reasons.push(`${totalStrikes} slur strike(s) (+${Math.min(50, totalStrikes * 25)} pts)`);
  }

  // 2. Target report flags (20 pts each)
  const flags = (reportsByTarget.get(target) || []).length;
  if (flags > 0) {
    score += Math.min(40, flags * 20);
    reasons.push(`${flags} community report(s) (+${Math.min(40, flags * 20)} pts)`);
  }

  // 3. Active ban
  if (typeof isDeviceBanned === "function" && isDeviceBanned(target) > 0) {
    score += 40;
    reasons.push(`Active device ban (+40 pts)`);
  }

  // 4. Active shadowban
  if (shadowbannedEntities.has(target)) {
    score += 35;
    reasons.push(`Ghost shadowban (+35 pts)`);
  }

  score = Math.min(100, Math.max(0, score));
  const tier = score < 30 ? "Normal" : (score < 70 ? "Guarded" : "Critical");
  return { score, tier, reasons };
}

function getSocketIp(socket) {
  if (!socket) return null;
  const headers = socket.handshake?.headers || {};
  let ip =
    headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    headers["cf-connecting-ip"] ||
    headers["x-real-ip"] ||
    headers["x-client-ip"] ||
    headers["x-forwarded-ip"] ||
    socket.handshake?.address ||
    socket.conn?.remoteAddress;
  if (typeof ip === "string" && ip.startsWith("::ffff:")) {
    ip = ip.substring(7);
  }
  return ip || null;
}

const exemptPartnerUsers = new Map(); // userId -> expiry timestamp
function markUserAsExemptPartner(userId, durationMs = 60000) {
  if (!userId) return;
  exemptPartnerUsers.set(userId, Date.now() + durationMs);
}

// Periodic background memory sweep for handler maps (prevents memory leak under long uptime & 10k CCU)
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of recentReports.entries()) {
    if (now - ts > 60000) recentReports.delete(key);
  }
  for (const [key, ts] of exemptPartnerUsers.entries()) {
    if (now >= ts) exemptPartnerUsers.delete(key);
  }
  for (const [socketId, expiry] of silencedSockets.entries()) {
    if (now >= expiry) {
      silencedSockets.delete(socketId);
      silenceViolationCounts.delete(socketId);
    }
  }
  for (const [key, list] of exploreViolations.entries()) {
    const active = list.filter(t => now - t <= 3600000);
    if (active.length === 0) exploreViolations.delete(key);
    else exploreViolations.set(key, active);
  }
  for (const [key, list] of friendViolations.entries()) {
    const active = list.filter(t => now - t <= 3600000);
    if (active.length === 0) friendViolations.delete(key);
    else friendViolations.set(key, active);
  }
}, 60000).unref();

function isUserBanned(socket, userId) {
  const now = Date.now();
  for (const [id, expiry] of temporaryBans.entries()) {
    if (now >= expiry) temporaryBans.delete(id);
  }
  for (const [id, exp] of exemptPartnerUsers.entries()) {
    if (now >= exp) exemptPartnerUsers.delete(id);
  }
  if (userId) {
    const userMinutesLeft = isDeviceBanned(userId);
    if (userMinutesLeft > 0) return { banned: true, remaining: userMinutesLeft * 60 * 1000 };
    if (temporaryBans.has(userId)) {
      const expiry = temporaryBans.get(userId);
      if (now < expiry) return { banned: true, remaining: expiry - now };
    }
    const penalty = slurFilter.getActivePenalty(userId);
    if (penalty && penalty.type === "ban_15min" && now < penalty.expiresAt) {
      temporaryBans.set(userId, penalty.expiresAt);
      addTemporaryBan(userId, penalty.expiresAt - now);
      return { banned: true, remaining: penalty.expiresAt - now };
    }
  }
  const deviceHash = socket?.data?.deviceHash;
  if (deviceHash) {
    const minutesLeft = isDeviceBanned(deviceHash);
    if (minutesLeft > 0) return { banned: true, remaining: minutesLeft * 60 * 1000 };
    if (temporaryBans.has(deviceHash)) {
      const expiry = temporaryBans.get(deviceHash);
      if (now < expiry) return { banned: true, remaining: expiry - now };
    }
  }
  const isExempt = userId && exemptPartnerUsers.has(userId);
  if (!isExempt) {
    const ip = getSocketIp(socket);
    if (ip && ip !== "127.0.0.1" && ip !== "::1" && ip !== "localhost") {
      if (temporaryBans.has(ip) && now < temporaryBans.get(ip)) {
        return { banned: true, remaining: temporaryBans.get(ip) - now };
      }
      const ipPenalty = slurFilter.getActivePenalty(ip) || slurFilter.getActivePenalty(`ip_${ip}`);
      if (ipPenalty && ipPenalty.type === "ban_15min" && now < ipPenalty.expiresAt) {
        temporaryBans.set(ip, ipPenalty.expiresAt);
        addTemporaryBan(ip, ipPenalty.expiresAt - now);
        return { banned: true, remaining: ipPenalty.expiresAt - now };
      }
    }
  }
  return { banned: false };
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
  let currentUser = users.get(userId);
  if (!currentUser) {
    currentUser = {
      id: userId,
      socketId: socket.id,
      status: "idle",
      roomId: null,
      joinedAt: Date.now(),
      country: socket.data?.country || "Someone nearby",
      lastHeartbeat: Date.now(),
      isActive: true,
    };
    users.set(userId, currentUser);
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

function deliverMessage(io, socket, userId, roomId, finalMessage, replyToContext, throttleDelay, ack, msgId, isFlash) {
  if (global.recordMessageSent) {
    global.recordMessageSent();
  }
  recordMessageDelivered(finalMessage);
  const deliverFn = () => {
    if (socket && !socket.rooms.has(roomId)) {
      socket.join(roomId);
    }
    const room = rooms.get(roomId);
    if (!room || room.status !== "active") return;
    room.messageCount = (room.messageCount || 0) + 1;

    // Ghost Moderation (Shadowban): deliver back to sender only
    if (isShadowbanned(userId, socket)) {
      socket.emit("new_message", {
        from: userId,
        message: finalMessage,
        replyTo: replyToContext,
        sentAt: Date.now(),
        roomId,
        msgId,
        isFlash,
      });
      if (typeof ack === "function" && throttleDelay === 0) {
        ack({ ok: true, success: true, roomId, msgId, sentAt: Date.now() });
      }
      return;
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
    if (typeof ack === "function" && throttleDelay === 0) {
      ack({ ok: true, success: true, roomId, msgId, sentAt: Date.now() });
    }
  };
  if (throttleDelay > 0) {
    setTimeout(deliverFn, throttleDelay);
    if (typeof ack === "function") ack({ ok: true, success: true, roomId, msgId, sentAt: Date.now(), throttled: true });
  } else {
    deliverFn();
  }
}

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

function getViolationCount(userId, isDm) {
  const store = isDm ? friendViolations : exploreViolations;
  const list = store.get(userId) || [];
  const windowStart = Date.now() - 3600000;
  const active = list.filter(t => t > windowStart);
  store.set(userId, active);
  return active.length;
}

function addViolation(userId, isDm) {
  const store = isDm ? friendViolations : exploreViolations;
  const list = store.get(userId) || [];
  const now = Date.now();
  const windowStart = now - 3600000;
  const active = list.filter(t => t > windowStart);
  active.push(now);
  store.set(userId, active);
  return active.length;
}

let isEmergencyStrictModeEnabled = false;

function setEmergencyStrictMode(val) {
  isEmergencyStrictModeEnabled = Boolean(val);
}

function isEmergencyStrictMode() {
  return isEmergencyStrictModeEnabled;
}

// 1st Offense etc.
function handleInappropriateViolation(socket, io, userId, reason, text, roomId, isDm, ack) {
  const ip = getSocketIp(socket);
  const violationCount = addViolation(userId, isDm);
  const maxLimit = isEmergencyStrictModeEnabled ? 1 : (isDm ? 5 : 3);

  spamStore.addSpamViolation({
    userId,
    type: "bad_language_blocked",
    message: text.slice(0, 50),
    violationCount,
    reason,
  });

  securityStore.addSecurityLog("bad_language_violation", {
    userId,
    message: text.slice(0, 100),
    violationCount,
    reason,
    ip,
    severity: violationCount >= maxLimit ? "critical" : violationCount >= 2 ? "high" : "medium",
  });

  // User Requirement: Remove the 3-warning to 15-minute ban.
  // Just don't send the message, but give the offender a nice label stating: "Please don't use bad words here"
  const warnMsg = "⚠️ Please don't use bad words here 🙏";
  const labelText = "Please don't use bad words here";

  socket.emit("warning_message", {
    message: warnMsg,
    label: labelText,
    type: "bad_words_label",
    violationCount,
  });
  socket.emit("message_rejected", {
    message: warnMsg,
    label: labelText,
    reason: "bad_words_blocked",
    violationCount,
  });

  if (typeof ack === "function") {
    ack({
      ok: false,
      success: false,
      reason: "bad_words_blocked",
      message: warnMsg,
      label: labelText,
      violationCount,
    });
  }

  // Persist moderation action to Cloud Firestore without applying a ban
  dbService.saveModerationLog({
    userId,
    type: `bad_words_blocked_${violationCount}`,
    message: warnMsg,
    action: "blocked_label",
    violationCount,
    severity: "info",
  }).catch(() => {});

  return { blocked: true, action: "blocked_label", label: labelText, message: warnMsg };
}

// Shared message validation (slur filter, moderation, spam, trajectory, self-training)
function validateAndModerateMessage(socket, userId, text, roomId = null, partnerId = null) {
  const now = Date.now();
  if (!roomId) {
    roomId = users.get(userId)?.roomId || null;
  }
  if (!partnerId && roomId) {
    partnerId = rooms.get(roomId)?.users?.find(id => id !== userId) || null;
  }

  // 0. High-Scale Slow Mode Check
  if (globalSlowModeCooldownMs > 0) {
    const lastMsgTime = socket.data?.lastMessageTime || 0;
    if (now - lastMsgTime < globalSlowModeCooldownMs) {
      const waitSec = Math.ceil((globalSlowModeCooldownMs - (now - lastMsgTime)) / 1000);
      const msg = `⏳ Slow Mode is active: Please wait ${waitSec}s between messages.`;
      socket.emit("error_message", { message: msg });
      if (global.recordViolationIntercepted) global.recordViolationIntercepted();
      return { blocked: true, reason: "slow_mode_active", action: "block", message: msg };
    }
  }

  // 0.1 High-Scale Raid Shield Defense
  if (raidShieldEnabled) {
    const lastText = socket.data?.lastMessageText;
    if (lastText && lastText === text && (now - (socket.data?.lastMessageTime || 0) < 15000)) {
      const msg = "🛡️ Raid Shield: Duplicate repetitive broadcast message blocked.";
      socket.emit("error_message", { message: msg });
      if (global.recordViolationIntercepted) global.recordViolationIntercepted();
      return { blocked: true, reason: "raid_shield_duplicate", action: "block", message: msg };
    }
  }

  // 0.2 Advanced 2028-30 Conversation Trajectory & Recipient Comfort Engine
  if (roomId) {
    const trajectoryResult = evaluateConversationTrajectory(roomId, userId, text, partnerId);
    if (!trajectoryResult.allowed) {
      const labelText = trajectoryResult.label || POLITE_MESSAGES.COERCION_GROOMING;
      log("message_blocked_trajectory", { userId, roomId, reason: trajectoryResult.reason, category: trajectoryResult.category });
      // Emit single message_rejected event with clean label (no duplicate toasts or alert popups)
      socket.emit("message_rejected", {
        message: labelText,
        label: labelText,
        reason: trajectoryResult.reason,
        category: trajectoryResult.category || "trajectory_violation",
        action: "block"
      });
      if (global.recordViolationIntercepted) global.recordViolationIntercepted();
      recordViolationEvent({
        type: trajectoryResult.reason,
        userId,
        deviceHash: socket.data?.deviceHash,
        country: socket.data?.country,
        snippet: text,
        action: "Blocked / Trajectory",
        severity: "warning",
      });
      ingestIncomingChatMessage(userId, text, roomId, true, trajectoryResult.category || "trajectory_violation");
      return { blocked: true, reason: trajectoryResult.reason, action: "block", message: labelText, label: labelText, category: trajectoryResult.category };
    }
  }

  // Update socket rate-tracker state
  if (socket) {
    if (!socket.data) socket.data = {};
    socket.data.lastMessageTime = now;
    socket.data.lastMessageText = text;
  }

  // 1. Unified 2030 Moderation Evaluation (Phone, Social, Links, Symbols, Slurs, Coercion, Low-effort)
  const evalResult = evaluateMessage(text);
  if (!evalResult.valid) {
    const labelText = evalResult.label || POLITE_MESSAGES.BAD_WORDS_PLAIN;
    log("message_blocked_unified", { userId, category: evalResult.category, reason: evalResult.reason });
    // Emit single message_rejected event with clean label (suppressing duplicate toasts or alerts)
    socket.emit("message_rejected", {
      message: labelText,
      label: labelText,
      reason: evalResult.reason,
      category: evalResult.category,
      action: "block"
    });
    if (global.recordViolationIntercepted) global.recordViolationIntercepted();
    recordViolationEvent({
      type: evalResult.category || evalResult.reason || "content_moderated",
      category: evalResult.category,
      userId,
      deviceHash: socket.data?.deviceHash,
      country: socket.data?.country,
      snippet: text,
      action: "Blocked / In-Chat Label",
      severity: "info",
      matchedWords: evalResult.matchedWords || [],
    });
    ingestIncomingChatMessage(userId, text, roomId, true, evalResult.category || "moderation_blocked");
    return { blocked: true, reason: evalResult.reason, action: "block", message: labelText, label: labelText, category: evalResult.category };
  }

  // Self-training continuous learning on approved healthy message
  ingestIncomingChatMessage(userId, text, roomId, false, "safe_conversation");

  return { blocked: false, finalMessage: text };
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

function broadcastOnlineMetrics(io) {
  if (!io) return;
  const metrics = getMetrics(io);
  io.emit("onlineCount", metrics.activeUsers);
  io.emit("count", metrics.activeUsers);
}

function registerSocketHandlers(io, getCountryFromSocket) {
  // Frequent metrics broadcast every 3 seconds for real-time online count sync
  const metricsInterval = setInterval(() => {
    broadcastOnlineMetrics(io);
  }, 3000);
  metricsInterval.unref();

  // Cleanup inactive users
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [userId, user] of users.entries()) {
      if (!user.isActive && now - (user.lastDisconnect || user.lastHeartbeat) > HEARTBEAT_TIMEOUT_MS) {
        log("user_inactive_timeout", { userId });
        
        const origStatus = user.status;
        const origRoomId = user.roomId;
        const socketId = user.socketId;

        // Clean up the active match room before purging/deleting the user from memory
        if (origStatus === "matched" && origRoomId) {
          const room = rooms.get(origRoomId);
          if (room && room.type !== "friend_dm") {
            terminateSession(io, origRoomId, "heartbeat_timeout");
          }
        } else if (origStatus === "waiting") {
          leaveWaitingQueue(userId);
        }

        purgeUserFromAllState(userId, socketId);
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

    // Admin room subscription for real-time telemetry streaming
    socket.on("join_admin", () => {
      socket.join("admin");
    });
    socket.on("admin_join", () => {
      socket.join("admin");
    });
    socket.on("leave_admin", () => {
      socket.leave("admin");
    });
    socket.on("admin_rejoin", async (rawPayload, ack) => {
      try {
        const payload = safeObject(rawPayload);
        const token = safeString(payload.token);
        if (!token) {
          if (typeof ack === "function") ack({ ok: false });
          return;
        }
        let isValid = false;
        const { isRedisReady, redisClient } = require("../state/store");
        if (typeof isRedisReady === "function" && isRedisReady()) {
          try {
            const cached = await redisClient.get(`ping:admin_session:${token}`);
            if (cached) {
              const session = JSON.parse(cached);
              if (session && Date.now() <= session.expiresAt) {
                isValid = true;
              }
            }
          } catch {}
        }
        if (!isValid && global.adminSessionsMap && global.adminSessionsMap.has(token)) {
          const session = global.adminSessionsMap.get(token);
          if (session && Date.now() <= session.expiresAt) {
            isValid = true;
          }
        }

        if (isValid) {
          socket.join("admin");
          if (typeof ack === "function") ack({ ok: true, success: true });
        } else {
          if (typeof ack === "function") ack({ ok: false, error: "expired" });
        }
      } catch (err) {
        if (typeof ack === "function") ack({ ok: false });
      }
    });

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

          // Migrate any friendships from old guest session to new authenticated user ID
          const oldFriends = getFriends(oldUserId);
          if (Array.isArray(oldFriends) && oldFriends.length > 0) {
            for (const fId of oldFriends) {
              addFriendship(authUserId, fId);
              addFriendship(fId, authUserId);
              dbService.saveFriendship(authUserId, fId).catch(() => {});
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
          // Persist all current friendships to Firestore
          const allFriends = getFriends(authUserId);
          if (Array.isArray(allFriends)) {
            for (const fId of allFriends) {
              dbService.saveFriendship(authUserId, fId).catch(() => {});
            }
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

    socket.on("logout_user", (rawPayload, ack) => {
      try {
        const payload = safeObject(rawPayload);
        const newGuestId = safeId(payload.newGuestId) || `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const oldUserId = userId;
        log("user_logout", { oldUserId, newGuestId });
        socket.leave(`user_${oldUserId}`);
        userId = newGuestId;
        socket.join(`user_${newGuestId}`);

        const newGuestUser = {
          id: newGuestId,
          socketId: socket.id,
          country: user?.country || "Global",
          status: "idle",
          roomId: null,
          joinedAt: Date.now(),
          lastActionAt: Date.now(),
          totalMatches: 0,
          isAuthenticated: false,
        };
        users.set(newGuestId, newGuestUser);
        emitState(socket, newGuestUser);

        if (typeof ack === "function") {
          ack({ success: true, guestId: newGuestId });
        }
      } catch (err) {
        log("logout_user_error", { userId, error: err?.message });
        if (typeof ack === "function") {
          ack({ success: false });
        }
      }
    });

    /* [DISABLED FOR LEAN MVP LAUNCH] Secondary Settings Handler: update_username
    socket.on("update_username", async (rawPayload, ack) => {
      try {
        const payload = safeObject(rawPayload);
        const username = safeString(payload.username, 30);
        if (!username) {
          if (typeof ack === "function") ack({ ok: false, reason: "invalid_username" });
          return;
        }
        user.username = username;
        if (user.profile) {
          user.profile.displayName = username;
        } else {
          user.profile = { displayName: username };
        }
        users.set(userId, user);
        if (typeof redisSetUser === "function") {
          redisSetUser(userId, user).catch(() => {});
        }
        dbService.updateUserProfile(userId, { username, displayName: username }).catch(() => {});
        if (typeof ack === "function") ack({ ok: true, username });
      } catch (err) {
        if (typeof ack === "function") ack({ ok: false });
      }
    });
    */

    // Asynchronously fetch user profile upon connection (friends sync disabled for lean MVP)
    dbService.syncUserOnAuth(userId, { country: user.country }).then(async (profile) => {
      if (profile) {
        user.profile = profile;
        if (typeof profile.totalMatches === "number") {
          user.totalMatches = profile.totalMatches;
        }
        userStore.setUserData(userId, profile);
      }
      /* [DISABLED FOR LEAN MVP LAUNCH] Persistent friends sync
      const persistentFriends = await dbService.getUserFriends(userId);
      if (Array.isArray(persistentFriends) && persistentFriends.length > 0) {
        persistentFriends.forEach((f) => {
          if (f.friendId && !areFriends(userId, f.friendId)) {
            addFriendship(userId, f.friendId);
          }
        });
      }
      */
    }).catch(() => {});

    socket.emit("self", { userId, country: user.country, isNewUser });
    emitState(socket, user);

    log(isNewUser ? "user_connected" : "user_reconnected", {
      userId, socketId: socket.id, activeUsers: users.size,
    });
    if (typeof global.broadcastUserAction === "function") {
      global.broadcastUserAction(
        isNewUser ? "connect_new" : "reconnect",
        userId,
        user.country || "Someone nearby",
        isNewUser ? "New visitor session started" : "Returning visitor reconnected",
        "👋"
      );
    }

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

    socket.on("start_chat", async (rawPayload) => {
      try {
        if (!socket.connected) return;
        const payload = safeObject(rawPayload);
        const rawInterests = Array.isArray(payload.interests) ? payload.interests : [];
        const validTags = ["movies", "music", "gaming", "tech", "studies", "sports", "food", "travel"];
        const interests = rawInterests.filter(tag => typeof tag === "string" && validTags.includes(tag.toLowerCase()));

        let currentUser = users.get(userId);
        if (!currentUser) {
          currentUser = {
            id: userId,
            socketId: socket.id,
            status: "idle",
            roomId: null,
            joinedAt: Date.now(),
            lastStartChatAt: 0,
            lastMessageAt: 0,
            lastActionAt: 0,
            country: socket.data?.country || "Someone nearby",
            lastHeartbeat: Date.now(),
            isActive: true,
          };
          users.set(userId, currentUser);
        }

        currentUser.interests = interests;

        // Verify if user or IP is currently in a 15-minute ban cooldown
        const banCheck = isUserBanned(socket, userId);
        if (banCheck.banned) {
          const banExpiresAt = Date.now() + banCheck.remaining;
          socket.emit("chat_ended_banned", {
            isOffender: true,
            message: "⚠️ You are banned for bad behavior. Please wait before chatting again.",
            banExpiresAt,
            remainingMs: banCheck.remaining
          });
          return;
        }

        // Check VPN / Proxy detection if VPN shield is active
        if (vpnDetector.isVpnShieldEnabled() && socket.data?.isVpn) {
          const vpnMsg = "VPN or Proxy Detected. Ping requires a direct residential connection to prevent abusive multi-accounting. Please turn off your VPN/proxy to connect.";
          socket.emit("vpn_detected", {
            message: vpnMsg,
            details: socket.data?.vpnDetails?.details || {},
          });
          socket.emit("error_message", { message: vpnMsg });
          return;
        }

        // If user was recorded in a room that is inactive, ended, or not an active friend DM, cleanly reset room state
        if (currentUser.roomId) {
          const room = rooms.get(currentUser.roomId);
          if (!room || room.status !== "active" || room.type !== "friend_dm") {
            try { socket.leave(currentUser.roomId); } catch (_) {}
            currentUser.roomId = null;
            currentUser.status = "idle";
          }
        } else {
          currentUser.status = "idle";
        }

        // Clean any old waiting queue entry
        leaveWaitingQueue(userId);

        const now = Date.now();
        currentUser.lastStartChatAt = now;
        currentUser.lastActionAt = now;
        currentUser.isActive = true;
        if (typeof redisSetUser === "function") {
          redisSetUser(userId, currentUser).catch(() => {});
        }
        queueUserForMatch(socket, io, userId);
        if (typeof global.broadcastUserAction === "function") {
          global.broadcastUserAction(
            "search_partner",
            userId,
            currentUser.country || "Someone nearby",
            interests.length > 0 ? `Queued searching [${interests.join(", ")}]` : "Queued searching random partner",
            "🔍"
          );
        }
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

        // ═══════════════════════════════════════════════════════════════
        // MESSAGE RATE LIMITING:
        // - Max 3 messages per 2 seconds
        // - Auto-disconnect on 10 rapid messages within 5s
        // ═══════════════════════════════════════════════════════════════
        let rapidTimes = rapidBurstTimestamps.get(socket.id) || [];
        rapidTimes = rapidTimes.filter(t => (now - t) < 5000);
        rapidTimes.push(now);
        rapidBurstTimestamps.set(socket.id, rapidTimes);

        if (rapidTimes.length >= 10) {
          log("user_auto_disconnected_for_rapid_spam", { userId, socketId: socket.id, count: rapidTimes.length });
          socket.emit("error_message", { message: "🚫 Disconnected due to rapid message spamming." });
          terminateSession(io, currentUser.roomId, "spam_disconnected");
          try { socket.disconnect(true); } catch (_) {}
          if (typeof ack === "function") ack({ ok: false, reason: "spam_disconnected" });
          return;
        }

        // Check if silenced due to spam
        const silenceEndTime = silencedSockets.get(socket.id);
        if (silenceEndTime && now < silenceEndTime) {
          const remaining = Math.ceil((silenceEndTime - now) / 1000);
          socket.emit("error_message", { message: `⏳ You are silenced! Please wait ${remaining}s before sending messages.` });
          if (typeof ack === "function") ack({ ok: false, reason: "silenced" });
          return;
        }

        // Track and check message rate (< 2000ms window, max 3 messages)
        let userTimes = messageTimestamps.get(socket.id) || [];
        userTimes = userTimes.filter(t => now - t < 2000);
        userTimes.push(now);
        messageTimestamps.set(socket.id, userTimes);

        if (userTimes.length > 3) {
          silencedSockets.set(socket.id, now + 5000); // 5 seconds silence
          const vCount = (silenceViolationCounts.get(socket.id) || 0) + 1;
          silenceViolationCounts.set(socket.id, vCount);
          log("socket_rate_limited_and_silenced", { userId, socketId: socket.id, count: userTimes.length, vCount });

          socket.emit("error_message", { message: "⏳ Slow down! Maximum 3 messages per 2 seconds allowed." });
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

        // 1. Check if user or IP is currently banned
        const banCheck = isUserBanned(socket, userId);
        if (banCheck.banned) {
          const mins = Math.max(1, Math.ceil(banCheck.remaining / 60000));
          const msg = `🚫 You are banned from chatting for another ${mins} minute(s).`;
          socket.emit("error_message", { message: msg });
          if (typeof ack === "function") ack({ ok: false, reason: "banned", message: msg, remainingMs: banCheck.remaining });
          return;
        }

        if (text.length > MAX_MESSAGE_LENGTH) {
          socket.emit("error_message", { message: `✂️ message too long! keep it under ${MAX_MESSAGE_LENGTH} chars bestie` });
          if (typeof ack === "function") ack({ ok: false, reason: "message_too_long" });
          return;
        }

        // 2. Validate and moderate message (handles phone, social, symbols, slurs, trajectory, low effort)
        const activeRoom = rooms.get(currentUser.roomId);
        const partnerId = activeRoom?.users?.find(id => id !== userId);
        const modResult = validateAndModerateMessage(socket, userId, text, currentUser.roomId, partnerId);
        if (modResult.blocked) {
          if (typeof ack === "function") ack({ ok: false, success: false, reason: modResult.reason, action: modResult.action, message: modResult.message, label: modResult.label || "Please don't use bad words here" });
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
    //  [DISABLED FOR LEAN MVP LAUNCH] SEND DM (friend chat)
    // ═══════════════════════════════════════════════
    /*
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

        const now = Date.now();
        // Rate limit for DMs (max 3 per 2s, auto-disconnect on 10 rapid)
        let dmRapidTimes = rapidBurstTimestamps.get(socket.id) || [];
        dmRapidTimes = dmRapidTimes.filter(t => (now - t) < 5000);
        dmRapidTimes.push(now);
        rapidBurstTimestamps.set(socket.id, dmRapidTimes);

        if (dmRapidTimes.length >= 10) {
          socket.emit("error_message", { message: "🚫 Disconnected due to rapid message spamming." });
          try { socket.disconnect(true); } catch (_) {}
          if (typeof ack === "function") ack({ ok: false, success: false, reason: "spam_disconnected" });
          return;
        }

        let dmUserTimes = messageTimestamps.get(socket.id) || [];
        dmUserTimes = dmUserTimes.filter(t => now - t < 2000);
        dmUserTimes.push(now);
        messageTimestamps.set(socket.id, dmUserTimes);

        if (dmUserTimes.length > 3) {
          socket.emit("error_message", { message: "⏳ Slow down! Maximum 3 messages per 2 seconds allowed." });
          if (typeof ack === "function") ack({ ok: false, success: false, reason: "rate_limited" });
          return;
        }

        // 1. Check if user or IP is currently banned
        const banCheck = isUserBanned(socket, userId);
        if (banCheck.banned) {
          const mins = Math.max(1, Math.ceil(banCheck.remaining / 60000));
          const msg = `🚫 You are banned from chatting for another ${mins} minute(s).`;
          socket.emit("error_message", { message: msg });
          if (typeof ack === "function") ack({ ok: false, success: false, reason: "banned", message: msg, remainingMs: banCheck.remaining });
          return;
        }

        if (text.length > MAX_MESSAGE_LENGTH) {
          socket.emit("error_message", { message: `✂️ message too long! keep it under ${MAX_MESSAGE_LENGTH} chars bestie` });
          if (typeof ack === "function") ack({ ok: false, success: false, reason: "message_too_long" });
          return;
        }

        // 2. Validate and moderate message (handles phone, social, symbols, slurs, low effort)
        const modResult = validateAndModerateMessage(socket, userId, text);
        if (modResult.blocked) {
          if (modResult.reason === "slur_blocked") {
            handleInappropriateViolation(socket, io, userId, "slur_blocked", text, roomId, true, ack);
            return;
          }
          if (typeof ack === "function") ack({ ok: false, success: false, reason: modResult.reason, action: modResult.action, message: modResult.message });
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

        // 3. Emit 'new_dm' to shared conversation room
        io.to(roomId).emit("new_dm", dmPayload);

        // 4. Emit 'friend_dm_notification' to friend's personal socket room
        const notificationPayload = {
          ...dmPayload,
          friendId: userId,
          friendCountry: currentUser.country || "Someone nearby",
        };
        io.to(`user_${partnerId}`).emit("friend_dm_notification", notificationPayload);

        // 5. Positive confirmation callback ack({ success: true, message: dmPayload })
        if (typeof ack === "function") {
          ack({ ok: true, success: true, roomId, sentAt, msgId, message: dmPayload });
        }
      } catch (err) {
        log("send_dm_error", { userId, message: err.message });
        if (typeof ack === "function") ack({ ok: false, success: false, reason: "internal_error" });
      }
    });
    */

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

    /* [DISABLED FOR LEAN MVP LAUNCH] SECONDARY HANDLER: edit_dm
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

        const slurCheck = slurFilter.detectSlurWithContext(newMessage);
        if (slurCheck.hasSlur) {
          handleInappropriateViolation(socket, io, userId, "slur_edited", newMessage, roomId, true, ack);
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
    */

    socket.on("edit_message", (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const roomId = safeId(payload.roomId);
        const msgId = safeId(payload.msgId) || safeString(payload.msgId, 64);
        const newMessage = safeString(payload.newMessage, MAX_MESSAGE_LENGTH);

        if (!roomId || !msgId || !newMessage) return;

        const slurCheck = slurFilter.detectSlurWithContext(newMessage);
        if (slurCheck.hasSlur) {
          handleInappropriateViolation(socket, io, userId, "slur_edited", newMessage, roomId, false);
          return;
        }

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

    socket.on("react_message", (rawPayload) => {
      try {
        const payload = safeObject(rawPayload);
        const roomId = safeId(payload.roomId);
        const msgId = safeId(payload.msgId) || safeString(payload.msgId, 64);
        const emoji = safeString(payload.emoji, 16);

        if (!roomId || !msgId || !emoji) return;
        const room = rooms.get(roomId) || Array.from(friendRooms.values()).find(r => r.roomId === roomId);
        const members = room?.users || room?.userIds || [];
        if (room && members.includes(userId)) {
          io.to(roomId).emit("message_reaction", { msgId, emoji, fromUserId: userId, roomId });
        }
      } catch (err) {
        log("react_message_error", { userId, message: err.message });
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
    //  [DISABLED FOR LEAN MVP LAUNCH] FRIEND SYSTEM & SECONDARY HANDLERS
    // ═══════════════════════════════════════════════
    /*
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

    socket.on("get_user_chats", async (ack) => {
      try {
        const chats = await dbService.getUserConversations(userId);
        if (typeof ack === "function") ack({ success: true, chats: chats || [] });
        else socket.emit("user_chats_list", { chats: chats || [] });
      } catch (err) {
        log("get_user_chats_error", { userId, message: err?.message });
        if (typeof ack === "function") ack({ success: false, chats: [] });
      }
    });

    socket.on("get_chat_transcript", async (rawPayload, ack) => {
      try {
        const payload = safeObject(rawPayload);
        const chatId = safeId(payload.chatId);
        if (!chatId) {
          if (typeof ack === "function") ack({ success: false, messages: [] });
          return;
        }
        const messages = await dbService.getFriendChatMessages(chatId, 100);
        if (typeof ack === "function") ack({ success: true, chatId, messages: messages || [] });
      } catch (err) {
        log("get_chat_transcript_error", { userId, message: err?.message });
        if (typeof ack === "function") ack({ success: false, messages: [] });
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
    */

    // ═══════════════════════════════════════════════
    //  NAVIGATION & EXPLORE ROOM RE-JOIN
    // ═══════════════════════════════════════════════

    socket.on('rejoin_explore_room', async (payload, callback) => {
      try {
        const roomId = safeId(payload?.roomId) || (typeof payload === 'string' ? safeId(payload) : null);
        let room = roomsMap.get(roomId) || rooms.get(roomId);
        if (!room && typeof redisGetRoom === "function") {
          room = await redisGetRoom(roomId);
        }
        const isMember = room && (
          (Array.isArray(room.users) && (
            room.users.includes(socket.id) ||
            room.users.includes(userId) ||
            (socket.data && room.users.includes(socket.data.userId))
          )) ||
          user?.roomId === roomId
        );

        if (room && isMember) {
          socket.join(roomId);
          socket.data.currentRoomId = roomId;
          if (user) {
            user.roomId = roomId;
            user.status = "matched";
          }
          if (room.disconnectTimeoutRef) {
            clearTimeout(room.disconnectTimeoutRef);
            room.disconnectTimeoutRef = null;
          }
          const partnerId = room.users?.find(id => id !== userId);
          const partnerUser = partnerId ? users.get(partnerId) : null;
          if (partnerUser?.socketId) {
            const partnerSocket = io.sockets.sockets.get(partnerUser.socketId);
            partnerSocket?.emit("partner_reconnected", { roomId });
          }
          const remainingMs = Math.max(0, (room.endAt || 0) - Date.now());
          io.to(roomId).emit("timer_sync", {
            roomId,
            endAt: room.endAt,
            remainingMs,
          });
          callback?.({ success: true, ok: true, endAt: room.endAt, remainingMs });
        } else {
          callback?.({ success: false, ok: false, reason: 'Room expired or invalid' });
        }
      } catch (err) {
        log("rejoin_explore_room_error", { userId, error: err?.message });
        callback?.({ success: false, ok: false, reason: 'Internal error' });
      }
    });

    socket.on("left_screen", (rawPayload = {}) => {
      try {
        // Per requirement: when a user just leaves a screen, do NOT implement the 15sec timer.
        // The 15sec timer/disconnect grace period only runs when the user exits the application completely (disconnect).
      } catch (err) {
        log("left_screen_error", { userId, error: err?.message });
      }
    });

    socket.on("returned_to_screen", (rawPayload = {}, ack) => {
      try {
        const payload = safeObject(rawPayload);
        const roomId = safeId(payload.roomId) || user?.roomId;
        const cb = typeof ack === "function" ? ack : (typeof payload.callback === "function" ? payload.callback : null);

        if (!roomId) {
          cb?.({ success: false, ok: false, reason: "no_room" });
          socket.emit("chat_ended", { reason: "stranger_disconnected", rawReason: "room_closed", message: "Chat ended" });
          return;
        }

        const room = rooms.get(roomId);
        if (!room || room.status !== "active") {
          cb?.({ success: false, ok: false, reason: "room_not_active" });
          socket.emit("chat_ended", { reason: "stranger_disconnected", rawReason: "room_closed", message: "Chat ended" });
          if (user) {
            user.status = "idle";
            user.roomId = null;
          }
          return;
        }

        if (user) {
          user.status = "matched";
          user.roomId = roomId;
        }

        if (!socket.rooms.has(roomId)) {
          socket.join(roomId);
        }

        if (room.disconnectTimeoutRef) {
          clearTimeout(room.disconnectTimeoutRef);
          room.disconnectTimeoutRef = null;
        }

        const partnerId = room.users?.find(id => id !== userId);
        const partnerUser = partnerId ? users.get(partnerId) : null;
        if (partnerUser?.socketId) {
          const partnerSocket = io.sockets.sockets.get(partnerUser.socketId);
          partnerSocket?.emit("partner_reconnected", { roomId });
        }

        // Authoritative 3-minute timer sync according to session length
        const remainingMs = Math.max(0, (room.endAt || 0) - Date.now());
        io.to(roomId).emit("timer_sync", {
          roomId,
          endAt: room.endAt,
          remainingMs,
        });

        cb?.({ success: true, ok: true, endAt: room.endAt, remainingMs });
      } catch (err) {
        log("returned_to_screen_error", { userId, error: err?.message });
      }
    });

    socket.on("next_chat", (rawPayload = {}) => {
      try {
        const payload = safeObject(rawPayload);
        const autoStart = safeBoolean(payload.autoStart, false);
        const rawInterests = Array.isArray(payload.interests) ? payload.interests : [];
        const validTags = ["movies", "music", "gaming", "tech", "studies", "sports", "food", "travel"];
        const interests = rawInterests.filter(tag => typeof tag === "string" && validTags.includes(tag.toLowerCase()));

        const currentUser = users.get(userId);
        if (!currentUser) return;

        if (interests.length > 0) {
          currentUser.interests = interests;
        }

        currentUser.lastActionAt = Date.now();

        if (currentUser.status === "matched" && currentUser.roomId) {
          const targetRoomId = currentUser.roomId;
          const activeRoom = rooms.get(targetRoomId);

          if (activeRoom && Array.isArray(activeRoom.users) && activeRoom.users.length >= 2) {
            if (typeof addRecentPartnerLock === "function") {
              addRecentPartnerLock(activeRoom.users[0], activeRoom.users[1]);
            }
          }

          // Resolve partner before termination
          const partnerId = activeRoom?.users?.find(id => id !== userId);
          const partnerUser = partnerId ? users.get(partnerId) : null;

          // Terminate session cleanly (terminateSession will broadcast chat_ended once to the room and leave sockets)
          terminateSession(io, targetRoomId, "next_clicked");
          if (typeof global.broadcastUserAction === "function") {
            global.broadcastUserAction(
              "skip_partner",
              userId,
              currentUser.country || "Someone nearby",
              "User skipped current conversation partner",
              "⏭️"
            );
          }

          // Reset user and partner states synchronously
          currentUser.status = "idle";
          currentUser.roomId = null;
          if (typeof redisSetUser === "function") {
            redisSetUser(userId, currentUser).catch(() => {});
          }

          if (partnerUser) {
            partnerUser.status = "idle";
            partnerUser.roomId = null;
            if (typeof redisSetUser === "function") {
              redisSetUser(partnerId, partnerUser).catch(() => {});
            }
          }

          // Do NOT auto-queue users when skip is used — let both users return to prechat view to click Start Chat
          if (autoStart) {
            queueUserForMatch(socket, io, userId);
          }
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
        let endAt = null;
        let remainingMs = null;
        if (currentUser?.roomId) {
          const room = rooms.get(currentUser.roomId);
          if (room && room.status === "active") {
            endAt = room.endAt || null;
            remainingMs = endAt ? Math.max(0, endAt - Date.now()) : null;
          }
        }
        if (typeof ack === "function") {
          ack({
            status: currentUser?.status || "idle",
            roomId: currentUser?.roomId || null,
            joinedAt: currentUser?.joinedAt || null,
            endAt,
            remainingMs,
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

    socket.on("get_online_count", (_rawPayload, ack) => {
      try {
        const metrics = getMetrics(io);
        const count = metrics.activeUsers;
        if (typeof ack === "function") ack(count);
        socket.emit("onlineCount", count);
        socket.emit("count", count);
      } catch (err) {
        log("get_online_count_error", { userId, message: err.message });
      }
    });

    socket.on("get_metrics", (_rawPayload, ack) => {
      try {
        if (typeof ack === "function") ack(getMetrics(io));
      } catch (err) {
        log("get_metrics_error", { userId, message: err.message });
      }
    });

    socket.on("get_stats", (_rawPayload, ack) => {
      try {
        const currentUser = users.get(userId);
        const metrics = getMetrics(io);
        const statsPayload = {
          status: currentUser?.status || "idle",
          roomId: currentUser?.roomId || null,
          activeUsers: metrics?.activeUsers || 1,
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

    /* [DISABLED FOR LEAN MVP LAUNCH] Secondary Settings Handler: update_profile
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
    */

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
    //  - Block report if room active < 5s
    //  - recordReport: >3 clicks in 1 min -> 15m reporter ban
    //  - 3 reports -> 15m target ban
    //  - Instant session termination & disconnect if banned
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
        const partnerSocket = partner?.socketId ? io.sockets.sockets.get(partner.socketId) : null;

        const reporterDeviceHash = socket.data?.deviceHash || userId;
        const partnerDeviceHash = partnerSocket?.data?.deviceHash || partner?.deviceHash || partnerId;
        const reporterIp = socket.data?.clientIp || null;
        const partnerIp = partnerSocket?.data?.clientIp || partner?.clientIp || null;

        // Register both users in the in-memory IP + device pool
        if (typeof linkDeviceAndIp === "function") {
          if (reporterDeviceHash && reporterIp) linkDeviceAndIp(reporterDeviceHash, reporterIp, userId);
          if (partnerDeviceHash && partnerIp) linkDeviceAndIp(partnerDeviceHash, partnerIp, partnerId);
        }

        const now = Date.now();

        // Run recordReport on reporter and target device hashes and IPs
        const reportResult = recordReport(reporterDeviceHash, partnerDeviceHash, reporterIp, partnerIp);

        // Record to audit reportStore & dbService
        const reason = safeString(payload.reason, 120) || "user_reported";
        try {
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
            reportId: report?.id, severity: "medium",
          });
          dbService.saveReport({
            reportId: report?.id,
            reporterId: userId,
            reporterCountry: currentUser.country,
            reportedUserId: partnerId || "unknown",
            reportedUserCountry: partner?.country || "unknown",
            roomId: currentUser.roomId,
            reason,
            moderationFlags: report?.flags || [],
          }).catch(() => {});
        } catch (_) {}

        log("user_reported", {
          reporterId: userId,
          reporterDeviceHash,
          targetUserId: partnerId,
          targetDeviceHash: partnerDeviceHash,
          roomId: targetRoomId,
          reportResult,
        });

        // Self-training model ingestion for reported conversations
        const roomMessages = getRoomRecentMessages(targetRoomId);
        if (partnerId && roomMessages.length > 0) {
          ingestReportedConversation(userId, partnerId, roomMessages);
        }

        // End the chat session immediately
        terminateSession(io, targetRoomId, "user_reported");

        currentUser.status = "idle";
        currentUser.roomId = null;
        if (typeof redisSetUser === "function") {
          redisSetUser(userId, currentUser).catch(() => {});
        }
        if (partner) {
          partner.status = "idle";
          partner.roomId = null;
          if (typeof redisSetUser === "function") {
            redisSetUser(partnerId, partner).catch(() => {});
          }
        }

        if (partnerSocket) {
          try { partnerSocket.leave(targetRoomId); } catch (_) {}
        }
        try { socket.leave(targetRoomId); } catch (_) {}

        // Check if reporter was banned (fake report spam: > 3 reports in 1 min)
        if (reportResult.reporterBanned) {
          const minutesLeft = reportResult.minutesLeft || 15;
          const banMsg = `Suspended for ${minutesLeft} minutes due to report spam.`;
          banDevice(reporterDeviceHash, minutesLeft * 60 * 1000, "Report spam (>3 in 1m)", reporterIp, userId);

          socket.emit("chat_ended_banned", {
            isOffender: true,
            message: banMsg,
            banExpiresAt: now + minutesLeft * 60 * 1000,
            remainingMs: minutesLeft * 60 * 1000,
          });
          socket.emit("error_message", { message: banMsg });
          emitState(socket, currentUser);
          try { socket.disconnect(true); } catch (_) {}

          if (partnerSocket) {
            partnerSocket.emit("chat_ended", {
              reason: "partner_left",
              friendlyReason: "Chat ended. Your partner was disconnected.",
              message: "Chat ended.",
              roomId: targetRoomId,
            });
            emitState(partnerSocket, partner);
          }
          if (partnerId) {
            io.to(`user_${partnerId}`).emit("chat_ended", {
              reason: "partner_left",
              friendlyReason: "Chat ended. Your partner was disconnected.",
              message: "Chat ended.",
              roomId: targetRoomId,
            });
          }
          return;
        }

        // Disconnect and ban target user if they hit the ban threshold (3 reports)
        if (reportResult.targetBanned) {
          const minutesLeft = reportResult.minutesLeft || 15;
          const banMsg = `Suspended for ${minutesLeft} minutes due to community reports`;
          banDevice(partnerDeviceHash, minutesLeft * 60 * 1000, "Community reports ban (threshold exceeded)", partnerIp, partnerId);

          const banPayload = {
            isOffender: true,
            message: banMsg,
            banExpiresAt: now + minutesLeft * 60 * 1000,
            remainingMs: minutesLeft * 60 * 1000,
          };

          if (partnerSocket) {
            partnerSocket.emit("chat_ended_banned", banPayload);
            partnerSocket.emit("error_message", { message: banMsg });
            emitState(partnerSocket, partner);
            try { partnerSocket.disconnect(true); } catch (_) {}
          }
          if (partnerId) {
            io.to(`user_${partnerId}`).emit("chat_ended_banned", banPayload);
          }
        } else {
          // Warning sent to target user when reported once or twice (under threshold)
          // Guarantees the room closes on the reported person's side with a clear inline notice
          const warningMsg = "⚠️ Warning: You were reported by your chat partner for inappropriate behavior.";
          const warnPayload = {
            reason: "user_reported_warning",
            rawReason: "user_reported_warning",
            message: warningMsg,
            friendlyReason: warningMsg,
            roomId: targetRoomId,
          };
          if (partnerSocket) {
            partnerSocket.emit("chat_ended", warnPayload);
            emitState(partnerSocket, partner);
          }
          if (partnerId) {
            io.to(`user_${partnerId}`).emit("chat_ended", warnPayload);
          }
        }

        // Return reporter to home screen cleanly
        socket.emit("chat_ended", {
          reason: "report_submitted",
          rawReason: "report_submitted",
          message: "User reported. You have been returned to the home screen.",
          friendlyReason: "User reported. You have been returned to the home screen.",
          roomId: targetRoomId,
        });
        emitState(socket, currentUser);
      } catch (err) {
        log("report_user_error", { userId, message: err.message });
      }
    });

    socket.on("end_chat", () => {
      try {
        const currentUser = users.get(userId);
        if (!currentUser || !currentUser.roomId) return;

        const targetRoomId = currentUser.roomId;
        const activeRoom = rooms.get(targetRoomId);
        if (activeRoom && Array.isArray(activeRoom.users) && activeRoom.users.length >= 2) {
          addRecentPartnerLock(activeRoom.users[0], activeRoom.users[1]);
        }

        log("user_ended_chat", { userId, roomId: targetRoomId, endedAt: Date.now() });

        // Resolve partner and broadcast before state is reset
        const partnerId = activeRoom?.users?.find(id => id !== userId);
        const partnerUser = partnerId ? users.get(partnerId) : null;

        // Terminate session cleanly (terminateSession will broadcast chat_ended once to the room and leave sockets)
        terminateSession(io, targetRoomId, "user_ended");

        // Reset user and partner states synchronously
        currentUser.status = "idle";
        currentUser.roomId = null;
        if (typeof redisSetUser === "function") {
          redisSetUser(userId, currentUser).catch(() => {});
        }

        if (partnerUser) {
          partnerUser.status = "idle";
          partnerUser.roomId = null;
          if (typeof redisSetUser === "function") {
            redisSetUser(partnerId, partnerUser).catch(() => {});
          }
        }

        socket.emit("state_update", { status: "idle", roomId: null, joinedAt: currentUser.joinedAt });
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

        // Store status and roomId before resetting/purging user state to avoid race conditions
        const originalStatus = disconnectedUser.status;
        const originalRoomId = disconnectedUser.roomId;

        // 1. Immediately terminate matched explore room and notify partner that stranger skipped
        if (originalStatus === "matched" && originalRoomId) {
          const room = rooms.get(originalRoomId);
          if (room) {
            room.status = "terminated";
            if (room.disconnectTimeoutRef) clearTimeout(room.disconnectTimeoutRef);
            rooms.delete(originalRoomId);
          }

          const partnerId = room?.users?.find(id => id !== disconnectedUser.id);
          const partnerUser = partnerId ? users.get(partnerId) : null;

          if (partnerUser) {
            partnerUser.status = "idle";
            partnerUser.roomId = null;
            if (typeof redisSetUser === "function") {
              redisSetUser(partnerId, partnerUser).catch(() => {});
            }

            if (partnerUser.socketId) {
              const partnerSocket = io.sockets.sockets.get(partnerUser.socketId);
              if (partnerSocket) {
                partnerSocket.emit("chat_ended", {
                  roomId: originalRoomId,
                  reason: "Stranger has skipped the chat ✌️",
                  rawReason: "next_clicked",
                  isSkip: true
                });
                partnerSocket.emit("partner_disconnected", {
                  roomId: originalRoomId,
                  message: "Stranger has skipped the chat"
                });
              }
            }
          }

          log("user_disconnected_while_matched_explore", {
            userId: disconnectedUser.id,
            socketId: socket.id,
            roomId: originalRoomId,
            reason: reason || "tab_closed_or_disconnected",
          });
        }

        if (originalStatus === "waiting") {
          leaveWaitingQueue(disconnectedUser.id);
        }

        // 2. Now instantly and atomically purge user from waiting queues and Redis state
        purgeUserFromAllState(disconnectedUser.id, socket.id);
        messageTimestamps.delete(socket.id);
        silencedSockets.delete(socket.id);
        silenceViolationCounts.delete(socket.id);
        rapidBurstTimestamps.delete(socket.id);

        disconnectedUser.isActive = false;
        disconnectedUser.lastDisconnect = Date.now();
        disconnectedUser.status = "idle";
        disconnectedUser.roomId = null;
      } catch (err) {
        log("disconnect_handler_error", { userId, message: err.message });
      }
    });

    socket.on("error", (error) => {
      log("socket_runtime_error", { userId, socketId: socket.id, message: error?.message });
    });
  });
}

function adminSilenceUser(target, durationMs = 10 * 60 * 1000) {
  const expiry = Date.now() + durationMs;
  let count = 0;
  for (const [id, user] of users.entries()) {
    if (id === target || user.socketId === target) {
      if (user.socketId) {
        silencedSockets.set(user.socketId, expiry);
        count++;
      }
    }
  }
  if (silencedSockets.has(target)) {
    silencedSockets.set(target, expiry);
    count++;
  }
  return count;
}

function adminResetStrikes(target) {
  exploreViolations.delete(target);
  friendViolations.delete(target);
}

module.exports = {
  registerSocketHandlers,
  adminSilenceUser,
  adminResetStrikes,
  setEmergencyStrictMode,
  isEmergencyStrictMode,
  silencedSockets,
  setGlobalSlowMode,
  getGlobalSlowMode,
  setRaidShield,
  isRaidShield,
  setBlockExternalLinks,
  isBlockExternalLinks,
  toggleCountryQuarantine,
  isCountryQuarantined,
  getQuarantinedCountries,
  addShadowban,
  removeShadowban,
  isShadowbanned,
  getAllShadowbans,
  calculateUserRiskScore,
};
