// ==============================================================================
// PING: Distributed Redis State Store (redisStore.js)
// ==============================================================================
// Distributed, atomic state management with Redis Sorted Sets (ZSET),
// Hashes, Lua scripts for race-condition-free matchmaking, sliding window
// rate-limiting, and an automatic in-memory fail-open fallback.
// ==============================================================================

const fs = require("fs");
const path = require("path");
const Redis = require("ioredis");
const { log } = require("../utils/logger");

// ── CONFIGURATION & PREFIXES ──────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || "";
const DEFAULT_REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const DEFAULT_REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;

const PREFIX = "ping:";
const KEYS = {
  QUEUE: `${PREFIX}waiting_queue`,       // ZSET: member=userId, score=enqueuedAt
  WAITING_SET: `${PREFIX}waiting_set`,   // SET: member=userId for O(1) membership checks
  USER_PREFIX: `${PREFIX}user:`,         // HASH: ping:user:{userId}
  SOCKET_PREFIX: `${PREFIX}socket:`,     // STRING: ping:socket:{socketId} -> userId
  ROOM_PREFIX: `${PREFIX}room:`,         // HASH: ping:room:{roomId}
  ACTIVE_ROOMS: `${PREFIX}rooms:active`, // SET: active room IDs
  METRICS: `${PREFIX}metrics`,           // HASH: system metrics
  RATELIMIT: `${PREFIX}ratelimit:`,      // ZSET: sliding window rate limiter
  FRIEND_PREFIX: `${PREFIX}friends:`,    // SET: ping:friends:{userId}
  DM_PREFIX: `${PREFIX}dm:`,             // LIST: ping:dm:{pairId}
};

const USER_TTL_SECONDS = 86400;   // 24 hours
const ROOM_TTL_SECONDS = 7200;    // 2 hours
const RATELIMIT_TTL_SECONDS = 300; // 5 minutes

// ── IN-MEMORY FALLBACK STATE (FAIL-OPEN) ───────────────────────
const memoryUsers = new Map();
const memoryWaitingQueue = [];
const memoryWaitingSet = new Set();
const memoryRooms = new Map();
const memoryFriendships = new Map();
const memoryFriendRooms = new Map();
const memoryPendingFriendRequests = new Map();
const memoryTimeExtensionRequests = new Map();
const memoryRateLimits = new Map(); // key -> [{ timestamp, id }]

let matchmakingTimes = [];
let totalMatchesCount = 0;

// ── REDIS CONNECTION & CLIENT ─────────────────────────────────
let redisClient = null;
let isRedisConnected = false;
let hasLoggedFailure = false;

// Load Lua matchmaking script
let matchmakingLuaScript = "";
try {
  const scriptPath = path.join(__dirname, "..", "scripts", "matchmaking.lua");
  matchmakingLuaScript = fs.readFileSync(scriptPath, "utf8");
} catch {
  // Fallback inline Lua script if file read fails
  matchmakingLuaScript = `
    local queueKey = KEYS[1]
    local setKey = KEYS[2]
    local userPrefix = KEYS[3]
    local metricsKey = KEYS[4]
    local now = tonumber(ARGV[1])
    local roomId = ARGV[2]
    local candidateIds = redis.call('ZRANGE', queueKey, 0, 19)
    if #candidateIds < 2 then return nil end
    local validUsers = {}
    for i = 1, #candidateIds do
      local uid = candidateIds[i]
      local uKey = userPrefix .. uid
      if redis.call('EXISTS', uKey) == 1 then
        local fields = redis.call('HMGET', uKey, 'id', 'status', 'roomId', 'socketId', 'country')
        if fields[2] == 'waiting' and fields[4] and fields[4] ~= '' and (not fields[3] or fields[3] == '' or fields[3] == 'null') then
          if #validUsers == 0 or validUsers[1].socketId ~= fields[4] then
            table.insert(validUsers, { id = fields[1] or uid, socketId = fields[4], country = fields[5] or "Someone nearby", score = redis.call('ZSCORE', queueKey, uid) })
          end
        else
          redis.call('ZREM', queueKey, uid)
          redis.call('SREM', setKey, uid)
        end
      else
        redis.call('ZREM', queueKey, uid)
        redis.call('SREM', setKey, uid)
      end
      if #validUsers == 2 then break end
    end
    if #validUsers < 2 then return nil end
    local uA = validUsers[1]
    local uB = validUsers[2]
    redis.call('ZREM', queueKey, uA.id, uB.id)
    redis.call('SREM', setKey, uA.id, uB.id)
    redis.call('HSET', userPrefix .. uA.id, 'status', 'matched', 'roomId', roomId, 'matchedWith', uB.id, 'matchedAt', now)
    redis.call('HSET', userPrefix .. uB.id, 'status', 'matched', 'roomId', roomId, 'matchedWith', uA.id, 'matchedAt', now)
    redis.call('HINCRBY', metricsKey, 'totalMatches', 1)
    return cjson.encode({ ok = true, roomId = roomId, userA = { id = uA.id, socketId = uA.socketId, country = uA.country, waitTime = uA.score and (now - tonumber(uA.score)) or 0 }, userB = { id = uB.id, socketId = uB.socketId, country = uB.country, waitTime = uB.score and (now - tonumber(uB.score)) or 0 } })
  `;
}

