/**
 * ─────────────────────────────────────────────────────────────
 * Cloud Firestore Database Service for Ping
 * ─────────────────────────────────────────────────────────────
 * Handles persistent data storage for:
 *  - users (profiles, total matches, creation dates)
 *  - friendships (accepted friend relationships & canonical pair IDs)
 *  - friend_requests (pending, accepted, rejected friend requests)
 *  - reports (user report logs and moderation flags)
 *
 * HYBRID ARCHITECTURE RULE:
 *  - Live stranger chat & flash messages are purely in-memory / Redis.
 *  - Firestore writes are strictly reserved for state transitions
 *    (friend requests, profiles, friendships, reports).
 */

const firebaseConfig = require("../config/firebase");
const { FieldValue } = firebaseConfig;

function getDb() {
  return firebaseConfig.getDb();
}

function isFirebaseConfigured() {
  return firebaseConfig.isFirebaseConfigured();
}

// Collection name constants
const COLLECTIONS = {
  USERS: "users",
  FRIENDSHIPS: "friendships",
  FRIEND_REQUESTS: "friend_requests",
  FRIEND_CHATS: "friend_chats",
  REPORTS: "reports",
};

let hasWarnedAuthError = false;

/**
 * Handles database errors with automatic fail-open detection.
 * If credentials lack permissions or are unauthenticated, gracefully disables
 * remote calls and routes to in-memory / Redis store without continuous warning spam.
 *
 * @param {string} operation
 * @param {Error} error
 * @param {string} [targetId]
 */
function handleDbError(operation, error, targetId = "") {
  const errMsg = error?.message || String(error);
  const isAuthOrPermError =
    errMsg.includes("PERMISSION_DENIED") ||
    errMsg.includes("UNAUTHENTICATED") ||
    errMsg.includes("invalid credential") ||
    errMsg.includes("Project not found");

  if (isAuthOrPermError) {
    if (!hasWarnedAuthError) {
      console.log(
        `ℹ️ [Firestore] Remote database access suspended (${operation}: ${errMsg.slice(0, 80)}). Operating in high-performance in-memory mode.`
      );
      hasWarnedAuthError = true;
    }
    firebaseConfig.disableDb();
  }
}

/**
 * Returns canonical pair ID for two users (e.g., 'usr1__usr2')
 * @param {string} userAId
 * @param {string} userBId
 * @returns {string}
 */
function getCanonicalPairId(userAId, userBId) {
  return [userAId, userBId].sort().join("__");
}

// ═══════════════════════════════════════════════════════════════
//  USER OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Asynchronously synchronizes user profile upon socket authentication.
 * If user does not exist in Firestore, creates an initial record.
 * If user exists, updates lastSeenAt and returns persistent profile data.
 *
 * @param {string} userId
 * @param {object} meta - Optional initial metadata (country, etc.)
 * @returns {Promise<object|null>} Persistent user profile
 */
async function syncUserOnAuth(userId, meta = {}) {
  const db = getDb();
  if (!db || !userId) return null;

  try {
    const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
    const docSnap = await userRef.get();

    if (!docSnap.exists) {
      const newUser = {
        userId,
        country: meta.country || "Unknown",
        totalMatches: 0,
        createdAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        profile: {
          displayName: meta.displayName || `Stranger_${userId.slice(0, 4)}`,
          bio: meta.bio || "",
          interests: Array.isArray(meta.interests) ? meta.interests : [],
        },
      };
      await userRef.set(newUser);
      return { ...newUser, isNew: true };
    } else {
      await userRef.update({
        lastSeenAt: FieldValue.serverTimestamp(),
        ...(meta.country && meta.country !== "Unknown" ? { country: meta.country } : {}),
      });
      return { id: docSnap.id, ...docSnap.data() };
    }
  } catch (error) {
    handleDbError("syncUserOnAuth", error, userId);
    return null;
  }
}

