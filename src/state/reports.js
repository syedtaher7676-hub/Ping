/**
 * In-Memory Anonymous Reporting & Temporary 15-Minute Ban Store
 * Uses pure JavaScript Maps without external database or AI overhead.
 */

const BAN_DURATION_MS = 15 * 60 * 1000;    // 15 minutes
const REPORTER_WINDOW_MS = 60 * 1000;      // 1 minute window for rapid clicks
const TARGET_WINDOW_MS = 60 * 60 * 1000;   // 1 hour window for target flags
const REPORTER_MAX_REPORTS = 3;            // > 3 clicks in 1 min triggers ban
const TARGET_BAN_THRESHOLD = 3;            // 3 total reports triggers ban

// In-memory JavaScript Maps & Bidirectional Pool
const bans = new Map();             // deviceHash / userId / ip -> banExpiresAt (epoch ms)
const bannedIps = new Map();        // ip -> banExpiresAt (epoch ms)
const banMetadata = new Map();      // identifier -> { reason, bannedAt, durationMs, ip, deviceHash, userId }
const ipToDevices = new Map();      // ip -> Set<string> (deviceHashes & userIds)
const deviceToIps = new Map();      // deviceHash/userId -> Set<string> (ips)
const reporterHistory = new Map();  // reporterHash -> Array of timestamp ms
const targetFlags = new Map();      // targetHash -> Array of timestamp ms
const recentReports = [];           // Ring buffer of recent reports (max 100)
const MAX_RECENT_REPORTS = 100;

// Lazy import dbService to avoid circular dependency
let dbService = null;
function getDbService() {
  if (!dbService) {
    try {
      dbService = require("../services/dbService");
    } catch (_) {}
  }
  return dbService;
}

/**
 * Link a deviceHash, client IP, and userId in the bidirectional in-memory pool.
 * If the IP is already banned, automatically propagates the ban to the device and user.
 * If the device is already banned, automatically propagates the ban to the IP.
 */
function linkDeviceAndIp(deviceHash, ip, userId = null) {
  const now = Date.now();

  // Normalize IP
  const cleanIp = (ip && typeof ip === "string") ? ip.trim() : null;
  const isIgnoredIp = !cleanIp || cleanIp === "unknown" || cleanIp === "127.0.0.1" || cleanIp === "::1" || cleanIp === "localhost";

  // Register in deviceToIps and ipToDevices
  if (cleanIp && !isIgnoredIp) {
    if (deviceHash) {
      if (!deviceToIps.has(deviceHash)) deviceToIps.set(deviceHash, new Set());
      deviceToIps.get(deviceHash).add(cleanIp);

      if (!ipToDevices.has(cleanIp)) ipToDevices.set(cleanIp, new Set());
      ipToDevices.get(cleanIp).add(deviceHash);
    }
    if (userId) {
      if (!deviceToIps.has(userId)) deviceToIps.set(userId, new Set());
      deviceToIps.get(userId).add(cleanIp);

      if (!ipToDevices.has(cleanIp)) ipToDevices.set(cleanIp, new Set());
      ipToDevices.get(cleanIp).add(userId);
    }

    // Ban propagation check 1: Is this IP banned?
    const ipExpiresAt = bannedIps.get(cleanIp) || bans.get(cleanIp);
    if (ipExpiresAt && ipExpiresAt > now) {
      const meta = banMetadata.get(cleanIp) || { reason: "Associated IP banned for policy violation", durationMs: BAN_DURATION_MS };
      if (deviceHash && (!bans.has(deviceHash) || bans.get(deviceHash) < ipExpiresAt)) {
        bans.set(deviceHash, ipExpiresAt);
        banMetadata.set(deviceHash, { ...meta, ip: cleanIp, deviceHash });
      }
      if (userId && (!bans.has(userId) || bans.get(userId) < ipExpiresAt)) {
        bans.set(userId, ipExpiresAt);
        banMetadata.set(userId, { ...meta, ip: cleanIp, userId });
      }
    }

    // Ban propagation check 2: Is the device or user banned?
    const devExpiresAt = (deviceHash ? bans.get(deviceHash) : 0) || (userId ? bans.get(userId) : 0);
    if (devExpiresAt && devExpiresAt > now) {
      const meta = (deviceHash ? banMetadata.get(deviceHash) : null) || (userId ? banMetadata.get(userId) : null) || { reason: "Banned device network association", durationMs: BAN_DURATION_MS };
      bannedIps.set(cleanIp, devExpiresAt);
      bans.set(cleanIp, devExpiresAt);
      banMetadata.set(cleanIp, { ...meta, ip: cleanIp });
    }
  }
}

