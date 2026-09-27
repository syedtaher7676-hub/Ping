const { CHAT_DURATION_MS } = require("../config");
const dbService = require("./dbService");
const {
  users,
  rooms,
  timeExtensionRequests,
  removeUserFromQueue,
  enqueueUser,
  incrementTotalMatches,
  friendRooms,
  createFriendRoomEntry,
  redisSetRoom,
  redisDeleteRoom,
  redisSetUser,
  purgeUserFromAllState,
  isRedisReady,
} = require("../state/store");
const { createId } = require("../utils/ids");
const { log } = require("../utils/logger");

function safelyResetUser(user) {
  if (!user) {
    return;
  }

  user.status = "idle";
  user.roomId = null;
  removeUserFromQueue(user.id);
  if (typeof redisSetUser === "function") {
    redisSetUser(user.id, user).catch(() => {});
  }
}

function terminateSession(io, roomId, reason = "session_ended") {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  // Guard against double termination
  if (room.status === "terminated") {
    return;
  }

  const [firstUserId, secondUserId] = room.users || [];
  const firstUser = firstUserId ? users.get(firstUserId) : null;
  const secondUser = secondUserId ? users.get(secondUserId) : null;

  const friendlyReason =
    reason === "next_clicked" ? "Stranger skipped the chat." :
      reason === "time_expired" ? "Time's up! The session has expired." :
        reason === "user_ended" ? "Stranger left the chat." :
          reason === "partner_left" ? "Stranger left the chat." :
            reason === "server_shutdown" ? "Server is restarting for maintenance." : "Stranger left the chat.";

  const endPayload = {
    reason: "stranger_disconnected",
    message: "Stranger left the chat.",
    friendlyReason,
    rawReason: reason,
    roomId
  };

  // Broadcast chat_ended and chat_end to the room and individual user rooms BEFORE removing room metadata
  // Broadcast exactly once to the room before deleting metadata or leaving sockets
  io.to(roomId).emit("chat_ended", endPayload);

  room.status = "terminated";
  room.endedAt = Date.now();
  if (room.timerRef) {
    clearTimeout(room.timerRef);
    room.timerRef = null;
  }
  if (room.timerIntervalRef) {
    clearInterval(room.timerIntervalRef);
    room.timerIntervalRef = null;
  }
  if (room.disconnectTimeoutRef) {
    clearTimeout(room.disconnectTimeoutRef);
    room.disconnectTimeoutRef = null;
  }
  if (timeExtensionRequests) {
    timeExtensionRequests.delete(roomId);
  }

  // Enforce explicit physical socket leave for BOTH users on all server instances
  if (io && typeof io.in === "function") {
    try {
      io.in(roomId).socketsLeave(roomId);
    } catch (_) {}
  }

  rooms.delete(roomId);
  if (typeof redisDeleteRoom === "function") {
    redisDeleteRoom(roomId).catch(() => {});
  }

  if (firstUser?.socketId) {
    const firstSocket = io.sockets?.sockets?.get(firstUser.socketId);
    if (firstSocket) {
      firstSocket.emit("state_update", { status: "idle", roomId: null, joinedAt: firstUser.joinedAt });
    }
  }

  if (secondUser?.socketId) {
    const secondSocket = io.sockets?.sockets?.get(secondUser.socketId);
    if (secondSocket) {
      secondSocket.emit("state_update", { status: "idle", roomId: null, joinedAt: secondUser.joinedAt });
    }
  }

  safelyResetUser(firstUser);
  safelyResetUser(secondUser);

  log("session_terminated", {
    roomId,
    status: room.status,
    createdAt: room.createdAt,
    endedAt: room.endedAt,
    reason,
    users: room.users,
  });
}

