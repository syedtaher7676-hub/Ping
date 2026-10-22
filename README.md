# Ping

Ping is a production-grade, high-concurrency anonymous messaging platform engineered for ultra-low-latency pairing, on-device local AI moderation, and automated network threat defense. Architected on Node.js, Express, Socket.IO, and Google Cloud Firestore, Ping combines in-memory queue orchestration with multi-vector threat intelligence and automated content governance to deliver a secure, resilient real-time communication ecosystem.

---

## Executive Overview & Engineering Vision

Traditional anonymous pairing systems face three systemic failure modes:
1. **Network & Bot Abuse**: Unrestricted access leads to automated spam swarms, multi-accounting, and commercial VPN exploitation.
2. **Moderation Bottlenecks**: Heavy human moderation creates high operating costs, while basic keyword blocklists are easily bypassed by leetspeak and phonetic obfuscation.
3. **Infrastructure Bottlenecks**: High-frequency database reads and writes during traffic spikes create performance degradation and elevated cloud costs.

Ping solves these structural challenges through a multi-tiered technical design:
- **Low-Latency In-Memory Pairing**: In-memory queue pools matching users in sub-200ms windows with fail-open cluster fallback.
- **On-Device Transformer Inference**: In-process ONNX neural network execution (`Xenova/toxic-bert`) providing contextual toxicity classification at sub-millisecond speeds with zero third-party API costs.
- **Autonomous Risk Intelligence Engine**: Network perimeter inspection screening caller IPs against datacenter ASN registries, Tor exit node lists, proxy headers, and client timezone mismatches.
- **Hybrid Storage & Hydration Pipeline**: Inter-flush memory delta buffering that reduces Cloud Firestore write frequency by 95% while retaining state recovery across container cold boots.
- **Zero-Trust Attribute-Based Access Control**: Database-level security rules enforcing strict identity and permission boundaries across all Firestore collections.

---

## Comprehensive Architecture Structure & Execution Flows

Ping is architected as an event-driven, decoupled system composed of six interconnected operational layers:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     1. CLIENT INTERACTION LAYER                                  │
│   Cyber Glass Web UI  ·  Socket.IO Engine.IO Transport  ·  Firestore OnSnapshot State Listeners  │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │ WebSockets / WSS / HTTP Preflight
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   2. INGRESS & SECURITY LAYER                                    │
│  Cors Preflight  ·  Handshake Authenticator  ·  IP Risk Inspector  ·  Per-IP Connection Governor │
└───────────────────────────────┬──────────────────────────────────┬───────────────────────────────┘
                                │                                  │
                                ▼                                  ▼
┌───────────────────────────────────────────────────┐  ┌───────────────────────────────────────────┐
│         3. MATCHMAKING & ROOM ENGINE              │  │      4. LOCAL ONNX MODERATION ENGINE      │
│ In-Memory Priority Queues  ·  Peer Room Routing   │  │ Sub-ms Fast Regex  ·  Toxic-BERT Transformer│
└───────────────────────────────┬───────────────────┘  └───────────────────┬───────────────────────┘
                                │                                          │
                                ├──────────────────────────────────────────┘
                                │
                      ┌─────────┴─────────┐
                      ▼                   ▼
┌──────────────────────────┐     ┌─────────────────────────────────────────────────────────────────┐
│ 5. REDIS PUB/SUB ADAPTER │     │                   6. CLOUD FIRESTORE STORAGE                    │
│ Multi-Node Sync Adapter  │     │ User Profiles · Bans · Reports · Telemetry Batch Sync · ABAC    │
└──────────────────────────┘     └─────────────────────────────────────────────────────────────────┘
```

---

### End-to-End Sequence & Data Flow Visualizations

#### Flow 1: Connection Setup, Handshake Auth & Threat Inspection

```
Client                      Express Gateway              VPN Detector              Firestore Storage
  │                                │                          │                            │
  │─── 1. WebSocket Handshake ────►│                          │                            │
  │     (userId, deviceHash, tz)   │                          │                            │
  │                                │─── 2. Inspect IP & Headers ──►                        │
  │                                │     (cf-ipcountry, via)  │                            │
  │                                │                          │                            │
  │                                │◄── 3. Return Threat Score └──                          │
  │                                │     (isVpn, ASN, provider)                            │
  │                                │                                                       │
  │                                ├───────────────────────────────────────────────────────┤
  │                                │ EVALUATE SHIELD POLICY                                │
  │                                │ - If VPN Shield ON & isVpn == true:                   │
  │                                │   Emit "vpn_detected" & Close Handshake               │
  │                                │ - Else: Proceed & Bind socket.data                    │
  │                                ├───────────────────────────────────────────────────────┤
  │                                │                                                       │
  │◄── 4. Handshake Accepted ──────│                                                       │
  │                                │─── 5. Async User Profile Sync ───────────────────────►│
  │                                │     (lastSeenAt, country, vpnStatus)                  │