// Atomic Sliding Window Rate Limiter Lua Script
const slidingWindowLuaScript = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local windowMs = tonumber(ARGV[2])
  local maxLimit = tonumber(ARGV[3])
  local memberId = ARGV[4]
  local clearBefore = now - windowMs

  -- Remove timestamps outside sliding window
  redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)

  -- Get current count within window
  local currentCount = redis.call('ZCARD', key)

  if currentCount < maxLimit then
    -- Record new timestamp
    redis.call('ZADD', key, now, memberId)
    -- Set TTL for auto-cleanup
    redis.call('EXPIRE', key, math.ceil(windowMs / 1000) + 10)
    return {1, currentCount + 1, 0}
  else
    -- Rate limit exceeded; compute retry after ms
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retryAfter = 0
    if #oldest >= 2 then
      retryAfter = math.max(0, math.ceil((tonumber(oldest[2]) + windowMs) - now))
    end
    return {0, currentCount, retryAfter}
  end
`;

function initializeRedis() {
  if (redisClient) return redisClient;

  // Only attempt Redis connection if REDIS_URL or explicit REDIS_HOST is provided
  const connectionTarget = REDIS_URL || (process.env.REDIS_HOST ? `redis://${process.env.REDIS_HOST}:${DEFAULT_REDIS_PORT}` : "");

  if (!connectionTarget) {
    if (!hasLoggedFailure) {
      log("redis_unconfigured_in_memory_mode", {
        reason: "no_redis_url_provided",
        mode: "fail_open_in_memory",
      });
      hasLoggedFailure = true;
    }
    isRedisConnected = false;
    return null;
  }

  try {
    redisClient = new Redis(connectionTarget, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      enableOfflineQueue: false,
      lazyConnect: false,
      retryStrategy(times) {
        if (times > 3) {
          if (!hasLoggedFailure) {
            log("redis_fallback_active", {
              reason: "max_reconnect_attempts_reached",
              mode: "fail_open_in_memory",
            });
            hasLoggedFailure = true;
          }
          return null; // Stop retrying automatically to avoid log spam
        }
        return Math.min(times * 1000, 3000);
      },
    });

    redisClient.on("connect", () => {
      isRedisConnected = true;
      hasLoggedFailure = false;
      log("redis_connected", { target: REDIS_URL ? "custom_url" : `${DEFAULT_REDIS_HOST}:${DEFAULT_REDIS_PORT}` });
    });

    redisClient.on("ready", () => {
      isRedisConnected = true;
      // Define custom Lua command for matchmaking
      try {
        redisClient.defineCommand("popMatchPair", {
          numberOfKeys: 4,
          lua: matchmakingLuaScript,
        });
        redisClient.defineCommand("slidingWindowLimit", {
          numberOfKeys: 1,
          lua: slidingWindowLuaScript,
        });
      } catch (err) {
        log("redis_command_definition_error", { message: err.message });
      }
    });

    redisClient.on("error", (err) => {
      isRedisConnected = false;
      if (!hasLoggedFailure) {
        log("redis_connection_warning", {
          message: err.message,
          mode: "fail_open_fallback_in_memory",
        });
        hasLoggedFailure = true;
      }
    });

    redisClient.on("close", () => {
      isRedisConnected = false;
    });
  } catch (err) {
    isRedisConnected = false;
    log("redis_init_failed", { message: err.message, mode: "fail_open_in_memory" });
  }

  return redisClient;
}

