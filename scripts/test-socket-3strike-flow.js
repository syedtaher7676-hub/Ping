const { io: Client } = require("socket.io-client");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { registerSocketHandlers } = require("../src/socket/registerSocketHandlers");
const { slurFilter } = require("../src/data");

console.log("🧪 Testing end-to-end Socket 3-Strike Moderation Flow...");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
registerSocketHandlers(io);

server.listen(0, async () => {
  const port = server.address().port;
  const url = `http://localhost:${port}`;

  const userAId = "userA_" + Date.now();
  const userBId = "userB_" + Date.now();

  // Clear any existing state for test users
  slurFilter.clearUserSlurViolations(userAId);
  slurFilter.clearPenalty(userAId);
  slurFilter.clearUserSlurViolations(userBId);
  slurFilter.clearPenalty(userBId);

  const socketA = Client(url, { auth: { userId: userAId } });
  const socketB = Client(url, { auth: { userId: userBId } });

  let partnerReceivedSlur = false;
  let strike1LabelReceived = false;
  let strike2LabelReceived = false;
  let strike3LabelReceived = false;
  let unexpectedDisconnect = false;

  socketB.on("new_message", (payload) => {
    if (payload.message.includes("bitch") || payload.message.includes("slut") || payload.message.includes("gandu")) {
      partnerReceivedSlur = true;
    }
  });

  socketA.on("warning_message", (data) => {
    if (data.message && data.message.includes("Please don't use bad words here")) {
      if (!strike1LabelReceived) {
        strike1LabelReceived = true;
        console.log("✅ Socket A received 1st offense nice label:", data.message);
      } else if (!strike2LabelReceived) {
        strike2LabelReceived = true;
        console.log("✅ Socket A received 2nd offense nice label:", data.message);
      } else {
        strike3LabelReceived = true;
        console.log("✅ Socket A received 3rd offense nice label:", data.message);
      }
    }
  });

  socketA.on("disconnect", (reason) => {
    unexpectedDisconnect = true;
    console.log("⚠️ Socket A unexpectedly disconnected:", reason);
  });

  // Wait for connections
  await new Promise((resolve) => {
    let count = 0;
    const done = () => { count++; if (count === 2) resolve(); };
    socketA.on("connect", done);
    socketB.on("connect", done);
  });

  console.log("Sockets connected. Starting matchmaking...");

  let matched = false;
  let roomId = null;

  socketA.on("matched", (data) => {
    matched = true;
    roomId = data.roomId;
  });

  socketA.emit("start_chat");
  socketB.emit("start_chat");

  // Wait for match
  for (let i = 0; i < 20; i++) {
    if (matched) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!matched) {
    console.error("❌ Matchmaking failed to connect both users");
    process.exit(1);
  }
  console.log("✅ Matched in room:", roomId);

  // 1. Offense 1: Send slur
  await new Promise((r) => setTimeout(r, 800));
  socketA.emit("send_message", { message: "you are a bitch" }, (ack) => {
    console.log("Offense 1 ack:", ack);
  });

  await new Promise((r) => setTimeout(r, 800));
  if (partnerReceivedSlur) {
    console.error("❌ Partner received slur! Message was NOT blocked.");
    process.exit(1);
  }
  if (!strike1LabelReceived) {
    console.error("❌ Offender did not receive Strike 1 nice label!");
    process.exit(1);
  }
  console.log("✅ 1st Offense: Message blocked, nice label received, chat continues.");

  // Test that chat continues by sending a normal message
  let normalMsgReceived = false;
  socketB.once("new_message", (p) => {
    if (p.message === "hello again") normalMsgReceived = true;
  });
  socketA.emit("send_message", { message: "hello again" });
  await new Promise((r) => setTimeout(r, 800));
  if (!normalMsgReceived) {
    console.error("❌ Chat did not continue after Strike 1!");
    process.exit(1);
  }
  console.log("✅ Chat continues normally after Strike 1 warning.");

  // 2. Offense 2: Send second slur
  await new Promise((r) => setTimeout(r, 800));
  socketA.emit("send_message", { message: "shut up slut" }, (ack) => {
    console.log("Offense 2 ack:", ack);
  });

  await new Promise((r) => setTimeout(r, 800));
  if (partnerReceivedSlur) {
    console.error("❌ Partner received slur on 2nd offense!");
    process.exit(1);
  }
  if (!strike2LabelReceived) {
    console.error("❌ Offender did not receive Strike 2 nice label!");
    process.exit(1);
  }
  console.log("✅ 2nd Offense: Message blocked, nice label received, chat continues.");

  // Test that chat continues after Strike 2
  let normalMsg2Received = false;
  socketB.once("new_message", (p) => {
    if (p.message === "clean conversation continues") normalMsg2Received = true;
  });
  socketA.emit("send_message", { message: "clean conversation continues" });
  await new Promise((r) => setTimeout(r, 800));
  if (!normalMsg2Received) {
    console.error("❌ Chat did not continue after Strike 2!");
    process.exit(1);
  }
  console.log("✅ Chat continues normally after Strike 2 warning.");

  // 3. Offense 3: Send third slur (User requirement: NO 15-min ban, session stays alive!)
  await new Promise((r) => setTimeout(r, 800));
  socketA.emit("send_message", { message: "fuck off gandu" }, (ack) => {
    console.log("Offense 3 ack:", ack);
  });

  await new Promise((r) => setTimeout(r, 1000));
  if (partnerReceivedSlur) {
    console.error("❌ Partner received slur on 3rd offense!");
    process.exit(1);
  }
  if (!strike3LabelReceived) {
    console.error("❌ Offender did not receive Strike 3 nice label!");
    process.exit(1);
  }
  if (unexpectedDisconnect) {
    console.error("❌ Offender was unexpectedly disconnected! (15-min ban should be removed)");
    process.exit(1);
  }

  // Verify chat is still active after 3rd bad word by sending a clean message
  let normalMsg3Received = false;
  socketB.once("new_message", (p) => {
    if (p.message === "clean message after 3rd warning") normalMsg3Received = true;
  });
  socketA.emit("send_message", { message: "clean message after 3rd warning" });
  await new Promise((r) => setTimeout(r, 800));
  if (!normalMsg3Received) {
    console.error("❌ Chat did not continue after 3rd bad word!");
    process.exit(1);
  }

  console.log("✅ 3rd Offense: Message blocked, nice label given, NO 15-min ban, session stays alive, and subsequent clean messages deliver seamlessly!");

  // Cleanup
  socketA.close();
  socketB.close();
  server.close(() => {
    console.log("🎉 ALL SOCKET 3-STRIKE FLOW TESTS PASSED!");
    process.exit(0);
  });
});
