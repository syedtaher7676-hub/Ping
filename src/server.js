const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const geoip = require("geoip-lite");
const { PORT, SOCKET_CORS, MATCHMAKING_INTERVAL_MS } = require("./config");
const { registerSocketHandlers } = require("./socket/registerSocketHandlers");
const { getMatchStats, attemptMatchmaking } = require("./services/matchmaking");
const { log } = require("./utils/logger");

// Helper to get country from IP or client provided
function getCountryFromSocket(socket) {
  try {
    // 1. Prefer client-provided country if it's high confidence (e.g. from a reliable API)
    if (socket.handshake.auth && socket.handshake.auth.country && socket.handshake.auth.country !== "Unknown") {
      return socket.handshake.auth.country;
    }

    // 2. Resolve IP (supporting proxies like Render/Cloudflare/Heroku/Railway)
    const headers = socket.handshake.headers;
    
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
    if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost" || ip === "127.0.0.1") {
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

const io = new Server(server, {
  cors: SOCKET_CORS,
  transports: ["polling", "websocket"],
});

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

function shutdown(signal) {
  log("shutdown_started", { signal });
  clearInterval(matchmakingInterval);
  
  // Force shutdown after 30 seconds (hosting platform timeouts)
  const shutdownTimeout = setTimeout(() => {
    log("shutdown_forced", { reason: "timeout" });
    process.exit(1);
  }, 30000);
  shutdownTimeout.unref();
  
  io.close(() => {
    server.close((error) => {
      clearTimeout(shutdownTimeout);
      if (error) {
        log("shutdown_error", { message: error.message, stack: error.stack });
        process.exit(1);
        return;
      }
      log("shutdown_complete", { signal });
      process.exit(0);
    });
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