// ─────────────────────────────────────────────────────────────
// Handle partner disconnect - allow time for reconnection
// ─────────────────────────────────────────────────────────────
function handlePartnerDisconnect(io, roomId, disconnectedUserId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  const remainingUserId = room.users ? room.users.find(id => id !== disconnectedUserId) : null;
  const remainingUser = remainingUserId ? users.get(remainingUserId) : null;
  const disconnectedUser = users.get(disconnectedUserId);

  log("handling_partner_disconnect", {
    roomId,
    disconnectedUserId,
    remainingUserId,
  });

  const endPayload = {
    reason: "stranger_disconnected",
    message: "Stranger left the chat.",
    roomId,
    partnerId: disconnectedUserId,
    autoSearchAvailable: true,
  };

  // Broadcast exactly once to the room before deleting metadata or leaving sockets
  io.to(roomId).emit("chat_ended", endPayload);

  // Update remaining partner's and disconnected user's state immediately
  safelyResetUser(remainingUser);
  safelyResetUser(disconnectedUser);

  // Enforce explicit physical socket leave for the room on all server instances BEFORE deleting room metadata
  if (io && typeof io.in === "function") {
    try {
      io.in(roomId).socketsLeave(roomId);
    } catch (_) {}
  }

  // Clear room timers and delete room metadata
  if (room.timerRef) {
    clearTimeout(room.timerRef);
    room.timerRef = null;
  }
  if (room.timerIntervalRef) {
    clearInterval(room.timerIntervalRef);
    room.timerIntervalRef = null;
  }
  if (room.disconnectTimeoutRef) {
    clearTimeout(room.disconnectTimeoutRef);
    room.disconnectTimeoutRef = null;
  }
  if (timeExtensionRequests) {
    timeExtensionRequests.delete(roomId);
  }

  room.status = "terminated";
  room.endedAt = Date.now();
  rooms.delete(roomId);
  if (typeof redisDeleteRoom === "function") {
    redisDeleteRoom(roomId).catch(() => {});
  }

  if (remainingUser?.socketId) {
    const remainingSocket = io.sockets?.sockets?.get(remainingUser.socketId);
    if (remainingSocket) {
      remainingSocket.emit("state_update", { status: "idle", roomId: null, joinedAt: remainingUser.joinedAt });
    }
  }

  log("partner_disconnected_resolved", {
    roomId,
    disconnectedUserId,
    remainingUserId,
    timestamp: Date.now(),
  });
}

// ─────────────────────────────────────────────────────────────
// Extend session time - adds additional time to the room
// ─────────────────────────────────────────────────────────────
const TIME_EXTENSION_MS = 2 * 60 * 1000; // 2 minutes

function extendSessionTime(io, roomId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== "active") {
    return false;
  }

  // Extend the end time
  room.endAt += TIME_EXTENSION_MS;
  room.remainingMs = Math.max(0, room.endAt - Date.now());

  // Reset the main timeout
  clearTimeout(room.timerRef);
  const newRemainingMs = room.endAt - Date.now();
  room.timerRef = setTimeout(() => {
    terminateSession(io, roomId, "time_expired");
  }, Math.max(0, newRemainingMs));

  // Emit updated timer to both users
  io.to(roomId).emit("time_extended", {
    roomId,
    newEndAt: room.endAt,
    addedMs: TIME_EXTENSION_MS,
    remainingMs: room.remainingMs,
  });

  log("session_time_extended", {
    roomId,
    newEndAt: room.endAt,
    addedMs: TIME_EXTENSION_MS,
  });

  return true;
}