```

---

#### Flow 2: In-Memory Matchmaking & Ephemeral Room Pairing

```
User A Socket               Matchmaking Engine             User B Socket            Redis Pub/Sub
  │                                 │                            │                        │
  │─── 1. emit("start_chat") ──────►│                            │                        │
  │                                 │                            │                        │
  │                                 ├────────────────────────────┤                        │
  │                                 │ QUEUE PLACEMENT            │                        │
  │                                 │ Add User A to Pool         │                        │
  │                                 ├────────────────────────────┤                        │
  │                                                              │                        │
  │                                 │◄── 2. emit("start_chat") ──│                        │
  │                                 │     Add User B to Pool     │                        │
  │                                 │                            │                        │
  │                                 ├────────────────────────────┤                        │
  │                                 │ MATCHMAKER TICK (200ms)    │                        │
  │                                 │ Pair User A & User B       │                        │
  │                                 │ Create Ephemeral Room ID   │                        │
  │                                 ├────────────────────────────┤                        │
  │                                 │                            │                        │
  │◄── 3. emit("chat_started") ─────│──── 3. emit("chat_started")►│                        │
  │     (roomId, partnerCountry)    │      (roomId, partnerCountry)                        │
  │                                 │                            │                        │
  │                                 │─── 4. Broadcast Active Room Event ─────────────────►│
```

---

#### Flow 3: Message Processing & Two-Pass Local Edge Moderation

```
User A                      Room Handler              ONNX AI Engine             User B
  │                               │                          │                      │
  │─── 1. emit("send_message") ──►│                          │                      │
  │     (text, roomId)            │                          │                      │
  │                               │                          │                      │
  │                               ├─── 2. Pass 1: Sub-ms Fast Regex ───┐            │
  │                               │     (Slur matrix, links, phone)   │            │
  │                               │◄──────────────────────────────────┘            │
  │                               │                                                │
  │                               ├─── 3. Pass 2: Local ONNX Model ──►             │
  │                               │     (Xenova/toxic-bert)          │             │
  │                               │◄─── 4. Toxicity Score (0.00-1.00) └             │
  │                               │                                                │
  │                               ├────────────────────────────────────────────────┤
  │                               │ EVALUATE MODERATION DECISION                   │
  │                               │ - If Clean (Score < 0.85):                     │
  │                               │     Deliver message to User B                  │
  │                               │ - If Toxic (Score >= 0.85):                    │
  │                               │     Increment User A Strike Count              │
  │                               │     Execute Action (Warning 1/2 or Ban)        │
  │                               ├────────────────────────────────────────────────┤
  │                               │                                                │
  │◄── 5. Warning / Rejection ────┤                                                │
  │     (if violation occurred)   │─── 6. Deliver Message (if clean) ───────────────►│
```

---

#### Flow 4: Automated 3-Strike Discipline & Room Escalation

```
Violating User                  Server Moderation Engine                     Chat Partner
     │                                     │                                      │
     │─── Offense 1: Slur / Toxicity ─────►│                                      │
     │◄── Warning Notice (1/3) ────────────│ (Message Intercepted & Blocked)     │
     │                                     │                                      │
     │─── Offense 2: Slur / Toxicity ─────►│                                      │
     │◄── Final Warning Notice (2/3) ──────│ (Message Intercepted & Blocked)     │
     │                                     │                                      │
     │─── Offense 3: Slur / Toxicity ─────►│                                      │
     │                                     ├──────────────────────────────────────┤
     │                                     │ STRIKE 3 EXECUTION                   │
     │                                     │ 1. Save Ban Record to Cloud Firestore│
     │                                     │ 2. Terminate Ephemeral Room           │
     │                                     │ 3. Disconnect Offender Socket        │
     │                                     │ 4. Issue 15-Minute Device Suspension │
     │                                     ├──────────────────────────────────────┤
     │                                     │                                      │
     │◄── Force Disconnect / Ban Screen ───│                                      │
     │                                     │─── Partner Notice & Auto-Requeue ───►│
     │                                     │    ("Partner banned for bad behavior")│
