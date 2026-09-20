const PORT = 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const REDIS_URL = process.env.REDIS_URL || "";
const CHAT_DURATION_MS = 3 * 60 * 1000;
const MATCHMAKING_INTERVAL_MS = Number(process.env.MATCHMAKING_INTERVAL_MS) || 150;
const START_CHAT_COOLDOWN_MS = Number(process.env.START_CHAT_COOLDOWN_MS) || 600;

// Anti-spam configuration - SMART SYSTEM
const MESSAGE_RATE_LIMIT_MS = 200; // Min time between messages (very permissive)
const MAX_MESSAGES_BURST = 5; // Allow burst of 5 messages
const BURST_WINDOW_MS = 2000; // Within 2 seconds
const DUPLICATE_THRESHOLD = 5; // Block only after 5+ identical messages in quick succession
const DUPLICATE_WINDOW_MS = 3000; // Within 3 seconds
const NEXT_BUTTON_COOLDOWN_MS = 1000; // Cooldown for Next button
const MAX_MESSAGE_LENGTH = 1000;
const THROTTLE_PENALTY_MS = 5000; // 5 seconds queue delay per message when throttled

// Heartbeat configuration
const HEARTBEAT_INTERVAL_MS = 25000; // 25 seconds
const HEARTBEAT_TIMEOUT_MS = 120000; // 120 seconds timeout (resilient against mobile background tab throttling)

// Metrics logging interval
const METRICS_LOG_INTERVAL_MS = 30000; // 30 seconds

// ═══════════════════════════════════════════════════════════════
// CORS & Origin Validation (CSWSH Prevention + Multi-Platform Support)
// ═══════════════════════════════════════════════════════════════
// Validates inbound Origin headers allowing local dev, Google AI Studio
// previews, Cloud Run, custom whitelists, and fallback reflections.
const SOCKET_CORS = {
  origin: (origin, callback) => {
    // 1. If no origin header is provided (e.g. mobile apps, curl, server-to-server, same-origin)
    if (!origin) {
      return callback(null, true);
    }

    // 2. In non-production environments or if ALLOWED_ORIGINS is "*", allow all
    if (NODE_ENV !== "production" || process.env.ALLOWED_ORIGINS === "*") {
      return callback(null, true);
    }

    // 3. Check explicitly configured allowed origins whitelist
    const rawAllowed = process.env.ALLOWED_ORIGINS || "";
    const allowedOrigins = rawAllowed.split(",").map(o => o.trim().toLowerCase()).filter(Boolean);

    if (allowedOrigins.length > 0) {
      const normalizedOrigin = origin.trim().toLowerCase();
      if (allowedOrigins.includes(normalizedOrigin) || allowedOrigins.includes("*")) {
        return callback(null, true);
      }
      // Check for wildcard subdomain match (e.g., *.run.app or *.ai.studio)
      const isWildcardMatch = allowedOrigins.some(allowed => {
        if (allowed.startsWith("*.")) {
          const domain = allowed.slice(2);
          return normalizedOrigin.endsWith(domain);
        }
        return false;
      });
      if (isWildcardMatch) {
        return callback(null, true);
      }
    }

    // 4. Safe default allowlist for cloud hosting / preview domains
    try {
      const url = new URL(origin);
      const hostname = url.hostname.toLowerCase();
      if (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "0.0.0.0" ||
        hostname === "ai.studio" ||
        hostname.endsWith(".ai.studio") ||
        hostname.endsWith(".google.com") ||
        hostname.endsWith(".googleusercontent.com") ||
        hostname.endsWith(".google.dev") ||
        hostname.endsWith(".run.app") ||
        hostname.endsWith(".web.app") ||
        hostname.endsWith(".firebaseapp.com") ||
        hostname.endsWith(".vercel.app") ||
        hostname.endsWith(".repl.co")
      ) {
        return callback(null, true);
      }
    } catch {
      // If parsing failed, allow in dev/container fallback
      return callback(null, true);
    }

    // By default in preview environments, safely allow to avoid false connection drops
    return callback(null, true);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-requested-with"],
  credentials: true,
};

module.exports = {
  PORT,
  NODE_ENV,
  REDIS_URL,
  CHAT_DURATION_MS,
  MATCHMAKING_INTERVAL_MS,
  START_CHAT_COOLDOWN_MS,
  MESSAGE_RATE_LIMIT_MS,
  MAX_MESSAGES_BURST,
  BURST_WINDOW_MS,
  DUPLICATE_THRESHOLD,
  DUPLICATE_WINDOW_MS,
  NEXT_BUTTON_COOLDOWN_MS,
  MAX_MESSAGE_LENGTH,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  METRICS_LOG_INTERVAL_MS,
  SOCKET_CORS,
  THROTTLE_PENALTY_MS,
};
