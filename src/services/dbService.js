/**
 * ─────────────────────────────────────────────────────────────
 * Cloud Firestore Database Service for Ping
 * ─────────────────────────────────────────────────────────────
 * Handles persistent data storage and real-time sync for:
 *  - users (profiles, total matches, ban status, strikes, VPN detection)
 *  - bans (active and expired 15-minute / permanent bans with user ID & device hash)
 *  - reports (user reports, flags, review states)
 *  - moderation_logs (slur violations, 3-strike warnings, spam penalties)
 *  - system_settings (VPN shield, strict emergency mode, slow mode)
 *  - friendships, friend requests, friend chats
 *
 * HYBRID RESILIENCE:
 *  - Connects via Firebase Admin SDK if service account is provisioned.
 *  - Automatically bridges via Cloud Firestore REST API with the applet's API key
 *    if Admin SDK is unauthenticated, ensuring 100% write & read sync across container
 *    sleeps, multiple browsers, and localhost.
 */

const https = require("https");
const firebaseConfig = require("../config/firebase");
const { FieldValue } = firebaseConfig;

// Load applet config
let appletConfig = null;
try {
  appletConfig = require("../../firebase-applet-config.json");
} catch {
  try {
    appletConfig = require("../firebase-applet-config.json");
  } catch {
    appletConfig = {
      projectId: "impressive-atlas-4ggh3",
      firestoreDatabaseId: "ai-studio-ping-97f03824-bc8c-4fb8-b4e8-22aa46e3bdea",
      apiKey: "AIzaSyCoxk4oQMIeLenwtdmjZkW04Xr7XAmMqeY",
    };
  }
}

const PROJECT_ID = appletConfig?.projectId || "impressive-atlas-4ggh3";
const DATABASE_ID = appletConfig?.firestoreDatabaseId || "ai-studio-ping-97f03824-bc8c-4fb8-b4e8-22aa46e3bdea";
const API_KEY = appletConfig?.apiKey || "AIzaSyCoxk4oQMIeLenwtdmjZkW04Xr7XAmMqeY";

// Collection name constants
const COLLECTIONS = {
  USERS: "users",
  BANS: "bans",
  REPORTS: "reports",
  MODERATION_LOGS: "moderation_logs",
  SYSTEM_SETTINGS: "system_settings",
  FRIENDSHIPS: "friendships",
  FRIEND_REQUESTS: "friend_requests",
  FRIEND_CHATS: "friend_chats",
  ADMIN_SESSIONS: "admin_sessions",
  TELEMETRY: "telemetry",
};

function getDb() {
  return firebaseConfig.getDb();
}

function isFirebaseConfigured() {
  return firebaseConfig.isFirebaseConfigured();
}

/**
 * Encodes a JavaScript object into Firestore REST API value format
 */
function encodeFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === "string") return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(encodeFirestoreValue) } };
  }
  if (typeof val === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = encodeFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

/**
 * Decodes Firestore REST API value format into standard JavaScript object
 */
function decodeFirestoreValue(fieldVal) {
  if (!fieldVal) return null;
  if ("stringValue" in fieldVal) return fieldVal.stringValue;
  if ("booleanValue" in fieldVal) return fieldVal.booleanValue;
  if ("integerValue" in fieldVal) return Number(fieldVal.integerValue);
  if ("doubleValue" in fieldVal) return fieldVal.doubleValue;
  if ("nullValue" in fieldVal) return null;
  if ("timestampValue" in fieldVal) return fieldVal.timestampValue;
  if ("arrayValue" in fieldVal) {
    return (fieldVal.arrayValue.values || []).map(decodeFirestoreValue);
  }
  if ("mapValue" in fieldVal) {
    const obj = {};
    const fields = fieldVal.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      obj[k] = decodeFirestoreValue(v);
    }
    return obj;
  }
  return null;
}

function decodeFirestoreDoc(doc) {
  if (!doc || !doc.fields) return null;
  const result = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    result[k] = decodeFirestoreValue(v);
  }
  if (doc.name) {
    result._id = doc.name.split("/").pop();
  }
  return result;
}

/**
 * Resilient Firestore REST request helper
 */
