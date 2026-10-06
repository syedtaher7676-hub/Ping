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
const INTEREST_METADATA = {
  movies: {
    label: "🎬 Movies & Film",
    icebreakers: [
      "What's a movie you can rewatch 100 times without getting bored?",
      "What's the best movie plot twist you never saw coming?",
      "What movie soundtrack or score gives you chills every time?",
      "If you could live inside any movie universe, which one would it be?",
      "What's an overrated movie that everyone loves but you secretly dislike?",
      "Who is your absolute favorite actor or movie director of all time?",
      "What's the scariest or most intense horror movie you've ever seen?",
      "If they made a movie about your life, who should play you?"
    ]
  },
  music: {
    label: "🎧 Music & Songs",
    icebreakers: [
      "Who is your top artist or favorite album right now?",
      "What's a song that always puts you in a good mood instantly?",
      "What was the first concert or live music event you ever attended?",
      "What's a genre or song you secretly love but don't tell many people about?",
      "If you could see any musician live, dead or alive, who would it be?",
      "What song lyrics hit you the hardest personally?",
      "Do you prefer listening to music on headphones or speakers?",
      "What's the late-night song you listen to when you're introspective?"
    ]
  },
  gaming: {
    label: "🎮 Gaming & Esports",
    icebreakers: [
      "PC, Console, or Mobile? What game are you playing lately?",
      "What's a game you have put 100+ hours into?",
      "What's your all-time favorite video game storyline or character?",
      "Co-op multiplayer or single-player story mode?",
      "What's the hardest video game boss or level you ever beat?",
      "What's a nostalgic game from your childhood you miss playing?",
      "If you could live in any video game world, which game would it be?",
      "What upcoming video game release are you most excited for?"
    ]
  },
  tech: {
    label: "💻 Tech & AI",
    icebreakers: [
      "What's the coolest gadget or AI tool you've used recently?",
      "If you could invent any futuristic technology today, what would it be?",
      "What app on your phone do you use the most every single day?",
      "Do you think AI will replace smartphones in 10 years?",
      "What's the most useful tech hack or shortcut you use daily?",
      "Apple or Android? Defend your choice in one sentence!",
      "If you could telepathically control one device in your room, what is it?",
      "What's the most mind-blowing piece of technology you've seen recently?"
    ]
  },
  studies: {
    label: "📚 Studies & Learning",
    icebreakers: [
      "What field or subject are you studying or super passionate about?",
      "What's a fascinating fact you learned recently that blew your mind?",
      "If you could master any skill or degree overnight, what would it be?",
      "What was your favorite subject in high school or college?",
      "Do you study better late at night or early in the morning?",
      "What's a topic you could give an impromptu 15-minute presentation on?",
      "What's the hardest exam or subject you ever successfully passed?",
      "What's an underrated area of science or history you find super cool?"
    ]
  },
  sports: {
    label: "⚽ Sports & Fitness",
    icebreakers: [
      "What sport or team do you follow most passionately?",
      "What's the most legendary sporting moment you've ever watched live?",
      "Do you prefer playing sports or watching them?",
      "Who is your favorite athlete or sports icon of all time?",
      "What workout or exercise routine keeps you most active?",
      "What's an extreme sport you would love to try if safety was guaranteed?",
      "Football/Soccer, Basketball, or F1? Which one takes top priority?",
      "What's the best stadium or arena environment you've ever experienced?"
    ]
  },
  food: {
    label: "🍕 Food & Cooking",
    icebreakers: [
      "What's your ultimate go-to comfort food at 2 AM?",
      "What's a food everyone loves that you personally can'stand?",
      "If you could only eat one cuisine for the rest of your life, what is it?",
      "What's the most unique or unusual dish you've ever tried?",
      "Are you a master chef or do you struggle with basic microwave meals?",
      "Sweet or savory snacks when you're binge-watching something?",
      "What's your dream 3-course meal if price didn't matter?",
      "Coffee, Tea, or Boba? What's your daily caffeine fix?"
    ]
  },
  travel: {
    label: "✈️ Travel & Cultures",
    icebreakers: [
      "If you could hop on a plane anywhere right now, where would you go?",
      "What's the most beautiful place you've ever visited in person?",
      "Do you prefer relaxing beach vacations or exploring big cities?",
      "What's top 1 on your travel bucket list?",
      "What's the craziest or funniest travel story you have?",
      "Solo traveling or group trip with best friends?",
      "What culture or country's tradition do you find most interesting?",
      "Mountains and nature, or historical historic cities?"
    ]
  }
};

