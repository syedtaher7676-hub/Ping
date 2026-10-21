/**
 * Test script for Friend Direct Messaging Room Routing & Real-Time Delivery
 */

const assert = require("assert");
const { io: ioClient } = require("socket.io-client");

const PORT = 3000;
const SERVER_URL = `http://localhost:${PORT}`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDmTests() {
  console.log("🚀 Starting Friend DM Socket Room Routing & Real-Time Delivery Test...");

  // Connect client 1 and client 2
  const socket1 = ioClient(SERVER_URL, {
    transports: ["websocket"],
    forceNew: true,
  });

  const socket2 = ioClient(SERVER_URL, {
    transports: ["websocket"],
    forceNew: true,
  });

  let u1Data, u2Data;

  await Promise.all([
    new Promise(resolve => {
      socket1.on("self", data => {
        u1Data = data;
        console.log(`✅ Socket 1 connected as user: ${data.userId}`);
        resolve();
      });
    }),
    new Promise(resolve => {
      socket2.on("self", data => {
        u2Data = data;
        console.log(`✅ Socket 2 connected as user: ${data.userId}`);
        resolve();
      });
    }),
  ]);

  const u1Id = u1Data.userId;
  const u2Id = u2Data.userId;

  // Step 1: Match User 1 and User 2 in random chat to establish friendship
  const matchPromise1 = new Promise(resolve => socket1.once("matched", resolve));
  const matchPromise2 = new Promise(resolve => socket2.once("matched", resolve));

  socket1.emit("start_chat");
  socket2.emit("start_chat");

  await Promise.all([matchPromise1, matchPromise2]);
  console.log("✅ Users matched in chat session");

  // Step 2: Send and accept friend request
  const friendReqPromise = new Promise(resolve => {
    socket2.once("friend_request_received", resolve);
  });

  socket1.emit("send_friend_request");
  const reqData = await friendReqPromise;
  console.log(`✅ Friend request received by socket 2: ${reqData.requestId}`);

  const friendAcceptedPromise1 = new Promise(resolve => socket1.once("friend_request_accepted", resolve));
  const friendAcceptedPromise2 = new Promise(resolve => socket2.once("friend_request_accepted", resolve));

  socket2.emit("friend_request_response", {
    requestId: reqData.requestId,
    accept: true,
  });

  await Promise.all([friendAcceptedPromise1, friendAcceptedPromise2]);
  console.log("✅ Friendship established between Socket 1 and Socket 2");

  // End active random chat session
  socket1.emit("end_chat");
  await sleep(300);

  // Step 3: User 1 opens DM with User 2
  const expectedRoomId = ['friend_chat', ...[u1Id, u2Id].sort()].join('_');

  const openDmPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for friend_dm_opened")), 5000);
    socket1.once("friend_dm_opened", data => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  socket1.emit("open_friend_dm", { friendId: u2Id });
  const openDmResult = await openDmPromise;
  console.log(`✅ open_friend_dm response received with room:`, openDmResult.roomId);
  assert.strictEqual(openDmResult.roomId, expectedRoomId, "Room ID must match deterministic format");
  assert.strictEqual(openDmResult.friendId, u2Id, "Friend ID should be u2");

  // Step 4: User 2 is NOT currently inside the room, User 1 sends DM.
  // User 2 should receive 'friend_dm_notification' via user_${u2Id} personal room!
  const notificationPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for friend_dm_notification")), 5000);
    socket2.once("friend_dm_notification", data => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  const testMsg = "Hello friend! Real-time check " + Date.now();
  socket1.emit("send_dm", {
    roomId: expectedRoomId,
    friendId: u2Id,
    message: testMsg,
    msgId: "test_msg_1",
  });

  const receivedNotification = await notificationPromise;
  console.log(`✅ friend_dm_notification received by User 2 on home/other tab:`, receivedNotification.message);
  assert.strictEqual(receivedNotification.message, testMsg);
  assert.strictEqual(receivedNotification.fromUserId, u1Id);

  // Step 5: User 2 opens the DM room as well, and User 1 sends another DM.
  // Both should receive 'new_dm' in the shared conversation room!
  socket2.emit("open_friend_dm", { friendId: u1Id });
  await sleep(300);

  const u2NewDmPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for new_dm on socket 2")), 5000);
    socket2.once("new_dm", data => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  const u1NewDmPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for new_dm on socket 1")), 5000);
    socket1.once("new_dm", data => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  const testMsg2 = "Both in room now! " + Date.now();
  socket1.emit("send_dm", {
    roomId: expectedRoomId,
    friendId: u2Id,
    message: testMsg2,
    msgId: "test_msg_2",
  });

  const [u1DmEvent, u2DmEvent] = await Promise.all([u1NewDmPromise, u2NewDmPromise]);
  console.log(`✅ new_dm received by both sockets in shared room:`, u2DmEvent.message);
  assert.strictEqual(u2DmEvent.message, testMsg2);
  assert.strictEqual(u1DmEvent.message, testMsg2);

  // Step 6: Test Tab Refresh / Disconnect & Reconnect with Auto-Rejoin
  console.log("🔄 Testing tab refresh / disconnect and auto-rejoin...");
  socket1.disconnect();
  await sleep(400);

  // Reconnect socket1 with persistent userId
  const socket1Reconnected = ioClient(SERVER_URL, {
    transports: ["websocket"],
    forceNew: true,
    auth: { userId: u1Id },
  });

  await new Promise(resolve => {
    socket1Reconnected.on("self", resolve);
  });

  // Authenticate and auto-rejoin active friend chat
  const authAck = await new Promise(resolve => {
    socket1Reconnected.emit("authenticate", { userId: u1Id, activeFriendId: u2Id }, resolve);
  });
  console.log("✅ Socket 1 authenticated with active friend:", authAck);
  assert.strictEqual(authAck?.ok, true);

  // Re-open friend DM
  const openRejoinPromise = new Promise(resolve => socket1Reconnected.once("friend_dm_opened", resolve));
  socket1Reconnected.emit("open_friend_dm", { friendId: u2Id });
  const openRejoinData = await openRejoinPromise;
  console.log("✅ Friend DM reopened successfully after reconnect:", openRejoinData.roomId);

  // Send message after reconnect and verify ack + delivery to socket2
  const reconnectedMsgPromise = new Promise(resolve => socket2.once("new_dm", resolve));
  const postReconnectMsg = "Message sent after tab reconnect! " + Date.now();

  const sendAck = await new Promise(resolve => {
    socket1Reconnected.emit("send_dm", {
      roomId: expectedRoomId,
      friendId: u2Id,
      message: postReconnectMsg,
      msgId: "reconnect_msg_1",
    }, resolve);
  });

  console.log("✅ Send DM ack received after reconnect:", sendAck);
  assert.strictEqual(sendAck?.ok, true, "Ack should return ok: true");
  assert.strictEqual(sendAck?.success, true, "Ack should return success: true");

  const receivedOnSocket2 = await reconnectedMsgPromise;
  console.log("✅ Partner received message sent after reconnect:", receivedOnSocket2.message);
  assert.strictEqual(receivedOnSocket2.message, postReconnectMsg);

  console.log("🎉 ALL FRIEND DM SOCKET ROUTING, RECONNECT & PERSISTENCE TESTS PASSED SUCCESSFULLY!");

  socket1Reconnected.disconnect();
  socket2.disconnect();
  process.exit(0);
}

runDmTests().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