// Start Redis initialization
initializeRedis();

function isRedisReady() {
  return Boolean(isRedisConnected && redisClient && redisClient.status === "ready");
}

// ── ATOMIC SLIDING WINDOW RATE LIMITER ────────────────────────
async function checkSlidingWindowRateLimit(key, windowMs, maxLimit) {
  const now = Date.now();
  const memberId = `${now}:${Math.random().toString(36).substr(2, 6)}`;

  if (isRedisReady()) {
    try {
      const fullKey = `${KEYS.RATELIMIT}${key}`;
      const result = await redisClient.slidingWindowLimit(fullKey, now, windowMs, maxLimit, memberId);
      const [allowed, currentCount, retryAfter] = result;
      return {
        allowed: allowed === 1,
        currentCount: Number(currentCount),
        retryAfter: Number(retryAfter),
      };
    } catch (err) {
      log("redis_rate_limit_error", { message: err.message, key });
      // Fail-open fallback
    }
  }

  // Memory Fallback
  let windowList = memoryRateLimits.get(key);
  if (!windowList) {
    windowList = [];
    memoryRateLimits.set(key, windowList);
  }

  // Evict timestamps older than sliding window
  const clearBefore = now - windowMs;
  windowList = windowList.filter((entry) => entry.timestamp > clearBefore);

  if (windowList.length < maxLimit) {
    windowList.push({ timestamp: now, id: memberId });
    memoryRateLimits.set(key, windowList);
    return {
      allowed: true,
      currentCount: windowList.length,
      retryAfter: 0,
    };
  }

  memoryRateLimits.set(key, windowList);
  const oldest = windowList[0];
  const retryAfter = oldest ? Math.max(0, oldest.timestamp + windowMs - now) : windowMs;
  return {
    allowed: false,
    currentCount: windowList.length,
    retryAfter,
  };
}

// ── USER MAPPING HELPERS ──────────────────────────────────────
function getUserBySocketId(socketId) {
  for (const user of memoryUsers.values()) {
    if (user.socketId === socketId) return user;
  }
  return null;
}

function getUserById(userId) {
  return memoryUsers.get(userId) || null;
}

async function redisSetUser(userId, userData) {
  memoryUsers.set(userId, userData);

  if (!isRedisReady()) return;

  try {
    const uKey = `${KEYS.USER_PREFIX}${userId}`;
    const userPayload = {
      id: userData.id || userId,
      socketId: userData.socketId || "",
      status: userData.status || "idle",
      roomId: userData.roomId || "",
      country: userData.country || "",
      joinedAt: String(userData.joinedAt || Date.now()),
      lastHeartbeat: String(userData.lastHeartbeat || Date.now()),
      isActive: userData.isActive ? "1" : "0",
    };

    const pipeline = redisClient.pipeline();
    pipeline.hset(uKey, userPayload);
    pipeline.expire(uKey, USER_TTL_SECONDS);

    if (userData.socketId) {
      const sKey = `${KEYS.SOCKET_PREFIX}${userData.socketId}`;
      pipeline.set(sKey, userId, "EX", USER_TTL_SECONDS);
    }

    await pipeline.exec();
  } catch (err) {
    log("redis_set_user_error", { userId, message: err.message });
  }
}