/**
 * Check if a device, IP, or user is banned and return how many minutes are remaining.
 * Checks the deviceHash, the userId, the client IP, and any identifiers linked in the pool.
 * Returns positive integer minutes remaining (e.g., 15) if banned, or 0 if not banned.
 *
 * @param {string} deviceHash
 * @param {string} [ip]
 * @param {string} [userId]
 * @returns {number} minutes remaining
 */
function isDeviceBanned(deviceHash, ip = null, userId = null) {
  const now = Date.now();
  let maxExpiresAt = 0;

  const checkIdentifier = (id, map) => {
    if (!id || typeof id !== "string") return;
    const expiresAt = map.get(id);
    if (expiresAt) {
      if (now >= expiresAt) {
        map.delete(id);
        banMetadata.delete(id);
      } else if (expiresAt > maxExpiresAt) {
        maxExpiresAt = expiresAt;
      }
    }
  };

  // 1. Direct deviceHash check
  checkIdentifier(deviceHash, bans);

  // 2. Direct userId check
  checkIdentifier(userId, bans);

  // 3. Direct IP check
  const cleanIp = (ip && typeof ip === "string") ? ip.trim() : null;
  if (cleanIp) {
    checkIdentifier(cleanIp, bannedIps);
    checkIdentifier(cleanIp, bans);
  }

  // 4. Check linked IPs for this deviceHash
  if (deviceHash && deviceToIps.has(deviceHash)) {
    for (const linkedIp of deviceToIps.get(deviceHash)) {
      checkIdentifier(linkedIp, bannedIps);
      checkIdentifier(linkedIp, bans);
    }
  }

  // 5. Check linked IPs for this userId
  if (userId && deviceToIps.has(userId)) {
    for (const linkedIp of deviceToIps.get(userId)) {
      checkIdentifier(linkedIp, bannedIps);
      checkIdentifier(linkedIp, bans);
    }
  }

  // 6. Check linked devices for this IP (Anti-Cookie-Clear Bypass Pool)
  if (cleanIp && ipToDevices.has(cleanIp)) {
    for (const linkedDev of ipToDevices.get(cleanIp)) {
      checkIdentifier(linkedDev, bans);
    }
  }

  if (maxExpiresAt > now) {
    // If banned, make sure current identifiers are bound to the pool
    if (cleanIp) {
      bannedIps.set(cleanIp, maxExpiresAt);
      bans.set(cleanIp, maxExpiresAt);
    }
    if (deviceHash) bans.set(deviceHash, maxExpiresAt);
    if (userId) bans.set(userId, maxExpiresAt);

    const remainingMs = maxExpiresAt - now;
    return Math.max(1, Math.ceil(remainingMs / 60000));
  }

  return 0;
}

/**
 * Record a report from reporterHash against targetHash.
 * a. If the reporter clicks report more than 3 times in 1 minute, ban the reporter for 15 minutes.
 * b. Add 1 report flag to targetHash. Reset flags after 1 hour.
 * c. If targetHash reaches 3 total reports, ban targetHash for 15 minutes.
 *
 * @param {string} reporterHash
 * @param {string} targetHash
 * @param {string} [reporterIp]
 * @param {string} [targetIp]
 * @returns {object} { reporterBanned: boolean, targetBanned: boolean, bannedHash?: string, minutesLeft?: number, reason?: string, targetFlagsCount?: number }
 */
function recordReport(reporterHash, targetHash, reporterIp = null, targetIp = null) {
  const now = Date.now();

  if (reporterHash && reporterIp) linkDeviceAndIp(reporterHash, reporterIp);
  if (targetHash && targetIp) linkDeviceAndIp(targetHash, targetIp);

  // a. If the reporter clicks report more than 3 times in 1 minute, ban reporter for 15 minutes
  if (reporterHash && typeof reporterHash === "string") {
    let history = reporterHistory.get(reporterHash) || [];
    // Reset timestamps older than 1 minute
    history = history.filter((ts) => now - ts <= REPORTER_WINDOW_MS);
    history.push(now);
    reporterHistory.set(reporterHash, history);

    if (history.length > REPORTER_MAX_REPORTS) {
      banDevice(reporterHash, BAN_DURATION_MS, "Report button spam (>3 in 1m)", reporterIp);
      return {
        reporterBanned: true,
        targetBanned: false,
        bannedHash: reporterHash,
        minutesLeft: 15,
        reason: "reporter_spam",
      };
    }
  }

  // Record into in-memory reports log
  if (reporterHash && targetHash) {
    recentReports.push({
      reportId: "rep_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      reporterHash,
      targetHash,
      timestamp: now,
      reason: "User flagged for inappropriate behavior",
      status: "pending_review",
    });
    if (recentReports.length > MAX_RECENT_REPORTS) {
      recentReports.shift();
    }
  }

  // b. Add 1 report flag to targetHash. Reset flags after 1 hour.
  if (targetHash && typeof targetHash === "string") {
    let flags = targetFlags.get(targetHash) || [];
    // Reset flags older than 1 hour
    flags = flags.filter((ts) => now - ts <= TARGET_WINDOW_MS);
    flags.push(now);
    targetFlags.set(targetHash, flags);

    // c. If targetHash reaches 3 total reports, ban targetHash for 15 minutes.
    if (flags.length >= TARGET_BAN_THRESHOLD) {
      banDevice(targetHash, BAN_DURATION_MS, `Exceeded community reports threshold (${TARGET_BAN_THRESHOLD} reports)`, targetIp);
      targetFlags.delete(targetHash); // Clear flags once ban is triggered
      return {
        reporterBanned: false,
        targetBanned: true,
        bannedHash: targetHash,
        minutesLeft: 15,
        reason: "target_reported",
      };
    }

    return {
      reporterBanned: false,
      targetBanned: false,
      targetFlagsCount: flags.length,
    };
  }

  return {
    reporterBanned: false,
    targetBanned: false,
    targetFlagsCount: 0,
  };
}

