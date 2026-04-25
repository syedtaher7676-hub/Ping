const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
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
const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT_MS = 60000; // 60 seconds timeout

// Metrics logging interval
const METRICS_LOG_INTERVAL_MS = 30000; // 30 seconds

// CORS configuration - more robust for hosting platforms
const SOCKET_CORS = {
  origin: (origin, callback) => {
    // Allow all origins in production too (socket.io handles security via authentication)
    // Or specify allowed origins via env variable: ALLOWED_ORIGINS="https://example.com,https://app.example.com"
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(o => o.trim()).filter(Boolean);
    
    if (NODE_ENV === "development" || !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST"],
  credentials: false,
};

module.exports = {
  PORT,
  NODE_ENV,
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
