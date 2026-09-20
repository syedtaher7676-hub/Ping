// Integration test verifying Redis State Store and fail-open rate limiting
const assert = require("assert");
const redisStore = require("../src/state/redisStore");

async function runTests() {
  console.log("🧪 Testing Redis State Store & Sliding Window Rate Limiter...");

  // Test 1: Synchronous user and queue operations
  const testUserA = { id: "test_user_a", socketId: "sock_a", status: "idle", country: "US" };
  const testUserB = { id: "test_user_b", socketId: "sock_b", status: "idle", country: "CA" };

  await redisStore.redisSetUser(testUserA.id, testUserA);
  await redisStore.redisSetUser(testUserB.id, testUserB);

  assert.strictEqual(redisStore.getUserById("test_user_a")?.socketId, "sock_a");
  assert.strictEqual(redisStore.getUserBySocketId("sock_b")?.id, "test_user_b");
  console.log("✅ User mapping test passed");

  // Test 2: Queue operations
  assert.strictEqual(redisStore.isUserQueued("test_user_a"), false);
  redisStore.enqueueUser("test_user_a");
  assert.strictEqual(redisStore.isUserQueued("test_user_a"), true);
  redisStore.removeUserFromQueue("test_user_a");
  assert.strictEqual(redisStore.isUserQueued("test_user_a"), false);
  console.log("✅ Queue operations test passed");

  // Test 3: Sliding window rate limiter
  const testKey = `test_limit_${Date.now()}`;
  const limit = 3;
  const windowMs = 1000;

  const res1 = await redisStore.checkSlidingWindowRateLimit(testKey, windowMs, limit);
  const res2 = await redisStore.checkSlidingWindowRateLimit(testKey, windowMs, limit);
  const res3 = await redisStore.checkSlidingWindowRateLimit(testKey, windowMs, limit);
  const res4 = await redisStore.checkSlidingWindowRateLimit(testKey, windowMs, limit);

  assert.strictEqual(res1.allowed, true);
  assert.strictEqual(res2.allowed, true);
  assert.strictEqual(res3.allowed, true);
  assert.strictEqual(res4.allowed, false, "Fourth hit should be rejected by sliding window limit");
  console.log("✅ Sliding window rate limiter test passed (3 allowed, 4th throttled)");

  // Test 4: Friendship & DM management
  redisStore.addFriendship("test_user_a", "test_user_b");
  assert.strictEqual(redisStore.areFriends("test_user_a", "test_user_b"), true);
  assert.deepStrictEqual(redisStore.getFriends("test_user_a"), ["test_user_b"]);

  redisStore.createFriendRoomEntry("test_user_a", "test_user_b");
  redisStore.appendFriendRoomMessage("test_user_a", "test_user_b", { id: "m1", text: "hi", senderId: "test_user_a" });
  const messages = redisStore.getFriendRoomMessages("test_user_a", "test_user_b");
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].text, "hi");
  console.log("✅ Friendship and DM management test passed");

  // Cleanup
  await redisStore.redisDeleteUser("test_user_a");
  await redisStore.redisDeleteUser("test_user_b");

  console.log("🎉 All Redis State & Architecture tests passed successfully!");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