/**
 * Helper to ban a device and all associated IPs/devices in the pool for 15 minutes.
 * Also persists the ban to Cloud Firestore so bans survive restarts.
 */
function banDevice(deviceHash, durationMs = BAN_DURATION_MS, reason = "Manual admin suspension", ip = null, userId = null) {
  if (!deviceHash && !ip && !userId) return;
  const now = Date.now();
  const banExpiresAt = now + durationMs;

  const meta = {
    reason,
    bannedAt: now,
    durationMs,
    expiresAt: banExpiresAt,
    ip: ip || null,
    deviceHash: deviceHash || null,
    userId: userId || null,
  };

  if (deviceHash) {
    bans.set(deviceHash, banExpiresAt);
    banMetadata.set(deviceHash, meta);
  }

  if (userId) {
    bans.set(userId, banExpiresAt);
    banMetadata.set(userId, meta);
  }

  if (ip) {
    bannedIps.set(ip, banExpiresAt);
    bans.set(ip, banExpiresAt);
    banMetadata.set(ip, meta);
  }

  // Propagate to all linked IPs and devices in the pool
  if (deviceHash && deviceToIps.has(deviceHash)) {
    for (const linkedIp of deviceToIps.get(deviceHash)) {
      bannedIps.set(linkedIp, banExpiresAt);
      bans.set(linkedIp, banExpiresAt);
      banMetadata.set(linkedIp, meta);

      if (ipToDevices.has(linkedIp)) {
        for (const linkedDev of ipToDevices.get(linkedIp)) {
          bans.set(linkedDev, banExpiresAt);
          banMetadata.set(linkedDev, meta);
        }
      }
    }
  }

  if (ip && ipToDevices.has(ip)) {
    for (const linkedDev of ipToDevices.get(ip)) {
      bans.set(linkedDev, banExpiresAt);
      banMetadata.set(linkedDev, meta);
    }
  }

  // Persist to Cloud Firestore
  try {
    const db = getDbService();
    if (db && typeof db.saveBan === "function") {
      const banId = deviceHash || userId || ip || ("ban_" + now);
      db.saveBan({
        banId,
        reason,
        expiresAt: banExpiresAt,
        durationMs,
        bannedAt: now,
        userId: userId || "",
        deviceHash: deviceHash || "",
        ip: ip || "",
        bannedBy: "system_moderator",
      }).catch(() => {});
    }
  } catch (_) {}
}

/**
 * Helper to unban a device, IP, or user and all linked pool members
 */
function unbanDevice(deviceHashOrIp) {
  if (!deviceHashOrIp) return;
  bans.delete(deviceHashOrIp);
  bannedIps.delete(deviceHashOrIp);
  banMetadata.delete(deviceHashOrIp);

  // Clean linked pool
  if (deviceToIps.has(deviceHashOrIp)) {
    for (const linkedIp of deviceToIps.get(deviceHashOrIp)) {
      bannedIps.delete(linkedIp);
      bans.delete(linkedIp);
      banMetadata.delete(linkedIp);
      if (ipToDevices.has(linkedIp)) {
        for (const linkedDev of ipToDevices.get(linkedIp)) {
          bans.delete(linkedDev);
          banMetadata.delete(linkedDev);
        }
      }
    }
  }
  if (ipToDevices.has(deviceHashOrIp)) {
    for (const linkedDev of ipToDevices.get(deviceHashOrIp)) {
      bans.delete(linkedDev);
      banMetadata.delete(linkedDev);
    }
  }

  try {
    const db = getDbService();
    if (db && typeof db.removeBan === "function") {
      db.removeBan(deviceHashOrIp).catch(() => {});
    }
  } catch (_) {}
}

/**
 * Hydrates active bans from Cloud Firestore on container wake-up / cold boot
 */