const GENERAL_ICEBREAKERS = [
  "What's the most underrated thing that happened to you this week?",
  "If you could have any superpower for 24 hours, what would it be?",
  "What's your ultimate comfort show or movie?",
  "What's something you're really looking forward to right now?",
  "Tell me one true story and one lie about your day!",
  "What's the funniest meme or video you've seen recently?",
  "If you could ask a time-traveler from 2050 one question, what would it be?",
  "What's a random habit or quirk you have that most people don't know?"
];

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

  // Determine common interest and icebreaker
  const firstInterests = Array.isArray(firstUser.interests) ? firstUser.interests : [];
  const secondInterests = Array.isArray(secondUser.interests) ? secondUser.interests : [];
  const commonInterests = firstInterests.filter(tag => secondInterests.includes(tag));

  let matchedInterest = null;
  let matchedInterestLabel = null;
  let icebreakerA = null;
  let icebreakerB = null;
  let fallbackMessageA = null;
  let fallbackMessageB = null;

  if (commonInterests.length > 0) {
    matchedInterest = commonInterests[0];
    const meta = INTEREST_METADATA[matchedInterest];
    if (meta && Array.isArray(meta.icebreakers) && meta.icebreakers.length > 0) {
      matchedInterestLabel = meta.label;
      const shuffled = [...meta.icebreakers].sort(() => 0.5 - Math.random());
      icebreakerA = shuffled[0];
      icebreakerB = shuffled[1] || shuffled[0];
    }
  } else {
    // Cross-tag intermatch fallback notice logic
    const tagA = firstInterests[0];
    const tagB = secondInterests[0];
    const labelA = tagA && INTEREST_METADATA[tagA] ? INTEREST_METADATA[tagA].label : null;
    const labelB = tagB && INTEREST_METADATA[tagB] ? INTEREST_METADATA[tagB].label : null;

    if (labelA && labelB) {
      fallbackMessageA = `No exact ${labelA} match was online right now, so ${labelB} was matched with you!`;
      fallbackMessageB = `No exact ${labelB} match was online right now, so ${labelA} was matched with you!`;
    } else if (labelA) {
      fallbackMessageA = `No exact ${labelA} match was online right now, so a random stranger was matched with you!`;
      fallbackMessageB = `A user interested in ${labelA} was matched with you!`;
    } else if (labelB) {
      fallbackMessageA = `A user interested in ${labelB} was matched with you!`;
      fallbackMessageB = `No exact ${labelB} match was online right now, so a random stranger was matched with you!`;
    }

    const poolA = tagA && INTEREST_METADATA[tagA] ? INTEREST_METADATA[tagA].icebreakers : GENERAL_ICEBREAKERS;
    const poolB = tagB && INTEREST_METADATA[tagB] ? INTEREST_METADATA[tagB].icebreakers : GENERAL_ICEBREAKERS;

    const shuffledA = [...poolA].sort(() => 0.5 - Math.random());
    const shuffledB = [...poolB].sort(() => 0.5 - Math.random());

    icebreakerA = shuffledA[0];
    icebreakerB = shuffledB[0];
  }

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
    matchedInterest,
    matchedInterestLabel,
    icebreaker: icebreakerA,
    fallbackMessage: fallbackMessageA,
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
    matchedInterest,
    matchedInterestLabel,
    icebreaker: icebreakerB,
    fallbackMessage: fallbackMessageB,
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