```

---

#### Flow 5: Persistent Friend Request & Direct Messaging Bridge

```
User A                         Server & Database                        User B
  │                                    │                                  │
  │─── 1. Send Friend Request ────────►│                                  │
  │                                    │─── 2. Relay Request Notice ─────►│
  │                                    │                                  │
  │                                    │◄── 3. Accept Friend Request ─────│
  │                                    │                                  │
  │                                    ├──────────────────────────────────┤
  │                                    │ CANONICAL PAIR CREATION          │
  │                                    │ Generate Pair ID (userA_userB)   │
  │                                    │ Write to Cloud Firestore         │
  │                                    ├──────────────────────────────────┤
  │                                    │                                  │
  │◄── 4. Friend Added Confirmation ───┼─── 4. Friend Added Confirmation ─►│
  │                                    │                                  │
  │                                    ├──────────────────────────────────┤
  │                                    │ DIRECT MESSAGING ROUTE           │
  │                                    │ Private DMs routed via Firestore │
  │                                    │ & WebSockets with safety filters │
  │                                    └──────────────────────────────────┘
```

---

#### Flow 6: Asynchronous Telemetry Buffer, Batch Flushing & Recovery

```
System Activity              In-Memory Buffer             30s Timer             Cloud Firestore
  │                                 │                         │                        │
  │─── High-Freq Events ───────────►│                         │                        │
  │    (Messages, CCU, Violations)  │ (Accumulate Deltas)     │                        │
  │                                 │                         │                        │
  │                                 │                         │─── Trigger Batch Sync ─►│
  │                                 │                         │                        │
  │                                 │◄── Write Success ───────┼─── Commit Payload ─────│
  │                                 │    Reset Local Buffer   │                        │
  │                                 │                         │                        │
  │                                 ├─────────────────────────┴────────────────────────┤
  │                                 │ CONTAINER RESTART / COLD BOOT RECOVERY           │
  │                                 │ On server startup, hydrate active bans & rules  │
  │                                 │ directly from Firestore into memory.             │
  │                                 └──────────────────────────────────────────────────┘
