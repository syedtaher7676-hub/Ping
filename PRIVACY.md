# Privacy Policy — Ping

**Effective Date:** October 22, 2026  
**Last Updated:** October 22, 2026  

Ping ("we", "us", or "our") is committed to protecting user privacy and maintaining transparency regarding data handling in our anonymous real-time communications platform. This Privacy Policy explains how data is processed, why it is processed, and how your privacy is protected.

---

## 1. Zero Chat Log Persistence & Ephemeral Processing

- **Ephemeral Chat Streams:** Conversations on Ping occur in real time and exist **strictly in temporary server RAM** during the active session.
- **Zero Raw Text Storage:** We do **NOT** record, store, archive, or write raw chat message contents to permanent database storage or disk. Once a chat session ends or either user disconnects, the conversation memory is permanently discarded.
- **No Private Content Monetization:** We never sell, lease, analyze, or trade conversation streams for advertising or marketing profiling.

---

## 2. Explicit "No Third-Party AI Data Transfer" Clause

- **100% Local In-Process AI Moderation:** AI-powered content safety and toxicity analysis on Ping is executed **locally in-process** on our application servers using the embedded ONNX Runtime (`Xenova/toxic-bert`).
- **Zero Third-Party AI API Transfers:** Your raw chat text is **NEVER** transmitted to, processed by, or shared with third-party external AI model vendors (such as OpenAI, Anthropic, Google Cloud Vertex AI, or Cohere).
- **No AI Model Training:** Your private messages are **NEVER** used to train, fine-tune, or evaluate public or proprietary third-party machine learning models.

---

## 3. Legal Basis for Data Processing (GDPR Article 6(1)(f) Legitimate Interest)

To enforce platform safety, prevent automated botnet attacks, and execute temporary suspensions against severe policy violators, Ping processes limited technical metadata under **Article 6(1)(f) of the EU/UK General Data Protection Regulation (GDPR) — Legitimate Interest**.

### Category of Data Processed under Legitimate Interest:
1. **Anonymized Device Hashes (`dev_xxxx`):** Cryptographically derived identifiers calculated from browser environment metrics. Device hashes do NOT reveal real-world identity, name, or phone number.
2. **Temporary Threat Telemetry & IP Logs:** Ephemeral IP risk scores, country locations, and header indicators (`cf-ipcountry`, `x-forwarded-for`) processed to detect commercial VPN pools, proxy swarms, and Tor exit nodes.

### Legal Justification & Balancing Test:
- **Purpose:** Processing device hashes and IP telemetry is strictly necessary to protect platform integrity, enforce 15-minute abuse suspensions, and prevent multi-accounting bot swarms.
- **Minimal Privacy Impact:** Data is anonymized, decoupled from real-world identities, and restricted to platform security operations.

---

## 4. Summary of Collected Data

| Data Category | Purpose | Retention Period | Storage Location |
| :--- | :--- | :--- | :--- |
| **Raw Chat Text** | Ephemeral messaging | **0 Seconds** (RAM only during session) | Deleted on session teardown |
| **Anonymized Device Hash** | Ban enforcement & safety | Active ban duration (15m to 30 days) | Cloud Firestore (`/bans`) |
| **IP Threat Telemetry** | VPN & proxy protection | In-memory cache (24-hour TTL) | Server Memory (LRU Cache) |
| **Aggregated Metrics** | System health & CCU | Permanent (Aggregated stats only, no text/PII) | Cloud Firestore (`/telemetry`) |

---

## 5. Strict 18+ Age Limit & Child Privacy Protection

Ping is strictly an **18+ adults-only platform**. We do not knowingly collect personal data from or offer services to minors under 18 years of age. If we discover that a user is under 18, their connection is terminated immediately, and their device identifier is blocked from matchmaking.

---

## 6. User Data Rights under GDPR & CCPA

Depending on your jurisdiction (such as the EU, UK, or California), you possess specific rights regarding your personal data:

- **Right to Erasure (Right to be Forgotten):** Because Ping does not collect names, emails, or phone numbers, there are no user account profiles stored. If you wish to request deletion of any associated temporary ban hash, contact `privacy@ping.app`.
- **Right to Object:** You may object to the processing of device hashes under Legitimate Interest by contacting us, provided such objection does not compromise active platform security controls against ongoing abuse.

---

## 7. Contact Us

For privacy inquiries, GDPR data requests, or safety policy questions:
- **Data Protection Office:** `privacy@ping.app`
- **Trust & Safety Operations:** `safety@ping.app`
