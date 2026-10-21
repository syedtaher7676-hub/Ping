/**
 * ─────────────────────────────────────────────────────────────
 * Firebase Client SDK for Ping (Modular v10.14.1 with Named Database)
 * ─────────────────────────────────────────────────────────────
 * Specifically connects to named Firestore database:
 * "ai-studio-ping-97f03824-bc8c-4fb8-b4e8-22aa46e3bdea"
 * in project "impressive-atlas-4ggh3".
 * 
 * Provides backwards-compatible window.firebase wrapper so that
 * client application code operates seamlessly without database
 * "not-found" errors.
 */

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const FALLBACK_CONFIG = {
  apiKey: "AIzaSyCoxk4oQMIeLenwtdmjZkW04Xr7XAmMqeY",
  authDomain: "impressive-atlas-4ggh3.firebaseapp.com",
  projectId: "impressive-atlas-4ggh3",
  storageBucket: "impressive-atlas-4ggh3.firebasestorage.app",
  messagingSenderId: "237904937112",
  appId: "1:237904937112:web:42917cae7c903634dc50ed",
  firestoreDatabaseId: "ai-studio-ping-97f03824-bc8c-4fb8-b4e8-22aa46e3bdea"
};

let app = null;
let auth = null;
let rawDb = null;

async function bootstrapFirebase() {
  let config = { ...FALLBACK_CONFIG };
  try {
    const res = await fetch("/api/firebase-config");
    if (res.ok) {
      const serverConfig = await res.json();
      if (serverConfig && serverConfig.apiKey) {
        config = { ...config, ...serverConfig };
      }
    }
  } catch (_) {
    // Keep fallback config
  }

  const databaseId = config.firestoreDatabaseId || "ai-studio-ping-97f03824-bc8c-4fb8-b4e8-22aa46e3bdea";

  try {
    app = getApps().length ? getApps()[0] : initializeApp(config);
    auth = getAuth(app);
    // Explicitly bind to the named Firestore database instance
    rawDb = getFirestore(app, databaseId);
    console.log(`🔥 [Firebase] Client successfully bound to Firestore database: "${databaseId}"`);
  } catch (initErr) {
    console.warn("⚠️ [Firebase] Initialization notice:", initErr);
  }

  // ── COMPATIBILITY QUERY WRAPPER BUILDER ──
  function makeQueryWrapper(currQuery) {
    return {
      where: (field, op, val) => makeQueryWrapper(query(currQuery, where(field, op, val))),
      orderBy: (field, dir) => makeQueryWrapper(query(currQuery, orderBy(field, dir || 'asc'))),
      limit: (n) => makeQueryWrapper(query(currQuery, limit(n))),
      get: async () => {
        try {
          return await getDocs(currQuery);
        } catch (qErr) {
          console.warn("Firestore query error:", qErr);
          return { empty: true, docs: [], forEach: () => {} };
        }
      }
    };
  }

  // ── COMPATIBILITY DOC REF BUILDER ──
  function createDocRef(collPath, docId) {
    const dRef = doc(rawDb, collPath, docId);
    return {
      id: docId,
      set: async (data, opts) => {
        try {
          return await setDoc(dRef, data, opts || {});
        } catch (setErr) {
          console.warn(`Firestore setDoc error at ${collPath}/${docId}:`, setErr);
          throw setErr;
        }
      },
      get: async () => {
        try {
          return await getDoc(dRef);
        } catch (getErr) {
          console.warn(`Firestore getDoc error at ${collPath}/${docId}:`, getErr);
          return { exists: () => false, data: () => null };
        }
      },
      collection: (subCollPath) => createCollectionRef(`${collPath}/${docId}/${subCollPath}`)
    };
  }

  // ── COMPATIBILITY COLLECTION REF BUILDER ──
  function createCollectionRef(collPath) {
    const baseCol = collection(rawDb, collPath);
    return {
      doc: (docId) => createDocRef(collPath, docId),
      where: (field, op, val) => makeQueryWrapper(query(baseCol, where(field, op, val))),
      orderBy: (field, dir) => makeQueryWrapper(query(baseCol, orderBy(field, dir || 'asc'))),
      limit: (n) => makeQueryWrapper(query(baseCol, limit(n))),
      get: async () => {
        try {
          return await getDocs(baseCol);
        } catch (getErr) {
          console.warn(`Firestore getDocs error at ${collPath}:`, getErr);
          return { empty: true, docs: [], forEach: () => {} };
        }
      }
    };
  }

  // ── AUTH COMPATIBILITY OBJECT ──
  let activePopupPromise = null;

  const authWrapper = {
    get currentUser() {
      return auth ? auth.currentUser : null;
    },
    onAuthStateChanged: (callback) => {
      if (!auth) return () => {};
      return onAuthStateChanged(auth, callback);
    },
    signInWithPopup: async (provider) => {
      if (!auth) throw new Error("Firebase Auth is not ready");
      if (activePopupPromise) {
        return activePopupPromise;
      }
      try {
        activePopupPromise = signInWithPopup(auth, provider);
        const result = await activePopupPromise;
        return result;
      } catch (popupErr) {
        console.warn("Firebase signInWithPopup caught:", popupErr?.message || popupErr);
        throw popupErr;
      } finally {
        activePopupPromise = null;
      }
    },
    signInWithEmailAndPassword: (email, password) => {
      if (!auth) throw new Error("Firebase Auth is not ready");
      return signInWithEmailAndPassword(auth, email, password);
    },
    createUserWithEmailAndPassword: (email, password) => {
      if (!auth) throw new Error("Firebase Auth is not ready");
      return createUserWithEmailAndPassword(auth, email, password);
    },
    signInAnonymously: () => {
      if (!auth) throw new Error("Firebase Auth is not ready");
      return signInAnonymously(auth);
    },
    signOut: () => {
      if (!auth) return Promise.resolve();
      return signOut(auth);
    }
  };

  // ── GLOBAL WINDOW.FIREBASE COMPATIBILITY LAYER ──
  const firebaseCompat = {
    apps: app ? [app] : [],
    initializeApp: () => app,
    auth: Object.assign(() => authWrapper, {
      GoogleAuthProvider
    }),
    firestore: Object.assign((_dbId) => ({
      collection: (col) => createCollectionRef(col)
    }), {
      FieldValue: {
        serverTimestamp: () => serverTimestamp()
      }
    })
  };

  window.firebase = firebaseCompat;
  window.rawFirebaseApp = app;
  window.rawFirebaseAuth = auth;
  window.rawFirestoreDb = rawDb;
  window.firebaseReady = true;

  window.dispatchEvent(new CustomEvent('firebase:ready', {
    detail: { app, auth, rawDb, databaseId }
  }));

  return { app, auth, rawDb, databaseId };
}

window.firebaseReadyPromise = bootstrapFirebase();