async function redisGetUser(userId) {
  if (isRedisReady()) {
    try {
      const uKey = `${KEYS.USER_PREFIX}${userId}`;
      const data = await redisClient.hgetall(uKey);
      if (data && data.id) {
        return {
          id: data.id,
          socketId: data.socketId || null,
          status: data.status || "idle",
          roomId: data.roomId || null,
          country: data.country || "Someone nearby",
          joinedAt: Number(data.joinedAt) || Date.now(),
          lastHeartbeat: Number(data.lastHeartbeat) || Date.now(),
          isActive: data.isActive === "1",
        };
      }
    } catch (err) {
      log("redis_get_user_error", { userId, message: err.message });
    }
  }
  return memoryUsers.get(userId) || null;
}

async function redisDeleteUser(userId) {
  const user = memoryUsers.get(userId);
  memoryUsers.delete(userId);

  if (!isRedisReady()) return;

  try {
    const pipeline = redisClient.pipeline();
    pipeline.del(`${KEYS.USER_PREFIX}${userId}`);
    if (user?.socketId) {
      pipeline.del(`${KEYS.SOCKET_PREFIX}${user.socketId}`);
    }
    await pipeline.exec();
  } catch (err) {
    log("redis_delete_user_error", { userId, message: err.message });
  }
}

// ── ATOMIC QUEUE OPERATIONS (ZSET & HSET/SET) ─────────────────
function isUserQueued(userId) {
  if (!userId || typeof userId !== "string") return false;
  return memoryWaitingSet.has(userId);
}

function enqueueUser(userId, customScore = null) {
  if (!userId || typeof userId !== "string") return false;
  if (memoryWaitingSet.has(userId)) return false;

  const score = typeof customScore === "number" && !isNaN(customScore) ? customScore : Date.now();
  memoryWaitingQueue.push(userId);
  memoryWaitingSet.add(userId);

  // Sync to Redis asynchronously
  if (isRedisReady()) {
    const pipeline = redisClient.pipeline();
    pipeline.zadd(KEYS.QUEUE, score, userId);
    pipeline.sadd(KEYS.WAITING_SET, userId);
    pipeline.hset(`${KEYS.USER_PREFIX}${userId}`, "status", "waiting", "roomId", "");
    pipeline.exec().catch((err) => {
      log("redis_enqueue_error", { userId, message: err.message });
    });
  }

  return true;
}

function removeUserFromQueue(userId) {
  if (!userId || typeof userId !== "string") return false;

  const wasInSet = memoryWaitingSet.delete(userId);
  
  // Clean all occurrences from queue array (defensive against any duplicate index races)
  let removedCount = 0;
  for (let i = memoryWaitingQueue.length - 1; i >= 0; i--) {
    if (memoryWaitingQueue[i] === userId) {
      memoryWaitingQueue.splice(i, 1);
      removedCount++;
    }
  }

  if (isRedisReady()) {
    const pipeline = redisClient.pipeline();
    pipeline.zrem(KEYS.QUEUE, userId);
    pipeline.srem(KEYS.WAITING_SET, userId);
    pipeline.exec().catch((err) => {
      log("redis_dequeue_error", { userId, message: err.message });
    });
  }

  return wasInSet || removedCount > 0;
}

