# Enterprise Product Requirement Document (PRD): Ping

**Product Name:** Ping — Next-Generation Real-Time Anonymous Communications Ecosystem  
**Document Version:** v3.0.0-Enterprise  
**Document Authors:** VP of Product Management, Lead Technical Product Manager (TPM), Principal Product Marketing Manager (PMM), Chief Safety Officer  
**Document Status:** Production Approved & Executive Signed-Off  
**Target Stakeholders:** Executive Board, MNC Engineering Leadership, Product Strategy, Trust & Safety Ops, Platform Security, Infrastructure & Growth Teams  

---

## 1. Executive Summary & Business Justification

### 1.1 Executive Summary
Ping is an enterprise-grade, high-concurrency anonymous communications platform engineered to solve the safety, scaling, and cost bottlenecks of real-time pairing apps. Powered by Node.js, Express, Socket.IO, and Google Cloud Firestore, Ping combines sub-200ms in-memory matchmaking with on-device local neural transformer inference (`Xenova/toxic-bert`) and autonomous network perimeter defense.

By running AI toxicity classification directly at the local application edge ($0.00 third-party API cost), Ping delivers continuous content protection, blocking slurs, harassers, and VPN botnets before abusive messages reach user screens.

### 1.2 The Business Case & Unit Economics
Traditional real-time chat platforms running cloud LLM moderation APIs incur prohibitive operational costs at scale.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        MODERATION COST COMPARISON (100M MSGS/MO)                       │
├──────────────────────────────────────────┬─────────────────────────────────────────────┤
│ Third-Party Cloud LLM API (@ $0.0015/msg)│ $150,000 / month ($1.8M / year)             │
├──────────────────────────────────────────┼─────────────────────────────────────────────┤
│ Ping Local Edge ONNX Transformer         │ $0.00 / month  (100% In-Process Execution)   │
├──────────────────────────────────────────┼─────────────────────────────────────────────┤
│ ANNUAL COST SAVINGS DELIVERED            │ $1,800,000 / year                           │
└──────────────────────────────────────────┴─────────────────────────────────────────────┘
```

Furthermore, by utilizing an **In-Memory 30-Second Delta Buffer**, Ping reduces Cloud Firestore database write operations by **95%**, optimizing infrastructure expenses while guaranteeing state recovery across server restarts.

### 1.3 Key Value Drivers
1. **Ultra-Low Latency Pairing**: Matchmaking latency consistently under 200ms globally.
2. **Zero-Cost Local Edge AI**: Local ONNX transformer inference executing in < 2ms without cloud dependencies.
3. **Automated Threat Defense**: Multi-vector IP threat intelligence eliminating botnet swarms and commercial VPN abuse.
4. **Persistent Social Conversion**: High-conversion transition from ephemeral anonymous pairing to mutual persistent friendships.

---

## 2. Market Analysis, Opportunities & Positioning

### 2.1 Market Failure Analysis & Competitive Landscape

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        COMPETITIVE LANDSCAPE & DIFFERENTIATION                         │
├───────────────────┬───────────────────┬───────────────────┬────────────────────────────┤
│ Dimension         │ Legacy Anonymous  │ Modern Social Apps│ Ping Platform              │
├───────────────────┼───────────────────┼───────────────────┼────────────────────────────┤
│ Match Speed       │ High Friction (2s+)│ Medium            │ Sub-200ms In-Memory Pool   │
│ Moderation Tech   │ Reactive / None   │ Cloud API / Manual│ Dual-Pass Edge ONNX Neural │
│ Moderation Cost   │ High / Unscalable │ $100K+/mo Cloud   │ $0.00 Local Edge Inference │
│ Network Defense   │ None              │ Basic Blacklist   │ Autonomous IP/ASN Inspector│
│ Conversion Bridge │ Dead End          │ Full Profile Req  │ Anonymous Mutual Friend DM │
│ Privacy Model     │ Unsafe Data Stores│ High PII Exposure │ Zero-PII Ephemeral Memory  │
└───────────────────┴───────────────────┴───────────────────┴────────────────────────────┘
```

### 2.2 Target Demographics & Personas

- **Persona 1: "Alex" — The Gen-Z Explorer (End User)**
  - *Goal*: Fast, spontaneous, interesting conversations in a safe, non-toxic environment.
  - *Frustrations*: Offensive slurs, commercial spammers, bot accounts, slow loading queues.
  - *Outcome*: Connects instantly, encounters zero abusive language, converts good conversations into persistent friendships.

- **Persona 2: "David" — Director of Trust & Safety (Operations Lead)**
  - *Goal*: Maintain brand safety, prevent viral safety crises, and govern platform health.
  - *Frustrations*: High moderation team costs, delayed action reports, lack of real-time visibility during traffic surges.
  - *Outcome*: Relies on automated 3-strike enforcement, live 60fps sparkline metrics, and instant shield controls.

- **Persona 3: "Elena" — VP of Engineering (MNC Infrastructure Lead)**
  - *Goal*: High-concurrency architecture with zero single points of failure and low operational costs.
  - *Frustrations*: Cloud database bill shocks, third-party API rate limits, non-scalable WebSocket state.
  - *Outcome*: Deployable single-node or Redis-clustered architecture with 95% reduced database operations and local edge AI.

