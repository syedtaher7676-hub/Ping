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
} = require("../state/store");
const { createSession } = require("./sessionManager");
const { log } = require("../utils/logger");

let isMatching = false;
const matchmakingStartTimes = new Map(); // Track when users enter queue

function isUserAvailableForMatch(userId) {
  const user = users.get(userId);
  if (!user) {
    return false;
  }

  return user.status === "waiting" && !user.roomId && Boolean(user.socketId);
}

function enqueueForMatchmaking(userId) {
  const user = users.get(userId);
  if (!user) {
    return { ok: false, reason: "user_not_found" };
  }

  if (user.status === "matched") {
    return { ok: false, reason: "already_matched" };
  }

  if (user.status === "waiting" || isUserQueued(userId)) {
    return { ok: false, reason: "already_waiting" };
  }

  user.status = "waiting";
  user.roomId = null;
  enqueueUser(userId);
  
  // Record matchmaking start time
  matchmakingStartTimes.set(userId, Date.now());

  log("user_queued", {
    userId,
    queueSize: waitingQueue.length,
  });

  return { ok: true, reason: "queued" };
}

function sanitizeQueue() {
  for (const queuedUserId of [...waitingSet]) {
    if (!isUserAvailableForMatch(queuedUserId)) {
      removeUserFromQueue(queuedUserId);
    }
  }
}

function attemptMatchmaking(io) {
  if (isMatching) {
    return;
  }

  isMatching = true;

  try {
    sanitizeQueue();

    while (waitingQueue.length >= 2) {
      const firstUserId = dequeueUser();
      const secondUserId = dequeueUser();

      if (!firstUserId || !secondUserId || firstUserId === secondUserId) {
        continue;
      }

      const firstUser = users.get(firstUserId);
      const secondUser = users.get(secondUserId);

      const firstValid = firstUser && firstUser.status === "waiting" && !firstUser.roomId;
      const secondValid = secondUser && secondUser.status === "waiting" && !secondUser.roomId;

      if (!firstValid || !secondValid) {
        if (firstValid && !isUserQueued(firstUserId)) {
          enqueueUser(firstUserId);
        }
        if (secondValid && !isUserQueued(secondUserId)) {
          enqueueUser(secondUserId);
        }
        sanitizeQueue();
        continue;
      }

      if (firstUser.socketId === secondUser.socketId) {
        enqueueUser(firstUserId);
        continue;
      }

      const roomId = createSession(io, firstUser, secondUser);
      if (!roomId) {
        if (isUserAvailableForMatch(firstUserId)) {
          enqueueUser(firstUserId);
        }
        if (isUserAvailableForMatch(secondUserId)) {
          enqueueUser(secondUserId);
        }
        continue;
      }

      // Record matchmaking time
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
};
