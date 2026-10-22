# Community Safety & Trust Guidelines — Ping

**Effective Date:** October 22, 2026  

Ping is dedicated to fostering a safe, respectful, and high-quality environment for real-time anonymous conversations. Our platform combines on-device local AI moderation with strict automated policies to protect users from harassment, spammers, and malicious actors.

---

## 1. Core Safety Principles

1. **Strictly Adults-Only (18+):** Ping is reserved exclusively for adults aged 18 and older. Minors are strictly prohibited.
2. **Respect Your Chat Partners:** Harassment, hate speech, slurs, and threats are blocked automatically and result in immediate temporary or permanent bans.
3. **Protect Your Personal Identity:** Never disclose your full name, home address, financial details, phone number, or social media handles to strangers.
4. **Report Bad Behavior Promptly:** Use the in-app **Report** button to flag partners who attempt to bypass filters or engage in abusive conduct.

---

## 2. Text-Only Platform Scope & Exploitation Prevention

- **Text-Only Operational Boundary:** Ping is strictly a text-only real-time chat platform. No file attachments, image uploads, or video streaming features exist.
- **Child Safety & Exploitation Zero Tolerance:** Ping enforces zero tolerance for child sexual abuse material (CSAM), grooming, or exploitation. All text streams are continuously monitored in real time using local neural transformer models (`Xenova/toxic-bert`) and deterministic pattern matrices. Violations are logged, blocked, and reported to law enforcement agencies where legally required.

---

## 3. Automated Dual-Pass Moderation & 3-Strike Rule

Ping executes a two-pass moderation architecture on every transmitted message:

- **Pass 1 — Fast Sub-Millisecond Inspection:** Evaluates text against regular expression matrices for profanity, phone number harvesting, external link spam, and obfuscated leetspeak.
- **Pass 2 — Local ONNX Neural Inference:** Evaluates text sentiment using the embedded `Xenova/toxic-bert` model inside the Node.js process without transferring data to external third-party AI APIs.

### The 3-Strike Discipline System:
- **Strike 1:** Message blocked; warning delivered (`⚠️ Warning 1/3`).
- **Strike 2:** Message blocked; final warning delivered (`⚠️ Warning 2/3`).
- **Strike 3:** Ephemeral chat room terminated; 15-minute device & IP ban enforced; partner requeued automatically.

---

## 4. IP Threat Intelligence & Network Protection

To prevent automated botnet attacks and queue stuffing, Ping screens incoming connections against datacenter ASNs, Tor exit nodes, and commercial VPN pools. Users connecting via high-risk proxies may be requested to disable their VPN before entering matchmaking queues.

---

## 5. Contact & Support Escalations

If you encounter safety issues or wish to report severe violations:
- **Safety Team:** `safety@ping.app`
- **Abuse Reports:** `abuse@ping.app`
