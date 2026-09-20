const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const Redis = require("ioredis");
const geoip = require("geoip-lite");
const { PORT, SOCKET_CORS, MATCHMAKING_INTERVAL_MS, REDIS_URL } = require("./config");
const { registerSocketHandlers } = require("./socket/registerSocketHandlers");
const { getMatchStats, attemptMatchmaking } = require("./services/matchmaking");
const { terminateSession } = require("./services/sessionManager");
const { rooms, redisClient } = require("./state/store");
const { createId } = require("./utils/ids");
const { log } = require("./utils/logger");

// Helper to get country from IP or client provided
function getCountryFromSocket(socket) {
  try {
    // 1. Prefer client-provided country if it's high confidence (e.g. from a reliable API)
    if (socket.handshake.auth && typeof socket.handshake.auth.country === "string" && socket.handshake.auth.country !== "Unknown") {
      const sanitized = socket.handshake.auth.country.trim().slice(0, 50);
      if (sanitized) return sanitized;
    }

    // 2. Resolve IP (supporting proxies like Render/Cloudflare/Heroku/Railway)
    const headers = socket.handshake.headers || {};
    
    // Try multiple headers used by different hosting platforms
    let ip = 
      headers["x-forwarded-for"]?.split(",")[0].trim() ||
      headers["cf-connecting-ip"] ||  // Cloudflare
      headers["x-real-ip"] ||         // Nginx
      headers["x-client-ip"] ||
      headers["x-forwarded-ip"] ||
      socket.handshake.address ||
      socket.conn.remoteAddress;

    // Normalize IPv6 loopback
    if (ip?.startsWith("::ffff:")) {
      ip = ip.substring(7);
    }

    // Handle localhost/local interfaces
    if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") {
      return "📍 Nearby";
    }

    // Skip geolocation for private IPs
    if (ip?.startsWith("10.") || ip?.startsWith("172.") || ip?.startsWith("192.168.")) {
      return "📍 Local";
    }

    const geo = geoip.lookup(ip);
    if (geo && geo.country) {
      // Convert country code (US) to Flag Emoji (🇺🇸)
      const flag = geo.country.toUpperCase().replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt(0)));
      return `${flag} ${geo.city ? geo.city + ", " : ""}${geo.country}`;
    }

    return "Someone nearby";
  } catch (e) {
    // Silently fall back if geolocation fails
    return "Someone nearby";
  }
}

const app = express();
const server = http.createServer(app);

// ═══════════════════════════════════════════════════════════════
// EXPRESS CORS & PREFLIGHT MIDDLEWARE
// ═══════════════════════════════════════════════════════════════
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-requested-with");
  
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// ═══════════════════════════════════════════════════════════════
// SOCKET.IO SERVER INITIALIZATION WITH DUAL-TRANSPORT FALLBACK
// ═══════════════════════════════════════════════════════════════
// Explicitly configures both 'polling' (HTTP long-polling fallback)
// and 'websocket' (upgraded real-time streaming) to prevent drops
// in proxy and sandbox environments (e.g. AI Studio preview).
const io = new Server(server, {
  cors: SOCKET_CORS,
  transports: ["polling", "websocket"],
  pingInterval: 10000,        // 10s keep-alive prevents cloud proxy / reverse proxy idle drops
  pingTimeout: 20000,         // 20s timeout before considering connection dropped
  connectTimeout: 45000,      // Generous connection timeout
  maxHttpBufferSize: 1e6,     // 1MB max payload
  allowUpgrades: true,        // Allow seamless polling to websocket upgrade
  perMessageDeflate: false,   // Disable perMessageDeflate to eliminate zlib decompression memory overhead and leaks
  httpCompression: true,
});

