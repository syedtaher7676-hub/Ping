/**
 * In-Memory Anonymous Reporting & Temporary 15-Minute Ban Store
 * Uses pure JavaScript Maps without external database or AI overhead.
 */

const BAN_DURATION_MS = 15 * 60 * 1000;    // 15 minutes
const REPORTER_WINDOW_MS = 60 * 1000;      // 1 minute window for rapid clicks
const TARGET_WINDOW_MS = 60 * 60 * 1000;   // 1 hour window for target flags
const REPORTER_MAX_REPORTS = 3;            // > 3 clicks in 1 min triggers ban
const TARGET_BAN_THRESHOLD = 3;            // 3 total reports triggers ban

// In-memory JavaScript Maps
const bans = new Map();             // deviceHash -> banExpiresAt (epoch ms)
const banMetadata = new Map();      // deviceHash -> { reason, bannedAt, durationMs }
const reporterHistory = new Map();  // reporterHash -> Array of timestamp ms
const targetFlags = new Map();      // targetHash -> Array of timestamp ms
const recentReports = [];           // Ring buffer of recent reports (max 100)
const MAX_RECENT_REPORTS = 100;

/**
 * Check if a device is banned and return how many minutes are remaining.
 * Returns positive integer minutes remaining (e.g., 15) if banned, or 0 if not banned.
 *
 * @param {string} deviceHash
 * @returns {number} minutes remaining
 */
function isDeviceBanned(deviceHash) {
  if (!deviceHash || typeof deviceHash !== "string") return 0;
  const expiresAt = bans.get(deviceHash);
  if (!expiresAt) return 0;

  const now = Date.now();
  if (now >= expiresAt) {
    bans.delete(deviceHash);
    return 0;
  }

  const remainingMs = expiresAt - now;
  return Math.max(1, Math.ceil(remainingMs / 60000));
}

/**
 * Record a report from reporterHash against targetHash.
 * a. If the reporter clicks report more than 3 times in 1 minute, ban the reporter for 15 minutes.
 * b. Add 1 report flag to targetHash. Reset flags after 1 hour.
 * c. If targetHash reaches 3 total reports, ban targetHash for 15 minutes.
 *
 * @param {string} reporterHash
 * @param {string} targetHash
 * @returns {object} { reporterBanned: boolean, targetBanned: boolean, bannedHash?: string, minutesLeft?: number, reason?: string, targetFlagsCount?: number }
 */
function recordReport(reporterHash, targetHash) {
  const now = Date.now();

  // a. If the reporter clicks report more than 3 times in 1 minute, ban reporter for 15 minutes
  if (reporterHash && typeof reporterHash === "string") {
    let history = reporterHistory.get(reporterHash) || [];
    // Reset timestamps older than 1 minute
    history = history.filter((ts) => now - ts <= REPORTER_WINDOW_MS);
    history.push(now);
    reporterHistory.set(reporterHash, history);

    if (history.length > REPORTER_MAX_REPORTS) {
      const banExpiresAt = now + BAN_DURATION_MS;
      bans.set(reporterHash, banExpiresAt);
      banMetadata.set(reporterHash, {
        reason: "Report button spam (>3 in 1m)",
        bannedAt: now,
        durationMs: BAN_DURATION_MS,
      });
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

    // c. If targetHash reaches 2 total reports, ban targetHash for 15 minutes.
    if (flags.length >= TARGET_BAN_THRESHOLD) {
      const banExpiresAt = now + BAN_DURATION_MS;
      bans.set(targetHash, banExpiresAt);
      banMetadata.set(targetHash, {
        reason: `Exceeded community reports threshold (${TARGET_BAN_THRESHOLD} reports)`,
        bannedAt: now,
        durationMs: BAN_DURATION_MS,
      });
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
 * Helper to manually ban a device
 */
function banDevice(deviceHash, durationMs = BAN_DURATION_MS, reason = "Manual admin suspension") {
  if (!deviceHash) return;
  const now = Date.now();
  bans.set(deviceHash, now + durationMs);
  banMetadata.set(deviceHash, {
    reason,
    bannedAt: now,
    durationMs,
  });
}

/**
 * Helper to unban a device
 */
function unbanDevice(deviceHash) {
  if (!deviceHash) return;
  bans.delete(deviceHash);
  banMetadata.delete(deviceHash);
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
  banMetadata,
  reporterHistory,
  targetFlags,
  isDeviceBanned,
  recordReport,
  banDevice,
  unbanDevice,
  getAllActiveBans,
  getInMemoryReports,
  updateInMemoryReportStatus,
  clearAllReportsAndBans,
  BAN_DURATION_MS,
  REPORTER_WINDOW_MS,
  TARGET_WINDOW_MS,
  TARGET_BAN_THRESHOLD,
};
