// ==============================================================================
// PING: State Store Proxy (store.js -> redisStore.js)
// ==============================================================================
// Proxies all state operations directly to the distributed Redis store
// with atomic operations and in-memory fail-open fallback.
// ==============================================================================

module.exports = require("./redisStore");
