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
  redisGetUser,
  purgeUserFromAllState,
  areRecentPartners,
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
      matchmakingStartTimes.delete(userId);
      return { ok: false, reason: "socket_disconnected" };
    }
  }

  // If user was recorded in a room, check if the room is still active
  if (user.roomId) {
    const room = rooms.get(user.roomId);
    if (!room || room.status !== "active" || room.type !== "friend_dm") {
      user.roomId = null;
      user.status = "idle";
    } else {
      return { ok: false, reason: "already_matched" };
    }
  } else if (user.status === "matched") {
    user.status = "idle";
  }

  if (user.status === "waiting" && isUserQueued(userId)) {
    matchmakingStartTimes.set(userId, Date.now());
    return { ok: true, reason: "already_waiting" };
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

  // Ensure waitingQueue and waitingSet remain strictly synchronized and free of ghost/stale entries
  const seen = new Set();
  const cleanQueue = [];
  for (const id of waitingQueue) {
    if (waitingSet.has(id) && !seen.has(id)) {
      seen.add(id);
      cleanQueue.push(id);
    }
  }
  waitingQueue.length = 0;
  waitingQueue.push(...cleanQueue);
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

        // Prevent Redis-First Memory Leaks in matchmakingStartTimes:
        // Ensure matchmakingStartTimes.delete is called regardless of user resolution
        if (matchResult.userA && matchResult.userA.id) {
          matchmakingStartTimes.delete(matchResult.userA.id);
        }
        if (matchResult.userB && matchResult.userB.id) {
          matchmakingStartTimes.delete(matchResult.userB.id);
        }

        let userA = users.get(matchResult.userA.id);
        if (!userA && typeof redisGetUser === "function") {
          userA = await redisGetUser(matchResult.userA.id);
        }

        let userB = users.get(matchResult.userB.id);
        if (!userB && typeof redisGetUser === "function") {
          userB = await redisGetUser(matchResult.userB.id);
        }

        if (userA && userB) {
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
        if (firstUserId) {
          removeUserFromQueue(firstUserId);
          matchmakingStartTimes.delete(firstUserId);
          purgeUserFromAllState(firstUserId, users.get(firstUserId)?.socketId);
        }
        if (secondUserId && secondUserId !== firstUserId) {
          removeUserFromQueue(secondUserId);
          matchmakingStartTimes.delete(secondUserId);
          purgeUserFromAllState(secondUserId, users.get(secondUserId)?.socketId);
        }
        sanitizeQueue(io);
        continue;
      }

      const firstUser = users.get(firstUserId);
      const secondUser = users.get(secondUserId);

      // Guard against same-socket or missing user states causing infinite loops
      if (!firstUser || !secondUser || firstUser.socketId === secondUser.socketId) {
        if (firstUserId) {
          removeUserFromQueue(firstUserId);
          matchmakingStartTimes.delete(firstUserId);
          purgeUserFromAllState(firstUserId, firstUser?.socketId);
        }
        if (secondUserId) {
          removeUserFromQueue(secondUserId);
          matchmakingStartTimes.delete(secondUserId);
          purgeUserFromAllState(secondUserId, secondUser?.socketId);
        }
        sanitizeQueue(io);
        continue;
      }

      const firstValid = isUserAvailableForMatch(firstUserId, io);
      const secondValid = isUserAvailableForMatch(secondUserId, io);

      if (!firstValid || !secondValid) {
        if (firstValid && !isUserQueued(firstUserId)) {
          enqueueUser(firstUserId);
        } else if (!firstValid && typeof purgeUserFromAllState === "function") {
          purgeUserFromAllState(firstUserId, firstUser?.socketId);
          matchmakingStartTimes.delete(firstUserId);
        }

        if (secondValid && !isUserQueued(secondUserId)) {
          enqueueUser(secondUserId);
        } else if (!secondValid && typeof purgeUserFromAllState === "function") {
          purgeUserFromAllState(secondUserId, secondUser?.socketId);
          matchmakingStartTimes.delete(secondUserId);
        }

        sanitizeQueue(io);
        continue;
      }

      // Check if pair was recently skipped and other candidates are available
      if (typeof areRecentPartners === "function" && areRecentPartners(firstUserId, secondUserId)) {
        // Re-enqueue BOTH firstUserId and secondUserId to avoid dropping firstUserId into limbo
        enqueueUser(firstUserId);
        enqueueUser(secondUserId);
        
        // If waitingQueue.length < 2 (no other candidates available to pair with), break out of the matchmaking loop cleanly
        if (waitingQueue.length < 2) {
          break;
        }
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