---

## 3. Product Goals & Metric Framework

### 3.1 North Star Metric
**Daily Active Quality Conversations (DAQC)**: The total daily paired chat sessions that extend beyond 60 seconds without encountering a moderation event or user report.

### 3.2 Quantitative Objective Key Results (OKRs)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                OKR GOALS & TARGETS                                     │
├──────────────────────────────────────┬────────────────────────┬────────────────────────┤
│ Performance / Safety Dimension       │ Baseline Standard      │ Target Benchmark       │
├──────────────────────────────────────┼────────────────────────┼────────────────────────┤
│ Matchmaking Pairing Latency (P95)    │ 1,500ms                │ < 200ms                │
│ Edge Toxicity Interception Precision │ 80.0%                  │ > 98.5%                │
│ Toxicity-Driven User Churn Rate      │ 12.0%                  │ < 2.5%                 │
│ VPN / Proxy Block Precision          │ 70.0%                  │ > 99.2%                │
│ Database Operation Cost Reduction    │ 0.0% (Direct Writes)   │ > 95.0% (RAM Buffered) │
└──────────────────────────────────────┴────────────────────────┴────────────────────────┘
```

---

## 4. Subsystem Architecture & Detailed Specifications

### 4.1 Subsystem A: Low-Latency Matchmaking & Session Manager

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        MATCHMAKING & ROOM LIFECYCLE FLOW                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  Client Connection  ──►  Handshake Auth & IP Risk Screen  ──►  In-Memory Queue Pool    │
│                                                                        │               │
│                                                                  200ms │ Worker        │
│                                                                        ▼               │
│  Active Chat Room   ◄──  Emit "chat_started" Payload  ◄──  Pair Candidates In Pool    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Functional Requirements
- **FR-A.1 Ingress Handshake**: Validates client `userId` and `deviceHash` against prototype injection attacks and checks active bans in Cloud Firestore before queue entry.
- **FR-A.2 Sub-200ms Matchmaking Ticker**: Evaluates candidate pools every 200ms, pairing available users while respecting regional geofencing and queue capacity caps.
- **FR-A.3 Ephemeral Room Creation**: Generates dedicated room identifiers (`room_xxxx`) managing real-time typing indicators, delivery ACKs, and session teardown.
- **FR-A.4 Reconnection Grace Period**: Transient socket drops hold the user's room state for 15 seconds to allow seamless auto-reconnect without terminating active conversations.

---

### 4.2 Subsystem B: Dual-Pass AI Edge Content Moderation Engine

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                    DUAL-PASS MODERATION & 3-STRIKE ENFORCEMENT                         │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Incoming Message  ──► Pass 1: Sub-ms Fast Regex  ──► Pass 2: Local Toxic-BERT ONNX     │
│                              │                                     │                   │
│                        Match │                               Score │ >= 0.85           │
│                              ▼                                     ▼                   │
│                     ┌──────────────────────────────────────────────────┐               │
│                     │             3-STRIKE DISCIPLINE ENGINE           │               │
│                     ├──────────────────────────────────────────────────┤               │
│                     │ Strike 1: Intercept + Block + Warning 1/2        │               │
│                     │ Strike 2: Intercept + Block + Final Warning 2/2  │               │
│                     │ Strike 3: Terminate Room + 15m Ban + Disconnect  │               │
│                     └──────────────────────────────────────────────────┘               │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Functional Requirements
- **FR-B.1 Sub-Millisecond Pattern Matcher**: Evaluates text against regular expression matrices for profanity, phone number harvesting, external links, and leetspeak substitutions.
- **FR-B.2 Local ONNX Transformer Inference**: Evaluates text sentiment using embedded `Xenova/toxic-bert` model inside the Node.js process, yielding normalized scores between $0.00$ and $1.00$.
- **FR-B.3 Automated 3-Strike Escalation**:
  - *Strike 1*: Intercepts message, blocks transmission, and delivers real-time warning (`⚠️ Warning 1/3`).
  - *Strike 2*: Intercepts message, blocks transmission, and delivers final warning (`⚠️ Warning 2/3`).
  - *Strike 3*: Immediately terminates room, issues a 15-minute device/IP ban to Cloud Firestore, disconnects offender, and notifies partner with automatic requeue.
- **FR-B.4 Anonymous Device Reporting**: 3 reports on a target device within a rolling window trigger an automated suspension.

---

### 4.3 Subsystem C: Network Threat Intelligence & Autonomous VPN Shield

#### Functional Requirements
- **FR-C.1 ASN & Hosting Screening**: Evaluates caller IPs against known datacenter subnets (AWS, DigitalOcean, Hetzner, OVH, Linode, Vultr, M247) and commercial VPN providers (NordVPN, ExpressVPN, Surfshark, Mullvad).
- **FR-C.2 Timezone & Tor Inspection**: Evaluates Tor headers (`cf-ipcountry: T1`, `via`, `forwarded`) and flags client browser timezone mismatches exceeding 4 hours.
- **FR-C.3 VPN Shield Policy**: When active, blocks proxy/datacenter connections at WebSocket handshake and displays an explanatory UI.
- **FR-C.4 Per-IP Socket Governor**: Caps concurrent active WebSockets per IP address to 30 connections to prevent socket exhaustion attacks.

---

### 4.4 Subsystem D: Persistent Social Bridge & Direct Messaging

#### Functional Requirements
- **FR-D.1 Mutual Consent Requests**: Participants in an active room can issue friend requests. Mutual confirmation generates a canonical pair ID (`userA_userB`) in Cloud Firestore.
- **FR-D.2 Direct Messaging Route**: Enables private direct messaging channels outside matchmaking queues while maintaining content protection filters.
- **FR-D.3 Real-Time Presence Sync**: Firestore snapshot listeners monitor friend availability and broadcast online/offline status updates.

---

### 4.5 Subsystem E: Administrative Command & Control Suite

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                       ADMINISTRATIVE TELEMETRY CONSOLE                                 │
├───────────────────┬───────────────────┬───────────────────┬────────────────────────────┤
│ ONLINE CCU: 142   │ LIVE ROOMS: 71    │ QUEUE DEPTH: 3    │ THROUGHPUT: 18.4 msgs/s    │
├───────────────────┴───────────────────┴───────────────────┴────────────────────────────┤
│ [60fps Rolling Sparklines: Active Sockets · Live Rooms · Message Velocity · Threat Rate]│
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ADMINISTRATIVE SHIELD CONTROLS                                                         │
│ [VPN Shield: ENABLED]  [Strict Mode: OFF]  [Raid Shield: OFF]  [Link Filter: ENABLED]   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Functional Requirements
- **FR-E.1 Live Telemetry & Sparkline Curves**: Displays system metrics including Active CCU, Live Room Count, Message Throughput ($M/s$), Violation Rate ($V/s$), and Event Loop Lag.
- **FR-E.2 System Governance Shields**: One-click toggles for VPN Shield, Strict Mode (1-strike ban), Slow Mode rate governor, Raid Shield, and External Link Filter.
- **FR-E.3 Direct Interactive Actions**: System admins can issue direct warnings, silence users, execute force-skips, or apply ghost shadowbans.

---

## 5. Security Architecture & Data Privacy Strategy

### 5.1 Zero-Trust Firestore Security Rules (ABAC)
Ping enforces zero-trust Attribute-Based Access Control (`firestore.rules`):

- `/users/{userId}`: Editable only by profile owner or verified system administrator (`syedtaher7676@gmail.com`).
- `/bans/{banId}`: Read-only for authenticated roles; write operations restricted to automated server processes and verified admins.
- `/reports/{reportId}`: Create-only for authenticated users; modification restricted to admin review.

### 5.2 Enterprise PII & Privacy Standards
- **Zero Chat Log Persistence**: Ephemeral chat message text is processed in memory and never written to permanent database storage.
- **Anonymized Telemetry**: System metrics aggregate numerical counts only, ensuring zero personal identity exposure.

---

## 6. Product Marketing & Go-To-Market Strategy (PMM)

### 6.1 Brand Positioning & Messaging
"Ping is the global standard for safe, instant, and high-quality anonymous communications — powered by local edge AI that protects conversations without compromising user privacy."

### 6.2 Target Acquisition Channels
- **Gen-Z Digital Communities**: Campus networks, Discord communities, social platforms.
- **Tech-Forward Enthusiasts**: Developer communities, Product Hunt, technology publications.

### 6.3 Viral Growth Mechanics
- **In-Chat Friend Conversion**: Seamless path from anonymous pairing to persistent friend messaging.
- **Organic Word-of-Mouth**: Clean, cyber-glass visual aesthetic driving organic user sharing.

---

## 7. Risk Management & Exposure Matrix

| Risk Factor | Severity | Impact | Engineering Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Botnet Surge Raids** | High | Queue Saturation | Activate **Raid Shield** and **Per-IP Connection Governor**. |
| **Obfuscated Slur Bypasses** | Medium | User Harassment | Dual-pass moderation combining fast leetspeak regex with ONNX neural inference. |
| **Commercial VPN Abuse** | High | Multi-accounting | Autonomous IP Threat Engine screening ASN registries and Tor exit headers. |
| **Database Cost Spikes** | Medium | Elevated Overhead | In-memory 30-second batch delta buffering reducing write ops by 95%. |

---

## 8. Release Criteria & Test Automation

All pre-deployment quality gates must pass prior to release:

1. **Automated Test Suite**:
   - `node scripts/test-slur-3strike-policy.js` (100% Pass)
   - `node scripts/test-socket-3strike-flow.js` (100% Pass)
   - `node scripts/test-anonymous-reporting.js` (100% Pass)
   - `node scripts/test-admin-settings.js` (100% Pass)
2. **Build Verification**:
   - `npm run lint` (0 Syntax / Import Errors)
   - Successful build compilation via `compile_applet`.
3. **Performance Benchmarks**:
   - Matchmaking pairing latency < 250ms under peak load.
   - Zero memory leaks during multi-hour soak testing.