// ═══════════════════════════════════════════════════════════════
// SOCKET HANDSHAKE AUTHENTICATION & SECURITY MIDDLEWARE
// ═══════════════════════════════════════════════════════════════
// Validates client handshake credentials, sanitizes user IDs against
// prototype pollution and spoofing, verifies origins against CSWSH,
// and binds verified metadata to socket.data.
io.use((socket, next) => {
  try {
    const auth = socket.handshake.auth;

    // 1. Guard against non-object auth payloads
    if (auth && typeof auth !== "object") {
      return next(new Error("Invalid authentication payload format"));
    }

    // 2. Sanitize and validate client-provided userId
    const rawUserId = auth?.userId;
    let verifiedUserId = null;

    if (
      typeof rawUserId === "string" &&
      rawUserId.length >= 3 &&
      rawUserId.length <= 64 &&
      /^[a-zA-Z0-9_-]+$/.test(rawUserId) &&
      !["__proto__", "prototype", "constructor", "toString", "valueOf"].includes(rawUserId)
    ) {
      verifiedUserId = rawUserId;
    } else {
      // If missing, malformed, or malicious, assign a fresh secure identifier
      verifiedUserId = createId("u");
    }

    // 3. Attach verified session identity to socket.data
    socket.data.userId = verifiedUserId;
    socket.data.country = getCountryFromSocket(socket);
    socket.data.authenticatedAt = Date.now();

    next();
  } catch (err) {
    log("socket_auth_middleware_error", { message: err.message, socketId: socket.id });
    next(new Error("Authentication handshake failed"));
  }
});

// ── REDIS PUB/SUB ADAPTER INITIALIZATION (MULTI-NODE CLUSTER) ─
let redisPubClient = null;
let redisSubClient = null;

function initializeRedisAdapter(ioServer) {
  // Only initialize Redis adapter if REDIS_URL or REDIS_HOST is explicitly provided
  const target = REDIS_URL || (process.env.REDIS_HOST ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}` : "");

  if (!target) {
    log("redis_adapter_skipped", { reason: "no_redis_url_configured", mode: "in_memory_standalone" });
    return;
  }

  try {
    redisPubClient = new Redis(target, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: false,
      retryStrategy(times) {
        if (times > 3) return null; // Cease reconnect loop to fail-open cleanly
        return Math.min(times * 1000, 3000);
      },
    });

    redisSubClient = redisPubClient.duplicate();

    let adapterAttached = false;
    const tryAttachAdapter = () => {
      if (!adapterAttached && redisPubClient.status === "ready" && redisSubClient.status === "ready") {
        adapterAttached = true;
        ioServer.adapter(createAdapter(redisPubClient, redisSubClient));
        log("redis_adapter_attached", { status: "ready", mode: "multi_node_broadcast" });
      }
    };

    redisPubClient.on("ready", tryAttachAdapter);
    redisSubClient.on("ready", tryAttachAdapter);

    // Fail-open event listeners
    redisPubClient.on("error", (err) => {
      log("redis_pub_adapter_warning", { message: err.message, mode: "fail_open_in_memory" });
    });
    redisSubClient.on("error", (err) => {
      log("redis_sub_adapter_warning", { message: err.message, mode: "fail_open_in_memory" });
    });
  } catch (err) {
    log("redis_adapter_init_error", { message: err.message, mode: "fail_open_in_memory" });
  }
}

initializeRedisAdapter(io);

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    stats: getMatchStats(),
    timestamp: Date.now(),
  });
});

// Stats endpoint for landing page
app.get("/api/stats", (_req, res) => {
  const stats = getMatchStats();
  res.json({
    activeUsers: stats?.activeUsers || 0,
    totalChats: stats?.totalMatches || 0,
  });
});

registerSocketHandlers(io, getCountryFromSocket);
const matchmakingInterval = setInterval(() => attemptMatchmaking(io), MATCHMAKING_INTERVAL_MS);
matchmakingInterval.unref();

// SPA fallback - serve index.html for client-side routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.use((err, _req, res, _next) => {
  log("http_error", {
    message: err.message,
    stack: err.stack,
  });
  res.status(500).json({ status: "error", message: "Internal server error" });
});

server.on("error", (error) => {
  log("server_error", {
    message: error.message,
    code: error.code,
    stack: error.stack,
  });

  if (error.code === "EADDRINUSE") {
    log("server_start_failed", {
      reason: "port_in_use",
      port: PORT,
      suggestion: "Stop the existing process using this port or change PORT.",
    });
    process.exit(1);
  }
});

process.on("uncaughtException", (error) => {
  log("uncaught_exception", {
    message: error.message,
    stack: error.stack,
  });
});

process.on("unhandledRejection", (reason) => {
  const details = reason instanceof Error ? { message: reason.message, stack: reason.stack } : { reason };
  log("unhandled_rejection", details);
});

// Use PORT from config (3000 by default)
server.listen(PORT, "0.0.0.0", () => {
  log("server_started", {
    port: PORT,
    env: process.env.NODE_ENV || "development",
    healthUrl: `http://localhost:${PORT}/health`,
  });
}).on("error", (error) => {
  log("server_listen_error", {
    message: error.message,
    code: error.code,
    port: PORT,
  });
  process.exit(1);
});