```

---

## Technical Deep-Dive into Subsystem Modules

### 1. Ingress & Handshake Authenticator (`src/server.js`)
Every incoming WebSockets connection passes through the `io.use` authentication middleware.
- **Identity Integrity**: Sanitizes client-provided `userId` and `deviceHash` strings, stripping malicious prototype properties (`__proto__`, `constructor`) and assigning secure fallback keys if invalid.
- **Network Threat Evaluation**: Extracts client IP from proxies (`cf-connecting-ip`, `x-real-ip`, `x-forwarded-for`), performs asynchronous lookup in the LRU threat cache, and calculates a risk score based on ISP/ASN tags and timezone-geolocation discrepancies.
- **Concurrency Governor**: Enforces per-IP socket tracking. If an IP exceeds 30 concurrent socket connections, further handshake attempts are rejected to prevent botnet swarms.

---

### 2. Ephemeral Matchmaking & Session Manager (`src/services/matchmaking.js`)
Manages waiting user pools and pairs clients into isolated communication rooms.
- **Fast Queue Polling**: Evaluates candidate pools every 200ms. Pairs available users while honoring regional geofencing rules and global queue caps.
- **Ghost Session Pruning**: Periodically checks socket connection states. Idle or disconnected socket references are flushed from the queue to maintain accurate CCU telemetry.
- **Room Lifecycle Tracking**: Maintains an in-memory Map of active rooms (`room_xxxx`), tracking start time, message counts, participant IDs, and typing states.

---

### 3. Dual-Pass AI Edge Moderation Engine (`src/socket/registerSocketHandlers.js`)
Protects chat rooms by executing content inspection prior to message delivery.
- **Pass 1 — High-Speed Regex Filtering**: Evaluates input against slur matrices, contact details (phone numbers, email addresses, social handles), and obfuscated leetspeak patterns.
- **Pass 2 — Local Transformer Model Inference**: Uses HuggingFace `@xenova/transformers` running the `toxic-bert` model directly in Node.js. Generates normalized toxicity scores between $0.00$ and $1.00$.
- **Automated Enforcement Protocol**:
  - **Toxicity < 0.85**: Message is clean; delivered instantly to the target room.
  - **Toxicity >= 0.85**: Message is blocked; user receives Strike 1 or Strike 2 warnings.
  - **Strike 3**: Triggers automated 15-minute suspension, saves ban record to Cloud Firestore, disconnects offender, terminates room, and requeues partner.

---

### 4. Risk Intelligence Engine (`src/services/vpnDetector.js`)
Protects matchmaking queues from malicious automated traffic, proxies, and commercial VPN pools.
- **In-Memory Threat Caching**: Uses a fast 10,000-entry LRU cache with a 24-hour TTL to eliminate repetitive network lookup overhead.
- **Multi-Vector Classification**: Evaluates IP subnets against datacenter ASN lists (AWS, DigitalOcean, Hetzner, OVH, Linode, Vultr, M247) and commercial VPN providers (NordVPN, ExpressVPN, Surfshark, Mullvad).
- **Timezone Discrepancy Heuristic**: Compares client-reported browser timezones against geolocated IP timezones. A mismatch exceeding 4 hours triggers a threat flag.
- **Admin Shield Overrides**: Admins can toggle the global `vpnShieldEnabled` setting dynamically via the REST API or dashboard.

---

### 5. Social Persistence Engine (`src/services/dbService.js`)
Manages persistent data storage, social relationships, and telemetry synchronization.
- **Canonical Pair ID Generation**: Friendships generate deterministic document IDs (`userA_userB`) using sorted user IDs, ensuring single-document pair lookup.
- **Dual-Mode Persistence Bridge**: Executes mutations via the Cloud Firestore Node.js Admin SDK when available, automatically falling back to an HTTP REST API bridge with explicit `updateMask` parameters if SDK credentials are absent.
- **Telemetry Batch Sync**: Buffers high-frequency counters in memory and flushes aggregated metrics to `/telemetry/live_metrics` in Firestore every 30 seconds.

---

### 6. Admin Telemetry & Governance Suite (`public/admin.js`)
Provides real-time system visualization and platform administration tools.
- **60fps Real-Time Sparklines**: Renders smooth Chart.js curves for Active Sockets, Live Room Count, Message Throughput ($M/s$), and Threat Rate ($V/s$).
- **Live System Shield Controls**: Toggle buttons for VPN Shield, Strict Mode (1-strike ban), Slow Mode rate limiting, Raid Shield, and External Link Filter.
- **Direct Interactive Controls**: Admins can issue direct warnings, silence bad actors, execute force-skips, or apply ghost shadowbans.

---

## Data Model & Firestore Security Rules

Ping enforces Attribute-Based Access Control (ABAC) using zero-trust security rules (`firestore.rules`).

### Collections & Entity Structure

| Collection Path | Schema Entity | Access Policy |
| :--- | :--- | :--- |
| `/users/{userId}` | `User` | Read: Authenticated / Admin. Write: Profile Owner or Verified Admin (`syedtaher7676@gmail.com`). |
| `/bans/{banId}` | `Ban` | Read: System/Admin. Write: Automated Server Processes or Verified Admin. |
| `/reports/{reportId}` | `Report` | Read: Verified Admin. Write: Create-only for authenticated users. |
| `/moderation_logs/{logId}` | `ModerationLog` | Read/Write: Restricted to server process and verified admin. |
| `/system_settings/{settingId}` | `SystemSettings` | Read: Public/System. Write: Restricted strictly to verified admin. |
| `/friendships/{pairId}` | `Friendship` | Read/Write: Restricted to pair participants or verified admin. |
| `/telemetry/{docId}` | `Telemetry` | Read: Verified Admin. Write: System processes. |

---

## Legal & Regulatory Compliance Strategy

Ping implements strict legal and operational boundaries designed for international compliance:

1. **Strict 18+ Adults-Only Policy (`TERMS.md`)**: Ping is exclusively designed for adults aged 18 and older. Minors are prohibited, and suspected minor sessions are terminated with active device bans.
2. **Explicit "No Third-Party AI Data Transfer" Clause (`PRIVACY.md`)**: Content safety and toxicity AI analysis executes **100% locally in-process** via ONNX Runtime (`Xenova/toxic-bert`). Raw chat text is **NEVER** transmitted to, processed by, or shared with third-party external AI APIs (e.g. OpenAI, Anthropic, or Google AI) for processing or model training.
3. **GDPR "Legitimate Interest" Legal Basis (`PRIVACY.md`)**: Under **Article 6(1)(f) of the EU/UK GDPR (Legitimate Interest)**, Ping processes anonymized device hashes (`dev_xxxx`) and temporary IP telemetry strictly for platform safety, abuse prevention, 15-minute ban enforcement, and network security.
4. **Explicit Text-Only CSAM Scope Boundary (`SAFETY.md`)**: Ping operates strictly as a text-only platform with no image/video streaming uploads. This removes the operational burden and expense of heavy media image-hashing APIs (such as PhotoDNA or Thorn) while maintaining zero tolerance for text-based grooming or exploitation via local neural matchers.

---

## Production Setup & Deployment

### Prerequisites
- Node.js v18.0.0+
- npm v9.0.0+
- Google Cloud Project with Cloud Firestore enabled
- Redis v6.0+ (Optional, required for multi-node clustering)

### Environment Configuration

Create a `.env` file in the application root directory:

```env
PORT=3000
NODE_ENV=production
ADMIN_PASSWORD=YourSecurePasswordHere
REDIS_URL=redis://127.0.0.1:6379
FIREBASE_PROJECT_ID=impressive-atlas-4ggh3
FIREBASE_API_KEY=AIzaSy...
```

### Installation & Initialization

```bash
# Clone the repository
git clone https://github.com/syedtaher7676-hub/Pingit.git
cd Pingit