function dequeueUser() {
  while (memoryWaitingQueue.length > 0) {
    const userId = memoryWaitingQueue.shift();
    if (!userId || !memoryWaitingSet.has(userId)) continue;
    memoryWaitingSet.delete(userId);

    if (isRedisReady()) {
      redisClient.zrem(KEYS.QUEUE, userId).catch(() => {});
      redisClient.srem(KEYS.WAITING_SET, userId).catch(() => {});
    }
    return userId;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// BUG FIX 1: Instant & Atomic Memory Purge on Disconnect
// ═══════════════════════════════════════════════════════════════
// Ensures a disconnecting or timed-out user is completely purged
// from all matchmaking queues, pending requests, rate-limits, and state.
function purgeUserFromAllState(userId, socketId = null) {
  if (!userId) return;

  // 1. Instantly remove from waiting queues (in-memory and Redis)
  removeUserFromQueue(userId);

  // 2. Clean up any time extension requests involving this user
  for (const [roomId, req] of memoryTimeExtensionRequests.entries()) {
    if (req.requestedBy === userId) {
      memoryTimeExtensionRequests.delete(roomId);
    }
  }

  // 3. Update user object if present
  const user = memoryUsers.get(userId);
  if (user) {
    // Only mark inactive if matching the disconnecting socket
    if (!socketId || user.socketId === socketId) {
      user.isActive = false;
      user.lastDisconnect = Date.now();
      if (user.status === "waiting") {
        user.status = "idle";
      }
    }
  }

  // 4. Redis cleanup
  if (isRedisReady()) {
    try {
      const pipeline = redisClient.pipeline();
      pipeline.zrem(KEYS.QUEUE, userId);
      pipeline.srem(KEYS.WAITING_SET, userId);
      if (socketId) {
        pipeline.del(`${KEYS.SOCKET_PREFIX}${socketId}`);
      }
      pipeline.hset(`${KEYS.USER_PREFIX}${userId}`, "status", "idle", "isActive", "0");
      pipeline.exec().catch(() => {});
    } catch {}
  }
}

// ── ATOMIC LUA MATCHMAKING ────────────────────────────────────
async function atomicMatchmake(assignedRoomId) {
  const now = Date.now();

  if (isRedisReady()) {
    try {
      const rawResult = await redisClient.popMatchPair(
        KEYS.QUEUE,
        KEYS.WAITING_SET,
        KEYS.USER_PREFIX,
        KEYS.METRICS,
        now,
        assignedRoomId,
        20
      );

      if (rawResult) {
        const parsed = JSON.parse(rawResult);
        if (parsed && parsed.ok) {
          // Synchronize memory cache
          removeUserFromQueue(parsed.userA.id);
          removeUserFromQueue(parsed.userB.id);

          const memUserA = memoryUsers.get(parsed.userA.id);
          if (memUserA) {
            memUserA.status = "matched";
            memUserA.roomId = assignedRoomId;
          }
          const memUserB = memoryUsers.get(parsed.userB.id);
          if (memUserB) {
            memUserB.status = "matched";
            memUserB.roomId = assignedRoomId;
          }

          recordMatchmakingTime(parsed.userA.waitTime || 0);
          recordMatchmakingTime(parsed.userB.waitTime || 0);
          incrementTotalMatches();

          return parsed;
        }
      }
    } catch (err) {
      log("redis_atomic_matchmake_error", { message: err.message });
    }
  }

  // Fallback: In-memory atomic pairing
  return null;
}

// ── ROOM OPERATIONS WITH TTL ──────────────────────────────────
async function redisSetRoom(roomId, roomData) {
  memoryRooms.set(roomId, roomData);

  if (!isRedisReady()) return;

  try {
    const rKey = `${KEYS.ROOM_PREFIX}${roomId}`;
    const payload = {
      id: roomId,
      users: JSON.stringify(roomData.users || []),
      status: roomData.status || "active",
      type: roomData.type || "stranger",
      createdAt: String(roomData.createdAt || Date.now()),
      endedAt: String(roomData.endedAt || 0),
    };

    const pipeline = redisClient.pipeline();
    pipeline.hset(rKey, payload);
    pipeline.expire(rKey, ROOM_TTL_SECONDS);
    pipeline.sadd(KEYS.ACTIVE_ROOMS, roomId);
    await pipeline.exec();
  } catch (err) {
    log("redis_set_room_error", { roomId, message: err.message });
  }
}

async function redisDeleteRoom(roomId) {
  memoryRooms.delete(roomId);

  if (!isRedisReady()) return;

  try {
    const pipeline = redisClient.pipeline();
    pipeline.del(`${KEYS.ROOM_PREFIX}${roomId}`);
    pipeline.srem(KEYS.ACTIVE_ROOMS, roomId);
    await pipeline.exec();
  } catch (err) {
    log("redis_delete_room_error", { roomId, message: err.message });
  }
}

// ── FRIEND & DM HELPERS ───────────────────────────────────────
function getCanonicalPairId(userAId, userBId) {
  return [userAId, userBId].sort().join("::");
}

function addFriendship(userAId, userBId) {
  if (!memoryFriendships.has(userAId)) memoryFriendships.set(userAId, new Set());
  if (!memoryFriendships.has(userBId)) memoryFriendships.set(userBId, new Set());
  memoryFriendships.get(userAId).add(userBId);
  memoryFriendships.get(userBId).add(userAId);

  if (isRedisReady()) {
    const pipeline = redisClient.pipeline();
    pipeline.sadd(`${KEYS.FRIEND_PREFIX}${userAId}`, userBId);
    pipeline.sadd(`${KEYS.FRIEND_PREFIX}${userBId}`, userAId);
    pipeline.exec().catch(() => {});
  }
}

function areFriends(userAId, userBId) {
  return memoryFriendships.get(userAId)?.has(userBId) ?? false;
}

function getFriends(userId) {
  return [...(memoryFriendships.get(userId) ?? [])];
}

function createFriendRequest(fromUserId, toUserId, requestId, roomId) {
  const req = {
    id: requestId,
    fromUserId,
    toUserId,
    status: "pending",
    roomId,
    createdAt: Date.now(),
  };
  memoryPendingFriendRequests.set(requestId, req);
  return req;
}

function acceptFriendRequest(requestId) {
  const request = memoryPendingFriendRequests.get(requestId);
  if (!request) return null;
  request.status = "accepted";
  request.acceptedAt = Date.now();
  return request;
}

function rejectFriendRequest(requestId) {
  const request = memoryPendingFriendRequests.get(requestId);
  if (!request) return null;
  request.status = "rejected";
  request.rejectedAt = Date.now();
  return request;
}

function getPendingRequestsFor(userId) {
  const requests = [];
  for (const req of memoryPendingFriendRequests.values()) {
    if (req.toUserId === userId && req.status === "pending") {
      requests.push(req);
    }
  }
  return requests;
}

function getExistingRequest(userAId, userBId) {
  for (const req of memoryPendingFriendRequests.values()) {
    if (
      (req.fromUserId === userAId && req.toUserId === userBId) ||
      (req.fromUserId === userBId && req.toUserId === userAId)
    ) {
      if (req.status === "pending" || req.status === "accepted") {
        return req;
      }
    }
  }
  return null;
}

function removeFriendRequest(requestId) {
  memoryPendingFriendRequests.delete(requestId);
}

function getFriendRoom(userAId, userBId) {
  const pairId = getCanonicalPairId(userAId, userBId);
  return memoryFriendRooms.get(pairId) ?? null;
}

function createFriendRoomEntry(userAId, userBId) {
  const pairId = getCanonicalPairId(userAId, userBId);
  const roomId = ['friend_chat', ...[userAId, userBId].sort()].join('_');

  const entry = {
    pairId,
    roomId,
    userIds: [userAId, userBId],
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  memoryFriendRooms.set(pairId, entry);
  return entry;
}

function appendFriendRoomMessage(userAId, userBId, message) {
  const room = getFriendRoom(userAId, userBId);
  if (!room) return null;

  if (!Array.isArray(room.messages)) room.messages = [];
  room.messages.push(message);
  room.updatedAt = Date.now();

  const MAX_FRIEND_DM_MESSAGES = 200;
  if (room.messages.length > MAX_FRIEND_DM_MESSAGES) {
    room.messages = room.messages.slice(-MAX_FRIEND_DM_MESSAGES);
  }

  if (isRedisReady()) {
    const pairId = getCanonicalPairId(userAId, userBId);
    const key = `${KEYS.DM_PREFIX}${pairId}`;
    redisClient
      .rpush(key, JSON.stringify(message))
      .then(() => redisClient.ltrim(key, -MAX_FRIEND_DM_MESSAGES, -1))
      .catch(() => {});
  }

  return room;
}

function getFriendRoomMessages(userAId, userBId) {
  const room = getFriendRoom(userAId, userBId);
  if (!room) return [];
  return Array.isArray(room.messages) ? room.messages : [];
}

// ── METRICS & STATS ───────────────────────────────────────────
function recordMatchmakingTime(durationMs) {
  matchmakingTimes.push(durationMs);
  if (matchmakingTimes.length > 100) matchmakingTimes.shift();
}

function getAverageMatchmakingTime() {
  if (matchmakingTimes.length === 0) return 0;
  const sum = matchmakingTimes.reduce((a, b) => a + b, 0);
  return Math.round(sum / matchmakingTimes.length);
}

function incrementTotalMatches() {
  totalMatchesCount++;
}

function getMetrics() {
  let activeCount = 0;
  for (const user of memoryUsers.values()) {
    if (user.isActive) activeCount++;
  }
  return {
    activeUsers: activeCount,
    queueSize: memoryWaitingQueue.length,
    activeRooms: memoryRooms.size,
    averageMatchmakingTime: getAverageMatchmakingTime(),
    totalMatches: totalMatchesCount,
    redisConnected: isRedisReady(),
  };
}

// ── PERIODIC IN-MEMORY GARBAGE COLLECTION & PURGING ───────────
// Sweeps memoryRateLimits every 3 minutes to purge abandoned keys
setInterval(() => {
  const cutoff = Date.now() - 300000;
  for (const [key, list] of memoryRateLimits.entries()) {
    const active = list.filter((entry) => entry.timestamp > cutoff);
    if (active.length === 0) {
      memoryRateLimits.delete(key);
    } else {
      memoryRateLimits.set(key, active);
    }
  }
}, 3 * 60 * 1000).unref();

// Sweeps inactive ephemeral users older than 24 hours every 15 minutes
setInterval(() => {
  const cutoff = Date.now() - USER_TTL_SECONDS * 1000;
  for (const [userId, user] of memoryUsers.entries()) {
    // Only remove if completely idle, disconnected, and not in an active room
    if (!user.isActive && user.status === "idle" && !user.roomId && (!user.lastHeartbeat || Number(user.lastHeartbeat) < cutoff)) {
      memoryUsers.delete(userId);
    }
  }
}, 15 * 60 * 1000).unref();

// Sweeps old/rejected friend requests older than 7 days every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  for (const [reqId, req] of memoryPendingFriendRequests.entries()) {
    if (req.createdAt < cutoff || req.status === "rejected") {
      memoryPendingFriendRequests.delete(reqId);
    }
  }
}, 30 * 60 * 1000).unref();