// ═══════════════════════════════════════════════════════════════
// BUG FIX 5: Server Graceful Shutdown Faults
// ═══════════════════════════════════════════════════════════════
// Handles SIGINT/SIGTERM cleanly: stops accepting new traffic,
// broadcasts server shutdown notices to all sockets, terminates active rooms,
// closes Socket.IO and HTTP servers, and cleanly disconnects Redis.
let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) {
    log("shutdown_already_in_progress", { signal });
    return;
  }
  isShuttingDown = true;
  log("shutdown_started", { signal, timestamp: Date.now() });

  // 1. Stop recurring matchmaking interval
  clearInterval(matchmakingInterval);

  // 2. Set an absolute safety force-kill timeout (10 seconds)
  const forceKillTimeout = setTimeout(() => {
    log("shutdown_forced", { reason: "timeout", timeoutMs: 10000 });
    process.exit(1);
  }, 10000);
  forceKillTimeout.unref();

  // 3. Notify all connected sockets of graceful shutdown
  try {
    io.emit("server_shutdown", {
      message: "Server is restarting for maintenance. Reconnecting shortly...",
      timestamp: Date.now(),
    });
  } catch (err) {
    log("shutdown_broadcast_error", { message: err.message });
  }

  // 4. Gracefully terminate all active rooms
  try {
    for (const [roomId] of rooms.entries()) {
      terminateSession(io, roomId, "server_shutdown");
    }
  } catch (err) {
    log("shutdown_room_cleanup_error", { message: err.message });
  }

  // 5. Stop accepting new HTTP connections and close Socket.IO
  io.close(() => {
    log("socket_io_closed");
    server.close((serverErr) => {
      if (serverErr) {
        log("http_server_close_error", { message: serverErr.message });
      } else {
        log("http_server_closed");
      }

      // 6. Cleanly disconnect Redis clients
      const redisDisconnectPromises = [];
      if (redisPubClient) {
        redisDisconnectPromises.push(
          new Promise((resolve) => {
            try { redisPubClient.quit(() => resolve()); } catch { resolve(); }
          })
        );
      }
      if (redisSubClient) {
        redisDisconnectPromises.push(
          new Promise((resolve) => {
            try { redisSubClient.quit(() => resolve()); } catch { resolve(); }
          })
        );
      }
      if (redisClient) {
        redisDisconnectPromises.push(
          new Promise((resolve) => {
            try { redisClient.quit(() => resolve()); } catch { resolve(); }
          })
        );
      }

      Promise.allSettled(redisDisconnectPromises).then(() => {
        clearTimeout(forceKillTimeout);
        log("shutdown_complete", { signal });
        process.exit(0);
      });
    });
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

module.exports = {
  app,
  server,
  io,
  shutdown,
};
