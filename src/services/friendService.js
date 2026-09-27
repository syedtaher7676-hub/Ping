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
  getPendingRequestsFor,
  rooms
} = require("../state/store");
const { log } = require("../utils/logger");

/**
 * Handles sending a friend request.
 * Mutual acceptance is required to become friends.
 */
function sendFriendRequest(fromUserId, toUserId, roomId) {
  const fromUser = users && typeof users.get === "function" ? users.get(fromUserId) : null;
  const toUser = users && typeof users.get === "function" ? users.get(toUserId) : null;

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
  // Safe State Lookup: Ensure we have a request. Fallback through helpers and Map methods safely.
  const requests = typeof getPendingRequestsFor === "function" ? getPendingRequestsFor(userId) : [];
  let request = requests.find(r => r.id === requestId);

  if (!request && pendingFriendRequests && typeof pendingFriendRequests.get === "function") {
    request = pendingFriendRequests.get(requestId);
  }

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
  if (rooms && typeof rooms.has === "function" && typeof rooms.set === "function") {
    if (!rooms.has(friendRoom.roomId)) {
      const now = Date.now();
      rooms.set(friendRoom.roomId, {
        roomId: friendRoom.roomId,
        status: "active",
        type: "friend_dm",
        users: [fromUserId, toUserId],
        createdAt: friendRoom?.createdAt || now,
        lastActivityAt: friendRoom?.updatedAt || friendRoom?.createdAt || now,
        endAt: null,
        remainingMs: null,
      });
    }
  }

  // Multi-Socket Dynamic Joining:
  // Search connected sockets for both fromUserId and toUserId and dynamically execute join for both
  if (io) {
    const targetUserIds = new Set([fromUserId, toUserId]);
    let sockets = [];

    try {
      if (io.sockets && io.sockets.sockets) {
        if (typeof io.sockets.sockets.values === "function") {
          sockets = Array.from(io.sockets.sockets.values());
        } else if (typeof io.sockets.sockets === "object") {
          sockets = Object.values(io.sockets.sockets);
        }
      }
      if (sockets.length === 0 && io.of && io.of("/")) {
        const ns = io.of("/");
        if (ns.sockets) {
          if (typeof ns.sockets.values === "function") {
            sockets = Array.from(ns.sockets.values());
          } else if (typeof ns.sockets === "object") {
            sockets = Object.values(ns.sockets);
          }
        }
      }
    } catch (err) {
      log("error_fetching_sockets_dynamic_join", { message: err.message });
    }

    for (const s of sockets) {
      if (s) {
        const socketUserId = s.userId || s.data?.userId;
        if (socketUserId && targetUserIds.has(socketUserId)) {
          try {
            s.join(friendRoom.roomId);
            log("dynamic_socket_join", { userId: socketUserId, socketId: s.id, roomId: friendRoom.roomId });
          } catch (joinErr) {
            log("error_socket_join", { socketId: s.id, roomId: friendRoom.roomId, message: joinErr.message });
          }
        }
      }
    }
  }

  log("friendship_created", { fromUserId, toUserId, roomId: friendRoom.roomId });

  return { 
    ok: true, 
    accepted: true, 
    fromUserId, 
    roomId: friendRoom.roomId,
    friendCountry: (users && typeof users.get === "function" && users.get(fromUserId)?.country) || "Unknown"
  };
}

/**
 * Gets the list of friends for a user with their current status.
 */
function getFriendsList(userId) {
  const friendIds = typeof getFriends === "function" ? getFriends(userId) : [];
  if (!Array.isArray(friendIds)) return [];

  return friendIds.map(fId => {
    const friend = users && typeof users.get === "function" ? users.get(fId) : null;
    const room = typeof getFriendRoom === "function" ? getFriendRoom(userId, fId) : null;
    
    let username = "Unknown";
    let displayName = "Unknown";

    if (friend) {
      username = friend.username || friend.displayName || friend.profile?.username || friend.profile?.displayName || `user_${fId}`;
      displayName = friend.displayName || friend.username || friend.profile?.displayName || friend.profile?.username || `User_${fId}`;
    } else {
      username = `user_${fId}`;
      displayName = `User_${fId}`;
    }

    // Double-check display name/username aren't null or undefined or empty strings
    if (!username || typeof username !== "string" || username.trim() === "") {
      username = `user_${fId}`;
    }
    if (!displayName || typeof displayName !== "string" || displayName.trim() === "") {
      displayName = `User_${fId}`;
    }
    
    const messages = room && Array.isArray(room.messages) ? room.messages : [];
    // Defensive check to avoid index-out-of-bounds or negative lookups
    const lastMessage = (messages.length > 0 && messages[messages.length - 1])
      ? (messages[messages.length - 1].message || "")
      : "";

    return {
      friendId: fId,
      country: friend?.country || "Unknown",
      username: username,
      displayName: displayName,
      online: friend ? friend.isActive : false,
      lastSeen: friend ? friend.lastDisconnect : null,
      dmRoomId: room?.roomId || null,
      lastActivityAt: room?.updatedAt || room?.createdAt || Date.now(),
      lastMessage: lastMessage
    };
  }).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

module.exports = {
  sendFriendRequest,
  respondToFriendRequest,
  getFriendsList
};
