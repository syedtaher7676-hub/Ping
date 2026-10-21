// User data storage - IN-MEMORY (for ephemeral file systems like Render free tier)
const users = {};

function getUserData(userId) {
  return users[userId] || null;
}

function setUserData(userId, data) {
  if (!users[userId]) {
    users[userId] = { createdAt: Date.now(), stats: {} };
  }
  users[userId] = { ...users[userId], ...data, updatedAt: Date.now() };
}

function incrementUserStat(userId, stat) {
  if (!users[userId]) {
    users[userId] = { createdAt: Date.now(), stats: {} };
  }
  if (!users[userId].stats) {
    users[userId].stats = {};
  }
  users[userId].stats[stat] = (users[userId].stats[stat] || 0) + 1;
  users[userId].updatedAt = Date.now();
}

function getAllUsers() {
  return users;
}

module.exports = {
  getUserData,
  setUserData,
  incrementUserStat,
  getAllUsers,
};