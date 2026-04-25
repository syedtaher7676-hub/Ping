const { 
  users, 
  friendships, 
  friendRooms, 
  pendingFriendRequests, 
  addFriendship, 
  areFriends, 
  getFriends, 
  getFriendRoom, 
  createFriendRoomEntry,
  createFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  getExistingRequest,
  removeFriendRequest,
  rooms
} = require("../state/store");
const { log } = require("../utils/logger");

/**
 * Handles sending a friend request.
 * Mutual acceptance is required to become friends.
 */
function sendFriendRequest(fromUserId, toUserId, roomId) {
  const fromUser = users.get(fromUserId);
  const toUser = users.get(toUserId);

  if (!fromUser || !toUser) {
    return { ok: false, reason: "user_not_found" };
  }

  if (fromUserId === toUserId) {
    return { ok: false, reason: "self_request" };
  }

  if (areFriends(fromUserId, toUserId)) {
    return { ok: false, reason: "already_friends" };
  }

  const existing = getExistingRequest(fromUserId, toUserId);
  if (existing) {
    if (existing.status === "pending") {
      return { ok: false, reason: "already_pending" };
    }
  }

  const requestId = `freq_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  const request = createFriendRequest(fromUserId, toUserId, requestId, roomId);

  log("friend_request_created", { requestId, fromUserId, toUserId, roomId });

  return { ok: true, requestId, request };
}

/**
 * Handles responding to a friend request.
 */
function respondToFriendRequest(requestId, userId, accept, io) {
  const request = pendingFriendRequests.get(requestId);

  if (!request || request.toUserId !== userId) {
    return { ok: false, reason: "not_found" };
  }

  if (request.status !== "pending") {
    return { ok: false, reason: "already_processed" };
  }

  if (!accept) {
    rejectFriendRequest(requestId);
    log("friend_request_rejected", { requestId, fromUserId: request.fromUserId, toUserId: userId });
    return { ok: true, accepted: false, fromUserId: request.fromUserId };
  }

  // Accept request
  const fromUserId = request.fromUserId;
  const toUserId = request.toUserId;

  if (areFriends(fromUserId, toUserId)) {
    removeFriendRequest(requestId);
    return { ok: false, reason: "already_friends" };
  }

  addFriendship(fromUserId, toUserId);
  acceptFriendRequest(requestId);

  // Get or create stable friend room
  let friendRoom = getFriendRoom(fromUserId, toUserId);
  if (!friendRoom) {
    friendRoom = createFriendRoomEntry(fromUserId, toUserId);
  }

  // Register in active rooms for socket.io functionality
  if (!rooms.has(friendRoom.roomId)) {
    rooms.set(friendRoom.roomId, {
      roomId: friendRoom.roomId,
      status: "active",
      type: "friend_dm",
      users: [fromUserId, toUserId],
      createdAt: friendRoom.createdAt,
      endAt: null,
      remainingMs: null,
    });
  }

  log("friendship_created", { fromUserId, toUserId, roomId: friendRoom.roomId });

  return { 
    ok: true, 
    accepted: true, 
    fromUserId, 
    roomId: friendRoom.roomId,
    friendCountry: users.get(fromUserId)?.country || "Unknown"
  };
}

/**
 * Gets the list of friends for a user with their current status.
 */
function getFriendsList(userId) {
  const friendIds = getFriends(userId);
  return friendIds.map(fId => {
    const friend = users.get(fId);
    const room = getFriendRoom(userId, fId);
    return {
      friendId: fId,
      country: friend?.country || "Unknown",
      online: friend ? friend.isActive : false,
      lastSeen: friend ? friend.lastDisconnect : null,
      dmRoomId: room?.roomId || null,
      lastActivityAt: room?.updatedAt || room?.createdAt || 0,
      lastMessage: room?.messages?.[room.messages.length - 1]?.message || ""
    };
  }).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

module.exports = {
  sendFriendRequest,
  respondToFriendRequest,
  getFriendsList
};