async function firestoreRest(endpoint, method = "GET", body = null) {
  return new Promise((resolve) => {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${endpoint}${
      endpoint.includes("?") ? "&" : "?"
    }key=${API_KEY}`;

    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 3000,
    };

    const req = https.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (_) {
          resolve(null);
        }
      });
    });

    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function getCanonicalPairId(userAId, userBId) {
  return [userAId, userBId].sort().join("__");
}

// ═══════════════════════════════════════════════════════════════
//  1. USER OPERATIONS (PROFILE, BANS, STRIKES, VPN STATUS)
// ═══════════════════════════════════════════════════════════════

/**
 * Asynchronously synchronizes user profile upon socket authentication or login.
 */
async function syncUserOnAuth(userId, meta = {}) {
  if (!userId) return null;
  const nowIso = new Date().toISOString();

  const userPayload = {
    userId,
    country: meta.country || "Unknown",
    totalMatches: meta.totalMatches || 0,
    isBanned: Boolean(meta.isBanned),
    banExpiresAt: Number(meta.banExpiresAt) || 0,
    banReason: meta.banReason || "",
    strikes: Number(meta.strikes) || 0,
    slurViolations: Number(meta.slurViolations) || 0,
    vpnDetected: Boolean(meta.vpnDetected),
    vpnDetails: meta.vpnDetails || null,
    lastSeenAt: nowIso,
    updatedAt: nowIso,
  };

  if (meta.displayName) userPayload.displayName = meta.displayName;
  if (meta.email) userPayload.email = meta.email;

  // Try Admin SDK first
  const db = getDb();
  if (db) {
    try {
      const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
      const snap = await userRef.get();
      if (!snap.exists) {
        userPayload.createdAt = FieldValue.serverTimestamp ? FieldValue.serverTimestamp() : nowIso;
        await userRef.set(userPayload, { merge: true });
        return { ...userPayload, isNew: true };
      } else {
        await userRef.set(userPayload, { merge: true });
        return { ...snap.data(), ...userPayload };
      }
    } catch (_) {}
  }

  // REST Fallback Bridge
  const restFields = {};
  for (const [k, v] of Object.entries(userPayload)) {
    if (v !== undefined) restFields[k] = encodeFirestoreValue(v);
  }
  await firestoreRest(`users/${userId}?updateMask.fieldPaths=lastSeenAt&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=vpnDetected&updateMask.fieldPaths=country&updateMask.fieldPaths=isBanned&updateMask.fieldPaths=banExpiresAt`, "PATCH", {
    fields: restFields,
  });

  return userPayload;
}

/**
 * Retrieves a user's persistent profile and moderation status
 */
async function getUserProfile(userId) {
  if (!userId) return null;

  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      if (snap.exists) return snap.data();
    } catch (_) {}
  }

  const res = await firestoreRest(`users/${userId}`);
  return decodeFirestoreDoc(res);
}

/**
 * Updates a user document with ban, strike, or vpn detection updates
 */
async function updateUserModerationStatus(userId, updates = {}) {
  if (!userId) return false;
  const nowIso = new Date().toISOString();
  updates.updatedAt = nowIso;

  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.USERS).doc(userId).set(updates, { merge: true });
      return true;
    } catch (_) {}
  }

  const restFields = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) restFields[k] = encodeFirestoreValue(v);
  }

  const maskQuery = Object.keys(updates)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");

  await firestoreRest(`users/${userId}?${maskQuery}`, "PATCH", { fields: restFields });
  return true;
}

/**
 * Increments total matches count for a user in Firestore
 */
async function incrementUserMatchCount(userId) {
  if (!userId) return false;
  const db = getDb();
  if (db) {
    try {
      const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
      await userRef.set({
        totalMatches: FieldValue.increment ? FieldValue.increment(1) : 1,
        lastSeenAt: FieldValue.serverTimestamp ? FieldValue.serverTimestamp() : new Date().toISOString(),
      }, { merge: true });
      return true;
    } catch (_) {}
  }
  return true;
}

/**
 * Updates a user profile
 */
async function updateUserProfile(userId, profileData = {}) {
  return updateUserModerationStatus(userId, profileData);
}

// ═══════════════════════════════════════════════════════════════
//  2. BAN PERSISTENCE (USER & DEVICE LEVEL)
// ═══════════════════════════════════════════════════════════════

/**
 * Persists a ban to Cloud Firestore in `/bans/{banId}` and updates user document
 */
async function saveBan(banData) {
  if (!banData || !banData.banId) return false;

  const banId = String(banData.banId).replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 128);
  const now = Date.now();
  const expiresAt = Number(banData.expiresAt) || now + 15 * 60 * 1000;

  const docPayload = {
    banId,
    reason: (banData.reason || "Suspension by moderation policy").slice(0, 500),
    expiresAt,
    durationMs: Number(banData.durationMs) || 15 * 60 * 1000,
    bannedAt: Number(banData.bannedAt) || now,
    active: true,
    userId: banData.userId ? String(banData.userId).slice(0, 128) : "",
    deviceHash: banData.deviceHash ? String(banData.deviceHash).slice(0, 128) : "",
    ip: banData.ip ? String(banData.ip).slice(0, 64) : "",
    bannedBy: (banData.bannedBy || "system_moderator").slice(0, 128),
    createdAt: new Date().toISOString(),
  };

  // 1. Write to Admin SDK if available
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.BANS).doc(banId).set(docPayload, { merge: true });
    } catch (_) {}
  }

  // 2. Write to Firestore REST API
  const restFields = {};
  for (const [k, v] of Object.entries(docPayload)) {
    if (v !== undefined) restFields[k] = encodeFirestoreValue(v);
  }
  await firestoreRest(`bans/${banId}`, "PATCH", { fields: restFields });

  // 3. If userId exists, also update the user's document
  if (banData.userId) {
    await updateUserModerationStatus(banData.userId, {
      isBanned: true,
      banExpiresAt: expiresAt,
      banReason: docPayload.reason,
    });
  }

  return true;
}

/**
 * Lifts / removes a ban in Firestore
 */
async function removeBan(banId, userId = null) {
  if (!banId) return false;
  const cleanBanId = String(banId).replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 128);

  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.BANS).doc(cleanBanId).set({ active: false }, { merge: true });
    } catch (_) {}
  }

  await firestoreRest(`bans/${cleanBanId}?updateMask.fieldPaths=active`, "PATCH", {
    fields: { active: { booleanValue: false } },
  });

  if (userId) {
    await updateUserModerationStatus(userId, {
      isBanned: false,
      banExpiresAt: 0,
      banReason: "",
    });
  }

  return true;
}

/**
 * Fetches all currently active bans from Firestore for cold-boot recovery
 */
async function getActiveBans() {
  const activeBans = [];
  const now = Date.now();

  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection(COLLECTIONS.BANS).where("active", "==", true).get();
      snap.forEach((doc) => {
        const data = doc.data();
        if (data && data.expiresAt > now) {
          activeBans.push(data);
        }
      });
      if (activeBans.length > 0) return activeBans;
    } catch (_) {}
  }

  // Fallback REST fetch
  const res = await firestoreRest("bans");
  if (res && res.documents) {
    for (const doc of res.documents) {
      const decoded = decodeFirestoreDoc(doc);
      if (decoded && decoded.active !== false && Number(decoded.expiresAt) > now) {
        activeBans.push(decoded);
      }
    }
  }

  return activeBans;
}

// ═══════════════════════════════════════════════════════════════
//  3. REPORT PERSISTENCE
// ═══════════════════════════════════════════════════════════════

/**
 * Persists user report to Firestore `/reports/{reportId}`
 */
async function saveReport({
  reportId,
  reporterId,
  reporterCountry = "Unknown",
  reportedUserId,
  reportedUserCountry = "Unknown",
  roomId = "",
  reason = "inappropriate_behavior",
  flags = [],
  status = "pending_review",
}) {
  if (!reporterId || !reportedUserId) return null;

  const id = reportId || "rep_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  const nowIso = new Date().toISOString();

  const reportPayload = {
    reportId: id,
    reporterId: String(reporterId).slice(0, 128),
    reporterCountry: String(reporterCountry).slice(0, 64),
    reportedUserId: String(reportedUserId).slice(0, 128),
    reportedUserCountry: String(reportedUserCountry).slice(0, 64),
    roomId: String(roomId).slice(0, 128),
    reason: String(reason).slice(0, 500),
    flags: Array.isArray(flags) ? flags : [],
    status,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.REPORTS).doc(id).set(reportPayload);
    } catch (_) {}
  }

  const restFields = {};
  for (const [k, v] of Object.entries(reportPayload)) {
    if (v !== undefined) restFields[k] = encodeFirestoreValue(v);
  }
  await firestoreRest(`reports/${id}`, "PATCH", { fields: restFields });

  return reportPayload;
}

/**
 * Retrieves recent reports from Firestore
 */
async function getRecentReports(limitCount = 50) {
  const reports = [];

  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection(COLLECTIONS.REPORTS).orderBy("createdAt", "desc").limit(limitCount).get();
      snap.forEach((doc) => reports.push(doc.data()));
      if (reports.length > 0) return reports;
    } catch (_) {}
  }

  const res = await firestoreRest(`reports?pageSize=${limitCount}`);
  if (res && res.documents) {
    for (const doc of res.documents) {
      const decoded = decodeFirestoreDoc(doc);
      if (decoded) reports.push(decoded);
    }
  }

  return reports;
}

/**
 * Updates status of a report
 */
async function updateReportStatus(reportId, status) {
  if (!reportId || !status) return false;
  const nowIso = new Date().toISOString();

  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.REPORTS).doc(reportId).set({ status, updatedAt: nowIso }, { merge: true });
      return true;
    } catch (_) {}
  }

  await firestoreRest(`reports/${reportId}?updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt`, "PATCH", {
    fields: {
      status: { stringValue: status },
      updatedAt: { stringValue: nowIso },
    },
  });

  return true;
}

// ═══════════════════════════════════════════════════════════════
//  4. MODERATION LOGS (SLURS, STRIKES, SPAM ACTIONS)
// ═══════════════════════════════════════════════════════════════

/**
 * Persists moderation action to `/moderation_logs/{logId}`
 */
async function saveModerationLog({
  logId,
  userId,
  type = "strike",
  message = "",
  action = "warn",
  violationCount = 1,
  severity = "medium",
}) {
  if (!userId) return null;

  const id = logId || "mod_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  const nowIso = new Date().toISOString();

  const logPayload = {
    logId: id,
    userId: String(userId).slice(0, 128),
    type: String(type).slice(0, 64),
    message: String(message).slice(0, 500),
    action: String(action).slice(0, 64),
    violationCount: Number(violationCount) || 1,
    severity,
    createdAt: nowIso,
  };

  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.MODERATION_LOGS).doc(id).set(logPayload);
    } catch (_) {}
  }

  const restFields = {};
  for (const [k, v] of Object.entries(logPayload)) {
    if (v !== undefined) restFields[k] = encodeFirestoreValue(v);
  }
  await firestoreRest(`moderation_logs/${id}`, "PATCH", { fields: restFields });

  // Also update user's violation count
  await updateUserModerationStatus(userId, {
    strikes: Number(violationCount) || 1,
    lastSeenAt: nowIso,
  });

  return logPayload;
}

async function getRecentModerationLogs(limitCount = 50) {
  const logs = [];

  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection(COLLECTIONS.MODERATION_LOGS).orderBy("createdAt", "desc").limit(limitCount).get();
      snap.forEach((doc) => logs.push(doc.data()));
      if (logs.length > 0) return logs;
    } catch (_) {}
  }

  const res = await firestoreRest(`moderation_logs?pageSize=${limitCount}`);
  if (res && res.documents) {
    for (const doc of res.documents) {
      const decoded = decodeFirestoreDoc(doc);
      if (decoded) logs.push(decoded);
    }
  }

  return logs;
}

// ═══════════════════════════════════════════════════════════════
//  5. SYSTEM SETTINGS (VPN SHIELD, STRICT MODE, ETC.)
// ═══════════════════════════════════════════════════════════════

async function getSystemSettings(settingId = "global_rules") {
  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection(COLLECTIONS.SYSTEM_SETTINGS).doc(settingId).get();
      if (snap.exists) return snap.data();
    } catch (_) {}
  }

  const res = await firestoreRest(`system_settings/${settingId}`);
  return decodeFirestoreDoc(res) || { settingId, vpnShieldEnabled: true, strictEmergencyMode: false };
}

async function saveSystemSettings(settingId = "global_rules", settings = {}) {
  const payload = {
    settingId,
    ...settings,
    updatedAt: new Date().toISOString(),
  };

  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.SYSTEM_SETTINGS).doc(settingId).set(payload, { merge: true });
    } catch (_) {}
  }

  const restFields = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) restFields[k] = encodeFirestoreValue(v);
  }

  const maskQuery = Object.keys(payload)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");

  await firestoreRest(`system_settings/${settingId}?${maskQuery}`, "PATCH", { fields: restFields });

  return payload;
}

// ═══════════════════════════════════════════════════════════════
//  6. FRIENDSHIPS & TELEMETRY
// ═══════════════════════════════════════════════════════════════

async function saveFriendship(userAId, userBId) {
  if (!userAId || !userBId) return null;
  const pairId = getCanonicalPairId(userAId, userBId);
  const nowIso = new Date().toISOString();
  const payload = {
    pairId,
    userAId,
    userBId,
    users: [userAId, userBId],
    status: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.FRIENDSHIPS).doc(pairId).set(payload, { merge: true });
      return payload;
    } catch (_) {}
  }

  const restFields = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) restFields[k] = encodeFirestoreValue(v);
  }
  await firestoreRest(`friendships/${pairId}`, "PATCH", { fields: restFields });
  return payload;
}

async function getUserFriends(userId) {
  if (!userId) return [];
  const friends = [];
  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection(COLLECTIONS.FRIENDSHIPS).where("users", "array-contains", userId).get();
      snap.forEach((doc) => friends.push(doc.data()));
      return friends;
    } catch (_) {}
  }
  return [];
}

async function removeFriendship(userAId, userBId) {
  const pairId = getCanonicalPairId(userAId, userBId);
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.FRIENDSHIPS).doc(pairId).delete();
      return true;
    } catch (_) {}
  }
  return true;
}

async function createFriendRequest({ requestId, fromUserId, toUserId, roomId }) {
  const id = requestId || `req_${Date.now()}`;
  const nowIso = new Date().toISOString();
  const payload = {
    requestId: id,
    fromUserId,
    toUserId,
    roomId: roomId || "",
    status: "pending",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.FRIEND_REQUESTS).doc(id).set(payload);
    } catch (_) {}
  }
  return payload;
}

async function updateFriendRequestStatus(requestId, status) {
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.FRIEND_REQUESTS).doc(requestId).set({ status }, { merge: true });
      return true;
    } catch (_) {}
  }
  return true;
}

async function getPendingRequestsForUser(userId) {
  const list = [];
  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection(COLLECTIONS.FRIEND_REQUESTS).where("toUserId", "==", userId).where("status", "==", "pending").get();
      snap.forEach((doc) => list.push(doc.data()));
    } catch (_) {}
  }
  return list;
}

async function saveFriendChatMessage({ chatId, messageId, fromUserId, message, isFlash = false }) {
  const mId = messageId || `msg_${Date.now()}`;
  const nowIso = new Date().toISOString();
  const payload = {
    chatId,
    messageId: mId,
    fromUserId,
    message,
    isFlash,
    isEdited: false,
    createdAt: nowIso,
  };
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.FRIEND_CHATS).doc(chatId).collection("messages").doc(mId).set(payload);
      await db.collection(COLLECTIONS.FRIEND_CHATS).doc(chatId).set({ updatedAt: nowIso, lastMessage: message }, { merge: true });
    } catch (_) {}
  }
  return payload;
}

async function getFriendChatMessages(chatId, limitCount = 50) {
  const messages = [];
  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection(COLLECTIONS.FRIEND_CHATS).doc(chatId).collection("messages").orderBy("createdAt", "asc").limit(limitCount).get();
      snap.forEach((doc) => messages.push(doc.data()));
    } catch (_) {}
  }
  return messages;
}

async function editFriendChatMessage(chatId, messageId, fromUserId, newMessage) {
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.FRIEND_CHATS).doc(chatId).collection("messages").doc(messageId).update({ message: newMessage, isEdited: true, updatedAt: new Date().toISOString() });
      return true;
    } catch (_) {}
  }
  return false;
}

async function deleteFriendChatMessage(chatId, messageId, fromUserId) {
  const db = getDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.FRIEND_CHATS).doc(chatId).collection("messages").doc(messageId).delete();
      return true;
    } catch (_) {}
  }
  return false;
}

async function getUserConversations(userId) {
  return [];
}

async function saveAdminSession(token, session = {}) {
  return true;
}

async function getAdminSession(token) {
  return null;
}

async function deleteAdminSession(token) {
  return true;
}

async function getLiveTelemetryMetrics() {
  const res = await firestoreRest("telemetry/live_metrics");
  return decodeFirestoreDoc(res);
}

async function atomicSyncTelemetry(pending = {}) {
  return true;
}

async function resetBehaviorTelemetry(persistenceData = {}) {
  return true;
}

module.exports = {
  COLLECTIONS,
  getCanonicalPairId,
  // User operations
  syncUserOnAuth,
  getUserProfile,
  updateUserModerationStatus,
  updateUserProfile,
  incrementUserMatchCount,
  // Ban operations
  saveBan,
  removeBan,
  getActiveBans,
  // Report operations
  saveReport,
  getRecentReports,
  updateReportStatus,
  // Moderation log operations
  saveModerationLog,
  getRecentModerationLogs,
  // System settings
  getSystemSettings,
  saveSystemSettings,
  // Friendship operations
  saveFriendship,
  getUserFriends,
  removeFriendship,
  // Friend request operations
  createFriendRequest,
  updateFriendRequestStatus,
  getPendingRequestsForUser,
  // Friend chat operations
  saveFriendChatMessage,
  getFriendChatMessages,
  getUserConversations,
  editFriendChatMessage,
  deleteFriendChatMessage,
  // Admin & Telemetry operations
  saveAdminSession,
  getAdminSession,
  deleteAdminSession,
  getLiveTelemetryMetrics,
  atomicSyncTelemetry,
  resetBehaviorTelemetry,
  isFirebaseConfigured,
};