async function hydrateBansFromFirestore() {
  try {
    const db = getDbService();
    if (!db || typeof db.getActiveBans !== "function") return;
    const activeBans = await db.getActiveBans();
    if (!Array.isArray(activeBans)) return;

    const now = Date.now();
    let hydratedCount = 0;

    for (const ban of activeBans) {
      const expiresAt = Number(ban.expiresAt);
      if (expiresAt > now) {
        const durationMs = Number(ban.durationMs) || (expiresAt - now);
        const meta = {
          reason: ban.reason || "Suspension by moderation policy",
          bannedAt: Number(ban.bannedAt) || now,
          durationMs,
          expiresAt,
          ip: ban.ip || null,
          deviceHash: ban.deviceHash || null,
          userId: ban.userId || null,
        };

        if (ban.deviceHash) {
          bans.set(ban.deviceHash, expiresAt);
          banMetadata.set(ban.deviceHash, meta);
        }
        if (ban.userId) {
          bans.set(ban.userId, expiresAt);
          banMetadata.set(ban.userId, meta);
        }
        if (ban.ip) {
          bannedIps.set(ban.ip, expiresAt);
          bans.set(ban.ip, expiresAt);
          banMetadata.set(ban.ip, meta);
        }
        if (ban.banId && !bans.has(ban.banId)) {
          bans.set(ban.banId, expiresAt);
          banMetadata.set(ban.banId, meta);
        }

        if (ban.deviceHash && ban.ip) {
          linkDeviceAndIp(ban.deviceHash, ban.ip, ban.userId);
        }
        hydratedCount++;
      }
    }

    if (hydratedCount > 0) {
      try {
        const { log } = require("../utils/logger");
        log("bans_hydrated_from_firestore", { count: hydratedCount });
      } catch (_) {}
    }
  } catch (err) {
    try {
      const { log } = require("../utils/logger");
      log("bans_hydration_error", { message: err?.message });
    } catch (_) {}
  }
}

/**
 * Return all currently active device bans with remaining minutes
 */
function getAllActiveBans() {
  const list = [];
  const now = Date.now();
  for (const [deviceHash, expiresAt] of bans.entries()) {
    if (expiresAt > now) {
      const remainingMs = expiresAt - now;
      const minutesLeft = Math.max(1, Math.ceil(remainingMs / 60000));
      const meta = banMetadata.get(deviceHash) || {};
      list.push({
        deviceHash,
        expiresAt,
        minutesLeft,
        reason: meta.reason || "Suspended by moderation policy",
        bannedAt: meta.bannedAt || (now - (meta.durationMs || BAN_DURATION_MS) + remainingMs),
      });
    }
  }
  return list.sort((a, b) => b.expiresAt - a.expiresAt);
}

/**
 * Return in-memory report entries
 */
function getInMemoryReports() {
  return [...recentReports].reverse();
}

/**
 * Update report status in memory
 */
function updateInMemoryReportStatus(reportId, status) {
  const item = recentReports.find((r) => r.reportId === reportId);
  if (item) {
    item.status = status;
    return true;
  }
  return false;
}

/**
 * Helper to clear all bans and reports (useful for testing)
 */
function clearAllReportsAndBans() {
  bans.clear();
  banMetadata.clear();
  reporterHistory.clear();
  targetFlags.clear();
  recentReports.length = 0;
}

// Periodic background memory sweep (prevents unbounded Map growth under 10k users)
setInterval(() => {
  const now = Date.now();
  for (const [deviceHash, expiresAt] of bans.entries()) {
    if (now >= expiresAt) {
      bans.delete(deviceHash);
      banMetadata.delete(deviceHash);
    }
  }
  for (const [reporterHash, history] of reporterHistory.entries()) {
    const valid = history.filter((ts) => now - ts <= REPORTER_WINDOW_MS);
    if (valid.length === 0) reporterHistory.delete(reporterHash);
    else reporterHistory.set(reporterHash, valid);
  }
  for (const [targetHash, flags] of targetFlags.entries()) {
    const valid = flags.filter((ts) => now - ts <= TARGET_WINDOW_MS);
    if (valid.length === 0) targetFlags.delete(targetHash);
    else targetFlags.set(targetHash, valid);
  }
}, 60000).unref();

module.exports = {
  bans,
  bannedIps,
  banMetadata,
  reporterHistory,
  targetFlags,
  linkDeviceAndIp,
  isDeviceBanned,
  recordReport,
  banDevice,
  unbanDevice,
  getAllActiveBans,
  hydrateBansFromFirestore,
  getInMemoryReports,
  updateInMemoryReportStatus,
  clearAllReportsAndBans,
  BAN_DURATION_MS,
  REPORTER_WINDOW_MS,
  TARGET_WINDOW_MS,
  TARGET_BAN_THRESHOLD,
};
