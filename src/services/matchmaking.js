const {
  users,
  waitingQueue,
  rooms,
  waitingSet,
  isUserQueued,
  enqueueUser,
  dequeueUser,
  removeUserFromQueue,
  recordMatchmakingTime,
  atomicMatchmake,
  isRedisReady,
  purgeUserFromAllState,
} = require("../state/store");
const { createSession } = require("./sessionManager");
const { createId } = require("../utils/ids");
const { log } = require("../utils/logger");

let isMatching = false;
const matchmakingStartTimes = new Map(); // Track when users enter queue

// ═══════════════════════════════════════════════════════════════
// BUG FIX 1 & 2: Active Socket Verification & Queue Sanitization
// ═══════════════════════════════════════════════════════════════
// Ensures users in the queue are active, not in a room, and have a
// live Socket.IO connection. If a user closed their browser, they
// are immediately purged rather than causing "ghost matching".
function isUserAvailableForMatch(userId, io = null) {
  if (!userId || typeof userId !== "string") return false;
  const user = users.get(userId);
  if (!user || !user.isActive || !user.socketId) {
    return false;
  }

  if (user.status !== "waiting" || Boolean(user.roomId)) {
    return false;
  }

  // If io instance is provided, verify socket is actively connected
  if (io && io.sockets && io.sockets.sockets) {
    const socket = io.sockets.sockets.get(user.socketId);
    if (!socket || !socket.connected) {
      return false;
    }
  }

  return true;
}

function enqueueForMatchmaking(userId, io = null) {
  if (!userId || typeof userId !== "string") {
    return { ok: false, reason: "invalid_user_id" };
  }

  const user = users.get(userId);
  if (!user) {
    return { ok: false, reason: "user_not_found" };
  }

  // Verify socket is alive before enqueueing
  if (io && io.sockets && io.sockets.sockets && user.socketId) {
    const socket = io.sockets.sockets.get(user.socketId);
    if (!socket || !socket.connected) {
      purgeUserFromAllState(userId, user.socketId);
      return { ok: false, reason: "socket_disconnected" };
    }
  }

  if (user.status === "matched" && user.roomId) {
    return { ok: false, reason: "already_matched" };
  }

  if (user.status === "waiting" && isUserQueued(userId)) {
    return { ok: false, reason: "already_waiting" };
  }

  user.status = "waiting";
  user.roomId = null;
  user.isActive = true;
  enqueueUser(userId);
  
  // Record matchmaking start time
  matchmakingStartTimes.set(userId, Date.now());

  log("user_queued", {
    userId,
    queueSize: waitingQueue.length,
  });

  return { ok: true, reason: "queued" };
}

function sanitizeQueue(io = null) {
  for (const queuedUserId of [...waitingSet]) {
    if (!isUserAvailableForMatch(queuedUserId, io)) {
      removeUserFromQueue(queuedUserId);
      matchmakingStartTimes.delete(queuedUserId);
      const deadUser = users.get(queuedUserId);
      if (deadUser && (!deadUser.socketId || (io && !io.sockets?.sockets?.get(deadUser.socketId)?.connected))) {
        if (typeof purgeUserFromAllState === "function") {
          purgeUserFromAllState(queuedUserId, deadUser.socketId);
        }
      }
    }
  }
}

async function attemptMatchmaking(io) {
  if (isMatching) {
    return;
  }

  isMatching = true;

  try {
    // 1. If Redis is active, prioritize atomic Lua matchmaking across distributed cluster
    if (typeof isRedisReady === "function" && isRedisReady() && typeof atomicMatchmake === "function") {
      let matchAttempt = 0;
      while (matchAttempt < 10) {
        const prospectiveRoomId = createId("room");
        const matchResult = await atomicMatchmake(prospectiveRoomId);
        if (!matchResult || !matchResult.ok) {
          break; // No more pairs ready in Redis ZSET
        }

        const userA = users.get(matchResult.userA.id);
        const userB = users.get(matchResult.userB.id);

        if (userA && userB) {
          matchmakingStartTimes.delete(userA.id);
          matchmakingStartTimes.delete(userB.id);
          createSession(io, userA, userB, matchResult.roomId);
        }
        matchAttempt++;
      }
      return;
    }

    // 2. In-Memory Fail-Open Matchmaking Engine
    sanitizeQueue(io);

    while (waitingQueue.length >= 2) {
      const firstUserId = dequeueUser();
      const secondUserId = dequeueUser();

      if (!firstUserId || !secondUserId || firstUserId === secondUserId) {
        if (firstUserId) removeUserFromQueue(firstUserId);
        if (secondUserId) removeUserFromQueue(secondUserId);
        continue;
      }

      const firstUser = users.get(firstUserId);
      const secondUser = users.get(secondUserId);

      const firstValid = isUserAvailableForMatch(firstUserId, io);
      const secondValid = isUserAvailableForMatch(secondUserId, io);

      if (!firstValid || !secondValid) {
        if (firstValid && !isUserQueued(firstUserId)) {
          enqueueUser(firstUserId);
        } else if (!firstValid && typeof purgeUserFromAllState === "function") {
          purgeUserFromAllState(firstUserId, firstUser?.socketId);
        }

        if (secondValid && !isUserQueued(secondUserId)) {
          enqueueUser(secondUserId);
        } else if (!secondValid && typeof purgeUserFromAllState === "function") {
          purgeUserFromAllState(secondUserId, secondUser?.socketId);
        }

        sanitizeQueue(io);
        continue;
      }

      // Guard against same socket ID spoofing
      if (firstUser.socketId === secondUser.socketId) {
        enqueueUser(firstUserId);
        continue;
      }

      const roomId = createSession(io, firstUser, secondUser);
      if (!roomId) {
        // Session creation handled peer recovery internally if one disconnected
        continue;
      }

      // Record matchmaking time metrics
      const firstWaitTime = matchmakingStartTimes.get(firstUserId) ? Date.now() - matchmakingStartTimes.get(firstUserId) : 0;
      const secondWaitTime = matchmakingStartTimes.get(secondUserId) ? Date.now() - matchmakingStartTimes.get(secondUserId) : 0;
      recordMatchmakingTime(firstWaitTime);
      recordMatchmakingTime(secondWaitTime);
      matchmakingStartTimes.delete(firstUserId);
      matchmakingStartTimes.delete(secondUserId);
    }
  } catch (error) {
    log("matchmaking_error", { message: error.message, stack: error.stack });
  } finally {
    isMatching = false;
  }
}

function leaveWaitingQueue(userId) {
  if (!userId) return;
  const user = users.get(userId);
  if (user?.status === "waiting") {
    user.status = "idle";
  }
  removeUserFromQueue(userId);
  matchmakingStartTimes.delete(userId);
}

function getMatchStats() {
  return {
    users: users.size,
    waiting: waitingSet.size,
    rooms: rooms.size,
  };
}

module.exports = {
  enqueueForMatchmaking,
  attemptMatchmaking,
  leaveWaitingQueue,
  getMatchStats,
  isUserAvailableForMatch,
};
