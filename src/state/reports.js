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
const reporterHistory = new Map();  // reporterHash -> Array of timestamp ms
const targetFlags = new Map();      // targetHash -> Array of timestamp ms

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
      return {
        reporterBanned: true,
        targetBanned: false,
        bannedHash: reporterHash,
        minutesLeft: 15,
        reason: "reporter_spam",
      };
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
function banDevice(deviceHash, durationMs = BAN_DURATION_MS) {
  if (!deviceHash) return;
  bans.set(deviceHash, Date.now() + durationMs);
}

/**
 * Helper to unban a device
 */
function unbanDevice(deviceHash) {
  if (!deviceHash) return;
  bans.delete(deviceHash);
}

/**
 * Helper to clear all bans and reports (useful for testing)
 */
function clearAllReportsAndBans() {
  bans.clear();
  reporterHistory.clear();
  targetFlags.clear();
}

// Periodic background memory sweep (prevents unbounded Map growth under 10k users)
setInterval(() => {
  const now = Date.now();
  for (const [deviceHash, expiresAt] of bans.entries()) {
    if (now >= expiresAt) bans.delete(deviceHash);
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
  reporterHistory,
  targetFlags,
  isDeviceBanned,
  recordReport,
  banDevice,
  unbanDevice,
  clearAllReportsAndBans,
  BAN_DURATION_MS,
  REPORTER_WINDOW_MS,
  TARGET_WINDOW_MS,
  TARGET_BAN_THRESHOLD,
};
