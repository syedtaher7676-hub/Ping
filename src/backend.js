/**
 * ==============================================================================
 * PING: Unified Backend Subsystem Exports (src/backend.js)
 * ==============================================================================
 * Categorizes and links all backend services, state stores, data stores,
 * socket handlers, and utilities for clean modular access and integration.
 * ==============================================================================
 */

// 1. Core Services (Business Logic)
const matchmaking = require("./services/matchmaking");
const sessionManager = require("./services/sessionManager");
const friendService = require("./services/friendService");
const dbService = require("./services/dbService");
const behaviorAnalytics = require("./services/behaviorAnalytics");
const vpnDetector = require("./services/vpnDetector");
const modelTrainer = require("./services/modelTrainer");

// 2. Real-Time Socket.IO Engine
const socketHandlers = require("./socket/registerSocketHandlers");

// 3. State Management & Distributed Stores
const redisStore = require("./state/redisStore");
const store = require("./state/store");
const reportState = require("./state/reports");

// 4. Data Access Layer & Moderation Datasets
const data = require("./data");
const slurFilter = require("./data/slurFilter");
const moderation = require("./data/moderation");
const userStore = require("./data/userStore");
const reportStore = require("./data/reportStore");
const spamStore = require("./data/spamStore");
const securityStore = require("./data/securityStore");

// 5. Utilities & Algorithms
const conversationModerator = require("./utils/conversationModerator");
const aiModeration = require("./utils/moderation");
const ids = require("./utils/ids");
const logger = require("./utils/logger");

// 6. Configuration & Runtime
const config = require("./config");
const firebaseConfig = require("./config/firebase");

module.exports = {
  // Category 1: Services
  services: {
    matchmaking,
    sessionManager,
    friendService,
    dbService,
    behaviorAnalytics,
    vpnDetector,
    modelTrainer,
  },
  // Category 2: Socket
  socket: {
    registerSocketHandlers: socketHandlers.registerSocketHandlers,
    handlers: socketHandlers,
  },
  // Category 3: State
  state: {
    redisStore,
    store,
    reports: reportState,
  },
  // Category 4: Data
  data: {
    ...data,
    slurFilter,
    moderation,
    userStore,
    reportStore,
    spamStore,
    securityStore,
  },
  // Category 5: Utils
  utils: {
    conversationModerator,
    moderation: aiModeration,
    ids,
    logger,
  },
  // Category 6: Config
  config: {
    ...config,
    firebase: firebaseConfig,
  },
};
