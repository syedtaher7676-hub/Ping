const { CHAT_DURATION_MS } = require("../config");
const { users, rooms, removeUserFromQueue, incrementTotalMatches, friendRooms, createFriendRoomEntry } = require("../state/store");
const { createId } = require("../utils/ids");
const { log } = require("../utils/logger");

function safelyResetUser(user) {
  if (!user) {
    return;
  }

  user.status = "idle";
  user.roomId = null;
  removeUserFromQueue(user.id);
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

  room.status = "terminated";
  room.endedAt = Date.now();
  clearTimeout(room.timerRef);
  if (room.timerIntervalRef) {
    clearInterval(room.timerIntervalRef);
  }
  rooms.delete(roomId);

  const [firstUserId, secondUserId] = room.users;
  const firstUser = users.get(firstUserId);
  const secondUser = users.get(secondUserId);

  const friendlyReason =
    reason === "next_clicked" ? "Stranger skipped the chat." :
      reason === "time_expired" ? "Time's up! The session has expired." :
        reason === "user_ended" ? "Stranger ended the chat." :
          reason === "partner_left" ? "Your partner left." : "Chat ended.";

  if (firstUser?.socketId) {
    const firstSocket = io.sockets.sockets.get(firstUser.socketId);
    firstSocket?.leave(roomId);
    firstSocket?.emit("chat_end", { reason: friendlyReason, roomId });
    firstSocket?.emit("state_update", { status: "idle", roomId: null });
  }

  if (secondUser?.socketId) {
    const secondSocket = io.sockets.sockets.get(secondUser.socketId);
    secondSocket?.leave(roomId);
    secondSocket?.emit("chat_end", { reason: friendlyReason, roomId });
    secondSocket?.emit("state_update", { status: "idle", roomId: null });
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
  if (!room || room.status !== "active") {
    return;
  }

  const remainingUserId = room.users.find(id => id !== disconnectedUserId);
  if (!remainingUserId) {
    return;
  }

  const remainingUser = users.get(remainingUserId);
  if (!remainingUser?.socketId) {
    return;
  }

  const remainingSocket = io.sockets.sockets.get(remainingUser.socketId);
  if (!remainingSocket) {
    return;
  }

  // Notify remaining user that partner disconnected, but don't end the session yet
  remainingSocket.emit("partner_disconnected", {
    roomId,
    partnerId: disconnectedUserId,
    message: "Your chat partner disconnected. Waiting for them to reconnect...",
    reconnectTimeoutMs: 30000,
  });

  log("partner_disconnected_notified", {
    roomId,
    disconnectedUserId,
    remainingUserId,
    timestamp: Date.now(),
  });

  // Set a timeout to actually terminate if they don't reconnect
  const disconnectTimeout = setTimeout(() => {
    const currentRoom = rooms.get(roomId);
    const disconnectedUser = users.get(disconnectedUserId);

    // If user reconnected or room already terminated, don't do anything
    if (!currentRoom || currentRoom.status !== "active" || disconnectedUser?.isActive) {
      return;
    }

    terminateSession(io, roomId, "partner_left");

    log("session_terminated_after_disconnect_timeout", {
      roomId,
      reason: "partner_reconnect_timeout",
      disconnectedUserId,
      remainingUserId,
    });
  }, 30000);

  // Store the timeout ref on the room so it can be cleared if partner reconnects
  room.disconnectTimeoutRef = disconnectTimeout;
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



function createSession(io, firstUser, secondUser) {
  const roomId = createId("room");
  const createdAt = Date.now();
  const endAt = createdAt + CHAT_DURATION_MS;

  const timerRef = setTimeout(() => {
    terminateSession(io, roomId, "time_expired");
  }, CHAT_DURATION_MS);

  rooms.set(roomId, {
    roomId,
    status: "active",
    type: "stranger",
    users: [firstUser.id, secondUser.id],
    createdAt,
    endAt,
    remainingMs: CHAT_DURATION_MS,
    lastActivityAt: createdAt,
    timerRef,
  });

  firstUser.status = "matched";
  firstUser.roomId = roomId;
  secondUser.status = "matched";
  secondUser.roomId = roomId;

  const firstSocket = io.sockets.sockets.get(firstUser.socketId);
  const secondSocket = io.sockets.sockets.get(secondUser.socketId);

  if (!firstSocket || !secondSocket) {
    terminateSession(io, roomId, "socket_missing");
    return null;
  }

  firstSocket.join(roomId);
  secondSocket.join(roomId);

  firstSocket.emit("matched", {
    roomId,
    peerId: secondUser.id,
    expiresInMs: CHAT_DURATION_MS,
    endAt,
    startedAt: createdAt,
    partnerCountry: secondUser.country || "Unknown",
    remainingMs: CHAT_DURATION_MS,
  });
  secondSocket.emit("matched", {
    roomId,
    peerId: firstUser.id,
    expiresInMs: CHAT_DURATION_MS,
    endAt,
    startedAt: createdAt,
    partnerCountry: firstUser.country || "Unknown",
    remainingMs: CHAT_DURATION_MS,
  });

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
      // Guard: only terminate if not already terminated
      if (currentRoom.status === "active") {
        terminateSession(io, roomId, "time_expired");
      }
    }
  }, 1000);

  rooms.get(roomId).timerIntervalRef = timerInterval;

  log("users_matched", {
    roomId,
    createdAt,
    endAt,
    firstUserId: firstUser.id,
    secondUserId: secondUser.id,
  });

  incrementTotalMatches();

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