// ── MODULE EXPORTS ────────────────────────────────────────────
module.exports = {
  // Underlying redis instances & helpers
  redisClient,
  isRedisReady,
  initializeRedis,
  checkSlidingWindowRateLimit,

  // Async Redis wrappers
  redisSetUser,
  redisGetUser,
  redisDeleteUser,
  redisSetRoom,
  redisDeleteRoom,
  atomicMatchmake,

  // Synchronous Map-compatible collections
  users: memoryUsers,
  waitingQueue: memoryWaitingQueue,
  waitingSet: memoryWaitingSet,
  rooms: memoryRooms,
  friendships: memoryFriendships,
  friendRooms: memoryFriendRooms,
  pendingFriendRequests: memoryPendingFriendRequests,
  timeExtensionRequests: memoryTimeExtensionRequests,

  // Synchronous contract helpers
  getUserBySocketId,
  getUserById,
  isUserQueued,
  enqueueUser,
  dequeueUser,
  removeUserFromQueue,
  addFriendship,
  areFriends,
  getFriends,
  getFriendRoom,
  createFriendRoomEntry,
  appendFriendRoomMessage,
  getFriendRoomMessages,
  getCanonicalPairId,
  createFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  getPendingRequestsFor,
  getExistingRequest,
  removeFriendRequest,
  recordMatchmakingTime,
  incrementTotalMatches,
  getMetrics,
  purgeUserFromAllState,
};