/**
 * Retrieves a user profile document from Firestore
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function getUserProfile(userId) {
  const db = getDb();
  if (!db || !userId) return null;

  try {
    const docSnap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (!docSnap.exists) return null;
    return { id: docSnap.id, ...docSnap.data() };
  } catch (error) {
    handleDbError("getUserProfile", error, userId);
    return null;
  }
}

/**
 * Updates a user's persistent profile data
 * @param {string} userId
 * @param {object} profileData
 * @returns {Promise<boolean>}
 */
async function updateUserProfile(userId, profileData = {}) {
  const db = getDb();
  if (!db || !userId) return false;

  try {
    const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
    await userRef.set(
      {
        ...profileData,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch (error) {
    handleDbError("updateUserProfile", error, userId);
    return false;
  }
}

/**
 * Atomically increments the total match count for a user in Firestore
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function incrementUserMatchCount(userId) {
  const db = getDb();
  if (!db || !userId) return false;

  try {
    const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
    await userRef.set(
      {
        totalMatches: FieldValue.increment(1),
        lastMatchAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch (error) {
    handleDbError("incrementUserMatchCount", error, userId);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
//  FRIENDSHIP OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Persists an accepted friendship with a canonical pair ID
 * @param {string} userAId
 * @param {string} userBId
 * @returns {Promise<object|null>}
 */
async function saveFriendship(userAId, userBId) {
  const db = getDb();
  if (!db || !userAId || !userBId) return null;

  try {
    const pairId = getCanonicalPairId(userAId, userBId);
    const docRef = db.collection(COLLECTIONS.FRIENDSHIPS).doc(pairId);

    const friendshipData = {
      pairId,
      userAId,
      userBId,
      users: [userAId, userBId],
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await docRef.set(friendshipData, { merge: true });
    return friendshipData;
  } catch (error) {
    handleDbError("saveFriendship", error, `${userAId}-${userBId}`);
    return null;
  }
}

/**
 * Fetches the persistent friends list for a user from Firestore
 * @param {string} userId
 * @returns {Promise<Array<object>>} List of friend relations
 */
async function getUserFriends(userId) {
  const db = getDb();
  if (!db || !userId) return [];

  try {
    const snapshot = await db
      .collection(COLLECTIONS.FRIENDSHIPS)
      .where("users", "array-contains", userId)
      .where("status", "==", "active")
      .get();

    const friends = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const friendId = data.users.find((uid) => uid !== userId);
      if (friendId) {
        friends.push({
          friendId,
          pairId: data.pairId,
          createdAt: data.createdAt ? data.createdAt.toMillis?.() || Date.now() : Date.now(),
        });
      }
    });

    return friends;
  } catch (error) {
    handleDbError("getUserFriends", error, userId);
    return [];
  }
}

/**
 * Soft-removes or deactivates a friendship
 * @param {string} userAId
 * @param {string} userBId
 * @returns {Promise<boolean>}
 */
async function removeFriendship(userAId, userBId) {
  const db = getDb();
  if (!db || !userAId || !userBId) return false;

  try {
    const pairId = getCanonicalPairId(userAId, userBId);
    await db.collection(COLLECTIONS.FRIENDSHIPS).doc(pairId).update({
      status: "inactive",
      removedAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch (error) {
    handleDbError("removeFriendship", error, `${userAId}-${userBId}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
//  FRIEND REQUEST OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Creates and persists a pending friend request
 * @param {object} params
 * @param {string} params.requestId
 * @param {string} params.fromUserId
 * @param {string} params.toUserId
 * @param {string} [params.roomId]
 * @returns {Promise<object|null>}
 */
async function createFriendRequest({ requestId, fromUserId, toUserId, roomId }) {
  const db = getDb();
  if (!db || !requestId) return null;

  try {
    const requestData = {
      requestId,
      fromUserId,
      toUserId,
      roomId: roomId || null,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await db.collection(COLLECTIONS.FRIEND_REQUESTS).doc(requestId).set(requestData);
    return requestData;
  } catch (error) {
    handleDbError("createFriendRequest", error, requestId);
    return null;
  }
}

/**
 * Updates friend request status (accepted / rejected)
 * @param {string} requestId
 * @param {"accepted"|"rejected"} status
 * @param {object} [extraData]
 * @returns {Promise<boolean>}
 */
async function updateFriendRequestStatus(requestId, status, extraData = {}) {
  const db = getDb();
  if (!db || !requestId) return false;

  try {
    const updatePayload = {
      status,
      updatedAt: FieldValue.serverTimestamp(),
      ...extraData,
    };

    if (status === "accepted") {
      updatePayload.acceptedAt = FieldValue.serverTimestamp();
    } else if (status === "rejected") {
      updatePayload.rejectedAt = FieldValue.serverTimestamp();
    }

    await db.collection(COLLECTIONS.FRIEND_REQUESTS).doc(requestId).update(updatePayload);
    return true;
  } catch (error) {
    handleDbError("updateFriendRequestStatus", error, requestId);
    return false;
  }
}

/**
 * Retrieves pending friend requests for a recipient user
 * @param {string} userId
 * @returns {Promise<Array<object>>}
 */
async function getPendingRequestsForUser(userId) {
  const db = getDb();
  if (!db || !userId) return [];

  try {
    const snapshot = await db
      .collection(COLLECTIONS.FRIEND_REQUESTS)
      .where("toUserId", "==", userId)
      .where("status", "==", "pending")
      .get();

    const requests = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      requests.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt ? data.createdAt.toMillis?.() || Date.now() : Date.now(),
      });
    });

    return requests;
  } catch (error) {
    handleDbError("getPendingRequestsForUser", error, userId);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
//  REPORT OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Persists a user moderation report to Firestore
 * @param {object} report
 * @param {string} report.reportId
 * @param {string} report.reporterId
 * @param {string} [report.reporterCountry]
 * @param {string} report.reportedUserId
 * @param {string} [report.reportedUserCountry]
 * @param {string} [report.roomId]
 * @param {string} report.reason
 * @param {Array<string>} [report.moderationFlags]
 * @returns {Promise<object|null>}
 */
async function saveReport({
  reportId,
  reporterId,
  reporterCountry,
  reportedUserId,
  reportedUserCountry,
  roomId,
  reason,
  moderationFlags = [],
}) {
  const db = getDb();
  if (!db || !reportId) return null;

  try {
    const reportData = {
      reportId,
      reporterId,
      reporterCountry: reporterCountry || "Unknown",
      reportedUserId: reportedUserId || "Unknown",
      reportedUserCountry: reportedUserCountry || "Unknown",
      roomId: roomId || null,
      reason: reason || "user_reported",
      moderationFlags: Array.isArray(moderationFlags) ? moderationFlags : [],
      status: "pending_review",
      createdAt: FieldValue.serverTimestamp(),
    };

    await db.collection(COLLECTIONS.REPORTS).doc(reportId).set(reportData);
    return reportData;
  } catch (error) {
    handleDbError("saveReport", error, reportId);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  FRIEND CHAT & MESSAGE OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Persists a friend direct message into Cloud Firestore
 * @param {object} params
 * @param {string} params.chatId - Canonical pair room ID or pair ID
 * @param {string} params.messageId
 * @param {string} params.fromUserId
 * @param {string} params.message
 * @param {object} [params.replyTo]
 * @param {boolean} [params.isFlash]
 * @param {number} [params.sentAt]
 * @returns {Promise<object|null>}
 */
async function saveFriendChatMessage({
  chatId,
  messageId,
  fromUserId,
  message,
  replyTo = null,
  isFlash = false,
  sentAt = Date.now(),
}) {
  const db = getDb();
  if (!db || !chatId || !messageId) return null;

  try {
    const chatDocRef = db.collection(COLLECTIONS.FRIEND_CHATS).doc(chatId);
    const msgDocRef = chatDocRef.collection("messages").doc(messageId);

    const messageData = {
      messageId,
      chatId,
      fromUserId,
      message,
      replyTo: replyTo || null,
      isFlash: Boolean(isFlash),
      isEdited: false,
      sentAt,
      createdAt: FieldValue.serverTimestamp(),
    };

    // Save message document
    await msgDocRef.set(messageData);

    // Update parent conversation metadata
    const userIds = chatId.includes("__") ? chatId.split("__") : [];
    await chatDocRef.set(
      {
        chatId,
        participants: userIds.length === 2 ? userIds : [],
        lastMessage: isFlash ? "[Flash Message]" : message.slice(0, 200),
        lastMessageAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return messageData;
  } catch (error) {
    handleDbError("saveFriendChatMessage", error, `${chatId}/${messageId}`);
    return null;
  }
}

/**
 * Loads persistent chat message history for a friend chat from Firestore
 * @param {string} chatId
 * @param {number} [limitCount=50]
 * @returns {Promise<Array<object>>}
 */
async function getFriendChatMessages(chatId, limitCount = 50) {
  const db = getDb();
  if (!db || !chatId) return [];

  try {
    const snapshot = await db
      .collection(COLLECTIONS.FRIEND_CHATS)
      .doc(chatId)
      .collection("messages")
      .orderBy("sentAt", "asc")
      .limit(limitCount)
      .get();

    const messages = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      messages.push({
        msgId: data.messageId || docSnap.id,
        from: data.fromUserId,
        message: data.message,
        replyTo: data.replyTo || null,
        isFlash: Boolean(data.isFlash),
        isEdited: Boolean(data.isEdited),
        sentAt: data.sentAt || (data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now()),
      });
    });

    return messages;
  } catch (error) {
    handleDbError("getFriendChatMessages", error, chatId);
    return [];
  }
}

/**
 * Updates an edited message in Firestore
 * @param {string} chatId
 * @param {string} messageId
 * @param {string} fromUserId
 * @param {string} newMessage
 * @returns {Promise<boolean>}
 */
async function editFriendChatMessage(chatId, messageId, fromUserId, newMessage) {
  const db = getDb();
  if (!db || !chatId || !messageId) return false;

  try {
    const msgRef = db.collection(COLLECTIONS.FRIEND_CHATS).doc(chatId).collection("messages").doc(messageId);
    const snap = await msgRef.get();
    if (!snap.exists || snap.data()?.fromUserId !== fromUserId) return false;

    await msgRef.update({
      message: newMessage,
      isEdited: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch (error) {
    handleDbError("editFriendChatMessage", error, `${chatId}/${messageId}`);
    return false;
  }
}

/**
 * Deletes a message from Firestore
 * @param {string} chatId
 * @param {string} messageId
 * @param {string} fromUserId
 * @returns {Promise<boolean>}
 */
async function deleteFriendChatMessage(chatId, messageId, fromUserId) {
  const db = getDb();
  if (!db || !chatId || !messageId) return false;

  try {
    const msgRef = db.collection(COLLECTIONS.FRIEND_CHATS).doc(chatId).collection("messages").doc(messageId);
    const snap = await msgRef.get();
    if (!snap.exists || snap.data()?.fromUserId !== fromUserId) return false;

    await msgRef.delete();
    return true;
  } catch (error) {
    handleDbError("deleteFriendChatMessage", error, `${chatId}/${messageId}`);
    return false;
  }
}

// ── MODULE EXPORTS ────────────────────────────────────────────
module.exports = {
  COLLECTIONS,
  getCanonicalPairId,
  // User operations
  syncUserOnAuth,
  getUserProfile,
  updateUserProfile,
  incrementUserMatchCount,
  // Friendship operations
  saveFriendship,
  getUserFriends,
  removeFriendship,
  // Friend request operations
  createFriendRequest,
  updateFriendRequestStatus,
  getPendingRequestsForUser,
  // Friend chat operations
  saveFriendChatMessage,
  getFriendChatMessages,
  editFriendChatMessage,
  deleteFriendChatMessage,
  // Report operations
  saveReport,
  isFirebaseConfigured,
};
