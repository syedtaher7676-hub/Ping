# Ping Architecture & Software Organization

Ping is a high-concurrency, real-time anonymous 1-on-1 chat web application featuring millisecond matchmaking, ephemeral rooms, multi-tier automated moderation (0ms phonetic/leetspeak filter + local ONNX AI model), device-level reputation protection, and persistent Cloud Firestore synchronization.

---

## Software Categorization & Directory Structure

```
├── public/                 ── FRONTEND SUBSYSTEM (Single Page Application & Assets)
│   ├── index.html          ── Main SPA HTML entrypoint, modals, video/chat UI
│   ├── app.js              ── Core frontend application (Socket.IO client, chat, typing, audio)
│   ├── admin.js            ── Real-time administrator dashboard & monitoring controls
│   ├── animations.js       ── UI audio effects, confetti, and visual animations
│   ├── firebase-client.js  ── Client-side Firebase SDK configuration and user sync
│   ├── styles.css          ── Complete styling rules, responsive layout & themes
│   ├── animations.css      ── Keyframe animations and motion styling
│   ├── sw.js               ── PWA Service Worker (offline cache & installability)
│   ├── manifest.json       ── Web App Manifest configuration
│   ├── privacy.html        ── Privacy policy informational page
│   ├── terms.html          ── Terms of service informational page
│   ├── safety.html         ── User safety guidelines informational page
│   ├── 404.html            ── Fallback error page
│   └── (branding assets)   ── SVGs, PNGs, touch icons, and favicons
│
├── src/                    ── BACKEND SUBSYSTEM (Node.js, Express & Socket.IO)
│   ├── index.js            ── Central architecture catalog linking backend & frontend
│   ├── backend.js          ── Subsystem index linking services, state, data, sockets, and utils
│   ├── frontend.js         ── Asset registry and directory mapper for client files
│   ├── server.js           ── HTTP server bootstrap, REST API routes, admin endpoints, and static serve
│   │
│   ├── config/             ── Runtime & Configuration
│   │   ├── config.js       ── Environment variables, rate limits, and system constants
│   │   └── firebase.js     ── Firebase Admin SDK initialization & credentials
│   │
│   ├── services/           ── Core Application Business Logic
│   │   ├── matchmaking.js      ── Interest-based & geo-priority user pairing engine
│   │   ├── sessionManager.js   ── Chat room lifecycles, timer synchronization & tear down
│   │   ├── friendService.js    ── Mutual friend requests, direct messaging, and room persistence
│   │   ├── dbService.js        ── Cloud Firestore persistence, sync, and recovery operations
│   │   ├── behaviorAnalytics.js── User psychology metrics, sentiment, and telemetry tracking
│   │   ├── vpnDetector.js      ── IP geolocation and proxy/VPN anti-abuse screening
│   │   └── modelTrainer.js     ── Active learning and automated local model training
│   │
│   ├── socket/             ── Real-Time WebSocket Engine
│   │   └── registerSocketHandlers.js ── Socket.IO connection lifecycle, messaging, rate limiting
│   │
│   ├── state/              ── In-Memory & Distributed State Stores
│   │   ├── redisStore.js   ── Distributed Redis state adapter with fail-open in-memory fallback
│   │   ├── store.js        ── Unified state store facade
│   │   └── reports.js      ── Anonymous user report queue, rate governor, and 15-min bans
│   │
│   ├── data/               ── Data Access & Machine Learning Models
│   │   ├── index.js        ── Data stores aggregator
│   │   ├── slurFilter.js   ── Multi-lingual slur dictionary, leetspeak & homoglyph normalizers
│   │   ├── moderation.js   ── In-memory conversational quality filters (gender/age probe guards)
│   │   ├── userStore.js    ── Ephemeral and cached user profiles
│   │   ├── reportStore.js  ── Debounced disk persistence for user safety flags
│   │   ├── spamStore.js    ── Flood violations and rate infraction logs
│   │   ├── securityStore.js── Admin audit security logging
│   │   └── models/         ── Local neural network weights (custom_moderator config & weights)
│   │
│   ├── utils/              ── Algorithmic Utilities
│   │   ├── conversationModerator.js ── Regex & NLP algorithms for phone, social handle, and threat detection
│   │   ├── moderation.js            ── 4-layer AI moderation pipeline ($0 local ONNX / fallback)
│   │   ├── ids.js                   ── Secure nano-ID generators
│   │   └── logger.js                ── Structured JSON logging
│   │
│   └── scripts/            ── Lua Engine
│       └── matchmaking.lua ── Atomic multi-key queue operations for Redis
│
├── data/                   ── PERSISTENT DATASETS & AI MODEL TRAINING DATA
│   ├── moderation_dataset.json  ── Tagged training samples for conversation moderation
│   ├── training_dataset_ready.json / .csv ── Pre-processed active learning datasets
│   └── security.json / reports.json / spam.json / penalties.json
│
├── scripts/                ── VERIFICATION & TEST SUITE
│   ├── smoke-test.js                     ── Healthcheck and server boot validation
│   ├── test-redis-integration.js         ── Redis state store & atomic operations test
│   ├── test-firestore-integration.js     ── Firestore DB CRUD, sync & friendship tests
│   ├── test-friend-dm-routing.js         ── Real-time mutual friend request & DM delivery test
│   ├── test-slur-3strike-policy.js       ── 3-strike slur penalty escalation test
│   ├── test-socket-3strike-flow.js       ── End-to-end Socket.IO ban & requeue verification
│   ├── test-anonymous-reporting.js       ── Report abuse limits and auto-ban verification
│   ├── test-admin-settings.js            ── Admin auth, slow-mode, raid-shield, and telemetry test
│   ├── test-conversational-moderation.js ── Obfuscation, homoglyphs, and zero-false-positive idiom test
│   ├── test_onnx_moderator.js            ── Neural network inference validation
│   └── train_and_update_model.js         ── Active learning model retraining script
│
├── k8s/                    ── DEVOPS & CONTAINER ORCHESTRATION
│   ├── deployment.yaml     ── Kubernetes workload definition
│   ├── hpa.yaml            ── Horizontal Pod Autoscaler configuration
│   ├── ingress.yaml        ── Ingress routing & TLS configuration
│   ├── kustomization.yaml  ── Kustomize configuration
│   └── redis-service.yaml  ── Redis service & StatefulSet
│
└── Root Project Configuration
    ├── package.json        ── NPM scripts and dependency definitions
    ├── Dockerfile          ── Multi-stage production container build
    ├── docker-compose.yml  ── Local microservice composition
    ├── nginx.conf          ── Reverse proxy and rate limiter configuration
    ├── Procfile            ── Process manager service definition
    ├── README.md           ── Comprehensive product, architectural & operational guide
    └── ARCHITECTURE.md     ── Subsystem categorization and linking catalog
```

