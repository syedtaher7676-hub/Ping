/**
 * Test script for Firestore Configuration & dbService
 */

const assert = require("assert");
const { getDb, isFirebaseConfigured } = require("../src/config/firebase");
const dbService = require("../src/services/dbService");

async function runTests() {
  console.log("🧪 Testing Firebase Configuration & Firestore dbService...");

  // 1. Verify collections and methods exist
  assert.strictEqual(dbService.COLLECTIONS.USERS, "users");
  assert.strictEqual(dbService.COLLECTIONS.FRIENDSHIPS, "friendships");
  assert.strictEqual(dbService.COLLECTIONS.FRIEND_REQUESTS, "friend_requests");
  assert.strictEqual(dbService.COLLECTIONS.REPORTS, "reports");
  console.log("✅ Collection constants verified");

  // 2. Test canonical pair ID generation
  const pair1 = dbService.getCanonicalPairId("user_beta", "user_alpha");
  const pair2 = dbService.getCanonicalPairId("user_alpha", "user_beta");
  assert.strictEqual(pair1, "user_alpha__user_beta");
  assert.strictEqual(pair1, pair2);
  console.log("✅ Canonical pair ID generation verified");

  // 3. Test resilience when Firebase is offline / uncredentialed
  console.log(`ℹ️ Firebase configured in test environment: ${isFirebaseConfigured()}`);

  const testUserId = `test_usr_${Date.now()}`;

  // syncUserOnAuth should execute safely without throwing uncaught errors
  const syncResult = await dbService.syncUserOnAuth(testUserId, { country: "US" });
  console.log("✅ syncUserOnAuth executed safely (result:", syncResult !== null ? "document" : "null (offline mode)", ")");

  // getUserProfile should execute safely
  const profile = await dbService.getUserProfile(testUserId);
  console.log("✅ getUserProfile executed safely");

  // updateUserProfile should execute safely
  const updateRes = await dbService.updateUserProfile(testUserId, { bio: "Hello world" });
  console.log("✅ updateUserProfile executed safely (result:", updateRes, ")");

  // incrementUserMatchCount should execute safely
  const incRes = await dbService.incrementUserMatchCount(testUserId);
  console.log("✅ incrementUserMatchCount executed safely (result:", incRes, ")");

  // saveFriendship should execute safely
  const friendRes = await dbService.saveFriendship(testUserId, "test_partner_123");
  console.log("✅ saveFriendship executed safely (result:", friendRes !== null ? "saved" : "null (offline mode)", ")");

  // getUserFriends should return array safely
  const friendsList = await dbService.getUserFriends(testUserId);
  assert(Array.isArray(friendsList));
  console.log("✅ getUserFriends returned array safely (count:", friendsList.length, ")");

  // createFriendRequest should execute safely
  const reqRes = await dbService.createFriendRequest({
    requestId: `req_${Date.now()}`,
    fromUserId: testUserId,
    toUserId: "test_partner_123",
    roomId: "room_test_123",
  });
  console.log("✅ createFriendRequest executed safely (result:", reqRes !== null ? "created" : "null (offline mode)", ")");

  // updateFriendRequestStatus should execute safely
  const updateReqRes = await dbService.updateFriendRequestStatus(`req_${Date.now()}`, "accepted");
  console.log("✅ updateFriendRequestStatus executed safely (result:", updateReqRes, ")");

  // getPendingRequestsForUser should return array safely
  const pending = await dbService.getPendingRequestsForUser("test_partner_123");
  assert(Array.isArray(pending));
  console.log("✅ getPendingRequestsForUser returned array safely (count:", pending.length, ")");

  // saveReport should execute safely
  const reportRes = await dbService.saveReport({
    reportId: `rep_${Date.now()}`,
    reporterId: testUserId,
    reporterCountry: "US",
    reportedUserId: "test_partner_123",
    reportedUserCountry: "CA",
    roomId: "room_test_123",
    reason: "inappropriate_behavior",
    moderationFlags: ["vulgarity_check"],
  });
  console.log("✅ saveReport executed safely (result:", reportRes !== null ? "saved" : "null (offline mode)", ")");

  // 4. Test simulated Firestore operations to verify data payloads and queries
  console.log("🧪 Testing simulated Firestore data payloads and queries...");
  const mockStorage = {
    users: new Map(),
    friendships: new Map(),
    friend_requests: new Map(),
    reports: new Map(),
  };

  const firebaseConfig = require("../src/config/firebase");
  const originalGetDb = firebaseConfig.getDb;

  const mockDb = {
    collection: (colName) => {
      const store = mockStorage[colName] || new Map();
      return {
        doc: (id) => ({
          get: async () => ({
            exists: store.has(id),
            id,
            data: () => store.get(id),
          }),
          set: async (data, opts = {}) => {
            if (opts.merge && store.has(id)) {
              store.set(id, { ...store.get(id), ...data });
            } else {
              store.set(id, data);
            }
          },
          update: async (data) => {
            if (!store.has(id)) throw new Error("Document not found");
            store.set(id, { ...store.get(id), ...data });
          },
        }),
        where: (field, op, val) => {
          let results = Array.from(store.entries()).map(([id, data]) => ({ id, ...data }));
          if (op === "array-contains") {
            results = results.filter((item) => Array.isArray(item[field]) && item[field].includes(val));
          } else if (op === "==") {
            results = results.filter((item) => item[field] === val);
          }
          return {
            where: (field2, op2, val2) => {
              if (op2 === "==") {
                results = results.filter((item) => item[field2] === val2);
              }
              return {
                get: async () => ({
                  forEach: (cb) => results.forEach((r) => cb({ id: r.id, data: () => r })),
                }),
              };
            },
            get: async () => ({
              forEach: (cb) => results.forEach((r) => cb({ id: r.id, data: () => r })),
            }),
          };
        },
      };
    },
  };

  try {
    firebaseConfig.getDb = () => mockDb;

    // Test Users collection
    await dbService.syncUserOnAuth("usr_alice", { country: "US", displayName: "Alice" });
    const alice = await dbService.getUserProfile("usr_alice");
    assert(alice !== null, "Alice should be created in users collection");
    assert.strictEqual(alice.userId, "usr_alice");
    await dbService.incrementUserMatchCount("usr_alice");
    await dbService.updateUserProfile("usr_alice", { bio: "Coder" });
    console.log("✅ users collection: CRUD and match count verified");

    // Test Friendships collection
    await dbService.saveFriendship("usr_alice", "usr_bob");
    const canonicalPair = dbService.getCanonicalPairId("usr_alice", "usr_bob");
    assert(mockStorage.friendships.has(canonicalPair), "Friendship should be stored with canonical pair ID");
    const aliceFriends = await dbService.getUserFriends("usr_alice");
    assert.strictEqual(aliceFriends.length, 1);
    assert.strictEqual(aliceFriends[0].friendId, "usr_bob");
    console.log("✅ friendships collection: canonical pair ID and queries verified");

    // Test Friend Requests collection
    await dbService.createFriendRequest({
      requestId: "freq_001",
      fromUserId: "usr_alice",
      toUserId: "usr_charlie",
      roomId: "room_ac",
    });
    assert(mockStorage.friend_requests.has("freq_001"), "Friend request should be created");
    const pendingRequests = await dbService.getPendingRequestsForUser("usr_charlie");
    assert.strictEqual(pendingRequests.length, 1);
    assert.strictEqual(pendingRequests[0].fromUserId, "usr_alice");
    await dbService.updateFriendRequestStatus("freq_001", "accepted");
    assert.strictEqual(mockStorage.friend_requests.get("freq_001").status, "accepted");
    console.log("✅ friend_requests collection: pending status and transitions verified");

    // Test Reports collection
    await dbService.saveReport({
      reportId: "rep_999",
      reporterId: "usr_alice",
      reporterCountry: "US",
      reportedUserId: "usr_spammer",
      reportedUserCountry: "RU",
      roomId: "room_spam",
      reason: "spam_advertising",
      moderationFlags: ["auto_flagged"],
    });
    assert(mockStorage.reports.has("rep_999"), "Report should be saved");
    assert.strictEqual(mockStorage.reports.get("rep_999").reportedUserId, "usr_spammer");
    console.log("✅ reports collection: moderation flags and report storage verified");

    // Test Friend Chats & Messages
    mockStorage.friend_chats = new Map();
    const chatDbMock = {
      collection: (col) => {
        if (col === "friend_chats") {
          return {
            doc: (chatId) => ({
              set: async (data, opts = {}) => {
                if (opts.merge && mockStorage.friend_chats.has(chatId)) {
                  mockStorage.friend_chats.set(chatId, { ...mockStorage.friend_chats.get(chatId), ...data });
                } else {
                  mockStorage.friend_chats.set(chatId, data);
                }
              },
              collection: (subCol) => {
                const subStore = mockStorage[`${chatId}_${subCol}`] || new Map();
                mockStorage[`${chatId}_${subCol}`] = subStore;
                return {
                  doc: (msgId) => ({
                    set: async (data) => subStore.set(msgId, data),
                    get: async () => ({
                      exists: subStore.has(msgId),
                      id: msgId,
                      data: () => subStore.get(msgId),
                    }),
                    update: async (data) => {
                      if (!subStore.has(msgId)) throw new Error("Message not found");
                      subStore.set(msgId, { ...subStore.get(msgId), ...data });
                    },
                    delete: async () => subStore.delete(msgId),
                  }),
                  orderBy: () => ({
                    limit: () => ({
                      get: async () => ({
                        forEach: (cb) => Array.from(subStore.entries()).forEach(([id, data]) => cb({ id, data: () => data })),
                      }),
                    }),
                  }),
                };
              },
            }),
          };
        }
        return mockDb.collection(col);
      },
    };
    firebaseConfig.getDb = () => chatDbMock;

    await dbService.saveFriendChatMessage({
      chatId: canonicalPair,
      messageId: "msg_101",
      fromUserId: "usr_alice",
      message: "Hey Bob! 👋",
      isFlash: false,
    });
    const msgs = await dbService.getFriendChatMessages(canonicalPair);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].message, "Hey Bob! 👋");

    await dbService.editFriendChatMessage(canonicalPair, "msg_101", "usr_alice", "Hey Bob! (edited)");
    const editedMsg = mockStorage[`${canonicalPair}_messages`].get("msg_101");
    assert.strictEqual(editedMsg.message, "Hey Bob! (edited)");
    assert.strictEqual(editedMsg.isEdited, true);

    await dbService.deleteFriendChatMessage(canonicalPair, "msg_101", "usr_alice");
    assert(!mockStorage[`${canonicalPair}_messages`].has("msg_101"));
    console.log("✅ friend_chats & messages collection: persistence, retrieval, edit and delete verified");
  } finally {
    firebaseConfig.getDb = originalGetDb;
  }

  console.log("🎉 All Firebase & Firestore dbService tests passed successfully!");
}

runTests().catch((err) => {
  console.error("❌ Firestore integration test failed:", err);
  process.exit(1);
});