// ═══════════════════════════════════════════════════════════════
// BUG FIX 2: Race Conditions on Immediate Matchmaking
// ═══════════════════════════════════════════════════════════════
// Guard against User A disconnecting at the exact millisecond of matching.
// Instead of dumping User B into a dead session or resetting them to idle,
// we detect the dead socket immediately, clean up the dead peer, and
// seamlessly re-enqueue User B so they never get stuck.
function createSession(io, firstUser, secondUser, customRoomId = null) {
  if (!firstUser || !secondUser) {
    return null;
  }

  const firstSocket = firstUser.socketId ? io.sockets?.sockets?.get(firstUser.socketId) : null;
  const secondSocket = secondUser.socketId ? io.sockets?.sockets?.get(secondUser.socketId) : null;

  const isRedisActive = typeof isRedisReady === "function" && isRedisReady();

  if (!isRedisActive) {
    const firstConnected = Boolean(firstSocket && firstSocket.connected);
    const secondConnected = Boolean(secondSocket && secondSocket.connected);

    if (!firstConnected || !secondConnected) {
      log("matchmaking_socket_disconnected_edge_case", {
        firstUserId: firstUser.id,
        firstConnected,
        secondUserId: secondUser.id,
        secondConnected,
      });

      if (!firstConnected && secondConnected) {
        if (typeof purgeUserFromAllState === "function") {
          purgeUserFromAllState(firstUser.id, firstUser.socketId);
        }
        secondUser.status = "waiting";
        secondUser.roomId = null;
        enqueueUser(secondUser.id);
        if (secondSocket) {
          secondSocket.emit("queue_joined", { status: "waiting" });
          secondSocket.emit("state_update", { status: "waiting", roomId: null, joinedAt: secondUser.joinedAt });
        }
      } else if (firstConnected && !secondConnected) {
        if (typeof purgeUserFromAllState === "function") {
          purgeUserFromAllState(secondUser.id, secondUser.socketId);
        }
        firstUser.status = "waiting";
        firstUser.roomId = null;
        enqueueUser(firstUser.id);
        if (firstSocket) {
          firstSocket.emit("queue_joined", { status: "waiting" });
          firstSocket.emit("state_update", { status: "waiting", roomId: null, joinedAt: firstUser.joinedAt });
        }
      } else {
        if (typeof purgeUserFromAllState === "function") {
          purgeUserFromAllState(firstUser.id, firstUser.socketId);
          purgeUserFromAllState(secondUser.id, secondUser.socketId);
        }
      }

      return null;
    }
  }

  const roomId = customRoomId || createId("room");
  const createdAt = Date.now();
  const endAt = createdAt + CHAT_DURATION_MS;

  const timerRef = setTimeout(() => {
    terminateSession(io, roomId, "time_expired");
  }, CHAT_DURATION_MS);

  const roomEntry = {
    roomId,
    status: "active",
    type: "stranger",
    users: [firstUser.id, secondUser.id],
    createdAt,
    endAt,
    remainingMs: CHAT_DURATION_MS,
    lastActivityAt: createdAt,
    timerRef,
    timerIntervalRef: null,
    disconnectTimeoutRef: null,
  };

  rooms.set(roomId, roomEntry);
  if (typeof redisSetRoom === "function") {
    redisSetRoom(roomId, roomEntry).catch(() => {});
  }

  firstUser.status = "matched";
  firstUser.roomId = roomId;
  secondUser.status = "matched";
  secondUser.roomId = roomId;

  if (typeof redisSetUser === "function") {
    redisSetUser(firstUser.id, firstUser).catch(() => {});
    redisSetUser(secondUser.id, secondUser).catch(() => {});
  }

  if (firstSocket) firstSocket.join(roomId);
  if (secondSocket) secondSocket.join(roomId);

  if (io && typeof io.in === "function") {
    try {
      io.in(`user_${firstUser.id}`).socketsJoin(roomId);
      io.in(`user_${secondUser.id}`).socketsJoin(roomId);
    } catch (_) {}
  }

  const secondUsername = secondUser.username || secondUser.displayName || (secondUser.profile && (secondUser.profile.username || secondUser.profile.displayName)) || null;
  const firstUsername = firstUser.username || firstUser.displayName || (firstUser.profile && (firstUser.profile.username || firstUser.profile.displayName)) || null;

  const matchPayloadA = {
    roomId,
    peerId: secondUser.id,
    expiresInMs: CHAT_DURATION_MS,
    endAt,
    startedAt: createdAt,
    partnerCountry: secondUser.country || "Unknown",
    partnerUsername: secondUsername,
    partnerDisplayName: secondUser.displayName || secondUsername,
    remainingMs: CHAT_DURATION_MS,
  };

  const matchPayloadB = {
    roomId,
    peerId: firstUser.id,
    expiresInMs: CHAT_DURATION_MS,
    endAt,
    startedAt: createdAt,
    partnerCountry: firstUser.country || "Unknown",
    partnerUsername: firstUsername,
    partnerDisplayName: firstUser.displayName || firstUsername,
    remainingMs: CHAT_DURATION_MS,
  };

  if (firstSocket) firstSocket.emit("matched", matchPayloadA);
  io.to(`user_${firstUser.id}`).emit("matched", matchPayloadA);

  if (secondSocket) secondSocket.emit("matched", matchPayloadB);
  io.to(`user_${secondUser.id}`).emit("matched", matchPayloadB);

  // Start periodic timer updates to clients
  const timerInterval = setInterval(() => {
    const currentRoom = rooms.get(roomId);
    if (!currentRoom || currentRoom.status !== "active") {
      clearInterval(timerInterval);
      return;
    }

    const remaining = Math.max(0, currentRoom.endAt - Date.now());

    io.to(roomId).emit("timer_update", {
      remainingMs: remaining,
      endAt: currentRoom.endAt,
    });

    if (remaining <= 0) {
      clearInterval(timerInterval);
      if (currentRoom.status === "active") {
        terminateSession(io, roomId, "time_expired");
      }
    }
  }, 1000);

  roomEntry.timerIntervalRef = timerInterval;

  log("users_matched", {
    roomId,
    createdAt,
    endAt,
    firstUserId: firstUser.id,
    secondUserId: secondUser.id,
  });

  incrementTotalMatches();
  dbService.incrementUserMatchCount(firstUser.id).catch(() => {});
  dbService.incrementUserMatchCount(secondUser.id).catch(() => {});

  return roomId;
}

module.exports = {
  createSession,
  terminateSession,
  handlePartnerDisconnect,
  extendSessionTime,
  safelyResetUser,
  TIME_EXTENSION_MS,
};