---

## Inter-Module Linkages

1. **Frontend to Backend**:
   - Web clients connect via WebSocket (`/socket.io`) and REST endpoints (`/api/*`, `/health`).
   - `public/index.html` loads `app.js` (regular users) and `admin.js` (administrators).
   - In-app friend requests, direct messages, and chat pairing flow through `src/socket/registerSocketHandlers.js`.

2. **Backend to Persistence**:
   - `src/services/dbService.js` manages bidirectional synchronization with Google Cloud Firestore (`users`, `friendships`, `friend_requests`, `reports`, `friend_chats`, `system_settings`).
   - In-memory state seamlessly falls back if Redis or Firestore is unreachable (zero hard crashes).

3. **Multi-Layer Safety Engine**:
   - **Layer 0**: `src/utils/conversationModerator.js` detects phone numbers, social media handles, extortion, and threats.
   - **Layer 1**: `src/data/slurFilter.js` normalizes homoglyphs, leetspeak, spacing, and phonetic slang.
   - **Layer 2**: `src/utils/moderation.js` evaluates local ONNX models (`Xenova/toxic-bert`) and custom neural weights in `src/data/models/custom_moderator/`.
   - **Layer 3**: 3-Strike escalation governed by `src/socket/registerSocketHandlers.js` with instant partner notification and requeuing.