# Install dependencies
npm install

# Validate source code syntax and structure
npm run lint
```

### Execution Modes

```bash
# Start development server with file watching
npm run dev

# Start production server
npm start
```

---

## Automated Test Suites

Ping includes integration and unit test scripts covering moderation, WebSockets, reporting, and admin features.

```bash
# Test slur detection and 3-strike progression
node scripts/test-slur-3strike-policy.js

# Test real-time Socket.IO room lifecycle and automatic ban triggers
node scripts/test-socket-3strike-flow.js

# Test anonymous device reporting thresholds
node scripts/test-anonymous-reporting.js

# Test admin authentication and system settings persistence
node scripts/test-admin-settings.js
```

---

## Complete API Architecture Reference

### Public API Endpoints

| Endpoint | Method | Response Payload | Description |
| :--- | :--- | :--- | :--- |
| `/health` | `GET` | `{ status, stats, timestamp }` | Operational health check and active CCU metrics |
| `/api/stats` | `GET` | `{ activeUsers, totalChats }` | Landing page platform metrics |
| `/api/check-vpn` | `GET` | `{ ip, isVpn, shieldEnabled, provider }` | Evaluates caller IP for VPN/Proxy risks |
| `/api/firebase-config` | `GET` | `{ projectId, apiKey, ... }` | Client SDK bootstrap configuration |

### Protected Administrative API (Bearer Auth Required)

| Endpoint | Method | Payload / Action | Description |
| :--- | :--- | :--- | :--- |
| `/api/admin/login` | `POST` | `{ password }` | Authenticates admin and returns 30-day session token |
| `/api/admin/overview` | `GET` | — | Returns live system metrics, CCU, and memory usage |
| `/api/admin/system/vpn-shield` | `POST` | `{ enabled }` | Updates VPN Shield enforcement policy |
| `/api/admin/system/strict-mode` | `POST` | `{ enabled }` | Toggles emergency 1-strike ban mode |
| `/api/admin/system/slow-mode` | `POST` | `{ seconds }` | Updates chat rate governor cooldown |
| `/api/admin/system/raid-shield` | `POST` | `{ enabled }` | Controls anti-bot queue joining caps |
| `/api/admin/kick` | `POST` | `{ target }` | Terminates active socket connection |
| `/api/admin/shadowbans/add` | `POST` | `{ target, durationMinutes, reason }` | Silently isolates user into ghost queue |

---

## License

MIT License. Designed and engineered for high-concurrency, production-grade anonymous communications.
