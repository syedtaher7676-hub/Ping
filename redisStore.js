// ==============================================================================
// PING: Root RedisStore Adapter (redisStore.js)
// ==============================================================================
// Exposes the RedisStore class and helper methods with 30-day session TTL
// and automatic Firestore fallback.
// ==============================================================================

const {
  RedisStore,
  redisStore,
  setAdminSession,
  getAdminSession,
  deleteAdminSession,
  DEFAULT_ADMIN_SESSION_TTL_SECONDS,
} = require("./src/state/redisStore");

module.exports = {
  RedisStore,
  redisStore,
  setAdminSession,
  getAdminSession,
  deleteAdminSession,
  DEFAULT_ADMIN_SESSION_TTL_SECONDS,
  default: redisStore,
};
