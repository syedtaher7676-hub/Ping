/**
 * ─────────────────────────────────────────────────────────────
 * Firebase Admin SDK Configuration for Ping
 * ─────────────────────────────────────────────────────────────
 * Provides lazy, resilient initialization of Firebase Admin SDK
 * and Cloud Firestore with zero startup crash risk.
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const { initializeApp, getApps, getApp, cert, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth: getFirebaseAuth } = require("firebase-admin/auth");

let dbInstance = null;
let authInstance = null;
let isInitialized = false;
let initAttempted = false;

/**
 * Loads project config from firebase-applet-config.json if available
 * @returns {object|null}
 */
function loadAppletConfig() {
  try {
    const configPath = path.resolve(__dirname, "../../firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(content);
    }
  } catch {}
  return null;
}

/**
 * Normalizes private key formatting from environment variables
 * @param {string} key
 * @returns {string}
 */
function formatPrivateKey(key) {
  if (!key) return "";
  // Strip outer quotes if present
  let formatted = key.replace(/^["']|["']$/g, "");
  // Replace literal '\n' sequences with real line breaks
  return formatted.replace(/\\n/g, "\n");
}

/**
 * Initializes the Firebase Admin app with available credentials.
 * Supports:
 *  1. FIREBASE_SERVICE_ACCOUNT_KEY (JSON string or base64 JSON)
 *  2. Split env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *  3. Google Cloud ADC (Application Default Credentials) when available
 *  4. firebase-applet-config.json project binding
 *
 * @returns {import("firebase-admin/app").App | null}
 */
function initializeFirebase() {
  const existingApps = getApps();
  if (initAttempted) {
    return existingApps.length > 0 ? getApp() : null;
  }
  initAttempted = true;

  if (existingApps.length > 0) {
    isInitialized = true;
    return getApp();
  }

  const appletConfig = loadAppletConfig();

  try {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    const projectId = process.env.FIREBASE_PROJECT_ID || appletConfig?.projectId;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    let credential = null;

    if (rawServiceAccount) {
      let parsedAccount;
      try {
        parsedAccount = JSON.parse(rawServiceAccount);
      } catch {
        const decoded = Buffer.from(rawServiceAccount, "base64").toString("utf-8");
        parsedAccount = JSON.parse(decoded);
      }
      credential = cert(parsedAccount);
    } else if (projectId && clientEmail && privateKey) {
      credential = cert({
        projectId,
        clientEmail,
        privateKey: formatPrivateKey(privateKey),
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      credential = applicationDefault();
    }

    if (credential) {
      const appConfig = { credential };
      if (projectId) {
        appConfig.projectId = projectId;
      }
      const app = initializeApp(appConfig);
      isInitialized = true;
      console.log(`🔥 [Firebase] Admin SDK initialized successfully (Project: ${projectId || "default"}).`);
      return app;
    } else {
      console.log(
        "ℹ️ [Firebase] Running in in-memory state mode. Cloud Firestore sync active when service account key is configured."
      );
      return null;
    }
  } catch (error) {
    console.error("❌ [Firebase] Failed to initialize Firebase Admin SDK:", error.message);
    return null;
  }
}

/**
 * Returns the Firestore Database instance (lazily initialized)
 * @returns {import("firebase-admin/firestore").Firestore | null}
 */
function getDb() {
  if (!dbInstance) {
    const app = initializeFirebase();
    if (app) {
      const appletConfig = loadAppletConfig();
      // Optional custom database ID
      const databaseId = process.env.FIREBASE_DATABASE_ID || appletConfig?.firestoreDatabaseId;
      if (databaseId && databaseId !== "(default)") {
        try {
          dbInstance = getFirestore(app, databaseId);
        } catch {
          dbInstance = getFirestore(app);
        }
      } else {
        dbInstance = getFirestore(app);
      }
      // Configure ignoreUndefinedProperties for cleaner document writes
      try {
        dbInstance.settings({ ignoreUndefinedProperties: true });
      } catch {}
    }
  }
  return dbInstance;
}

/**
 * Returns the Firebase Auth instance
 * @returns {import("firebase-admin/auth").Auth | null}
 */
function getAuth() {
  if (!authInstance) {
    const app = initializeFirebase();
    if (app) {
      authInstance = getFirebaseAuth(app);
    }
  }
  return authInstance;
}

/**
 * Temporarily disables Firestore when remote permissions or credentials fail,
 * seamlessly routing state to in-memory / Redis without logging repeated errors.
 */
function disableDb() {
  dbInstance = null;
  isInitialized = false;
  initAttempted = true;
}

/**
 * Check if Firebase is successfully configured and active
 * @returns {boolean}
 */
function isFirebaseConfigured() {
  return isInitialized && getDb() !== null;
}

module.exports = {
  admin,
  getDb,
  getAuth,
  disableDb,
  isFirebaseConfigured,
  FieldValue,
  Timestamp,
};
