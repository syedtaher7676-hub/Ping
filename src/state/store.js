const users = new Map();
const waitingQueue = [];
const waitingSet = new Set();
const rooms = new Map();

// ── FRIEND SYSTEM STATE ───────────────────────────────────────
// friendships: userId → Set<friendId>
const friendships = new Map();
// friendRooms: canonicalPairId → { roomId, userIds, messages[], createdAt }
const friendRooms = new Map();
// pendingFriendRequests: Map of requestId → { fromUserId, toUserId, roomId, createdAt }
const pendingFriendRequests = new Map();
// timeExtensionRequests: roomId → { requestedBy, respondedAt }
const timeExtensionRequests = new Map();

// ── METRICS ───────────────────────────────────────────────────
let matchmakingTimes = [];
let totalMatchesCount = 0;

// ── USER HELPERS ──────────────────────────────────────────────
function getUserBySocketId(socketId) {
  for (const user of users.values()) {
    if (user.socketId === socketId) return user;
  }
  return null;
}

function getUserById(userId) {
  return users.get(userId);
}

// ── QUEUE HELPERS ─────────────────────────────────────────────
function isUserQueued(userId) {
  return waitingSet.has(userId);
}

function enqueueUser(userId) {
  if (waitingSet.has(userId)) return false;
  waitingQueue.push(userId);
  waitingSet.add(userId);
  return true;
}

function removeUserFromQueue(userId) {
  if (!waitingSet.has(userId)) return false;
  waitingSet.delete(userId);
  const index = waitingQueue.indexOf(userId);
  if (index !== -1) waitingQueue.splice(index, 1);
  return true;
}

function dequeueUser() {
  while (waitingQueue.length > 0) {
    const userId = waitingQueue.shift();
    if (!waitingSet.has(userId)) continue;
    waitingSet.delete(userId);
    return userId;
  }
  return null;
}

// ── FRIEND HELPERS ────────────────────────────────────────────
function getCanonicalPairId(userAId, userBId) {
  return [userAId, userBId].sort().join('::');
}

function addFriendship(userAId, userBId) {
  if (!friendships.has(userAId)) friendships.set(userAId, new Set());
  if (!friendships.has(userBId)) friendships.set(userBId, new Set());
  friendships.get(userAId).add(userBId);
  friendships.get(userBId).add(userAId);
}

function areFriends(userAId, userBId) {
  return friendships.get(userAId)?.has(userBId) ?? false;
}

function getFriends(userId) {
  return [...(friendships.get(userId) ?? [])];
}

// Create a friend request (pending, accepted, or rejected)
function createFriendRequest(fromUserId, toUserId, requestId, roomId) {
  pendingFriendRequests.set(requestId, {
    id: requestId,
    fromUserId,
    toUserId,
    status: "pending",
    roomId,
    createdAt: Date.now(),
  });
  return pendingFriendRequests.get(requestId);
}

// Accept a friend request
function acceptFriendRequest(requestId) {
  const request = pendingFriendRequests.get(requestId);
  if (!request) return null;
  request.status = "accepted";
  request.acceptedAt = Date.now();
  return request;
}

// Reject a friend request
function rejectFriendRequest(requestId) {
  const request = pendingFriendRequests.get(requestId);
  if (!request) return null;
  request.status = "rejected";
  request.rejectedAt = Date.now();
  return request;
}

// Get pending friend requests for a user (as receiver)
function getPendingRequestsFor(userId) {
  const requests = [];
  for (const req of pendingFriendRequests.values()) {
    if (req.toUserId === userId && req.status === "pending") {
      requests.push(req);
    }
  }
  return requests;
}

// Check if there's an existing request between two users (pending or accepted)
function getExistingRequest(userAId, userBId) {
  for (const req of pendingFriendRequests.values()) {
    if ((req.fromUserId === userAId && req.toUserId === userBId) ||
      (req.fromUserId === userBId && req.toUserId === userAId)) {
      if (req.status === "pending" || req.status === "accepted") {
        return req;
      }
    }
  }
  return null;
}

// Cleanup: Remove rejected requests after some time or manually
function removeFriendRequest(requestId) {
  pendingFriendRequests.delete(requestId);
}

function getFriendRoom(userAId, userBId) {
  const pairId = getCanonicalPairId(userAId, userBId);
  return friendRooms.get(pairId) ?? null;
}

function createFriendRoomEntry(userAId, userBId) {
  const pairId = getCanonicalPairId(userAId, userBId);
  // Stable roomId based on sorted user IDs
  const roomId = `dm_${pairId.replace('::', '_')}`;

  const entry = {
    pairId,
    roomId,
    userIds: [userAId, userBId],
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  friendRooms.set(pairId, entry);
  return entry;
}

function appendFriendRoomMessage(userAId, userBId, message) {
  const room = getFriendRoom(userAId, userBId);
  if (!room) return null;

  if (!Array.isArray(room.messages)) room.messages = [];
  room.messages.push(message);
  room.updatedAt = Date.now();

  // Keep a capped history in memory.
  const MAX_FRIEND_DM_MESSAGES = 200;
  if (room.messages.length > MAX_FRIEND_DM_MESSAGES) {
    room.messages = room.messages.slice(-MAX_FRIEND_DM_MESSAGES);
  }
  return room;
}

function getFriendRoomMessages(userAId, userBId) {
  const room = getFriendRoom(userAId, userBId);
  if (!room) return [];
  return Array.isArray(room.messages) ? room.messages : [];
}

// ── METRICS HELPERS ───────────────────────────────────────────
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
  for (const user of users.values()) {
    if (user.isActive) activeCount++;
  }
  return {
    activeUsers: activeCount,
    queueSize: waitingQueue.length,
    activeRooms: rooms.size,
    averageMatchmakingTime: getAverageMatchmakingTime(),
    totalMatches: totalMatchesCount,
  };
}

module.exports = {
  users,
  waitingQueue,
  waitingSet,
  rooms,
  friendships,
  friendRooms,
  pendingFriendRequests,
  timeExtensionRequests,
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
};
