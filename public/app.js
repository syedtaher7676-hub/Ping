/* ── Ping frontend — app.js ── */

// ── BACKEND URL ──────────────────────────────────────────────
const backendMeta = document.querySelector('meta[name="ping-backend-url"]');
const configuredBackendUrl = backendMeta?.getAttribute('content')?.trim();
const defaultBackendUrl =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : window.location.origin;
const backendUrl = configuredBackendUrl || defaultBackendUrl;

// ── PERSISTENT USER ID & DEVICE HASH ─────────────────────────
let persistentUserId = localStorage.getItem('ping_user_id');
if (!persistentUserId) {
  persistentUserId = 'u_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  localStorage.setItem('ping_user_id', persistentUserId);
}

let persistentDeviceHash = localStorage.getItem('ping_device_hash');
if (!persistentDeviceHash) {
  persistentDeviceHash = 'dh_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  localStorage.setItem('ping_device_hash', persistentDeviceHash);
}

// ── SOCKET ───────────────────────────────────────────────────
// Enforce singleton WebSocket connection across window scope to prevent multiple concurrent sockets
const socket = window.__PING_SOCKET__ || io(backendUrl, {
  transports: ['websocket'],
  upgrade: false,
  rememberUpgrade: true,
  timeout: 25000,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 4000,
  randomizationFactor: 0.3,
  auth: { userId: persistentUserId, deviceHash: persistentDeviceHash },
  autoConnect: true,
});
window.__PING_SOCKET__ = socket;
window.socket = socket;

// ── DOM REFS ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const startBtn = $('startBtn');
const nextBtn = $('nextBtn');
const reportSkipBtn = $('reportSkipBtn');
const chatBox = $('chatBox');
const messageForm = $('messageForm');
const messageInput = $('messageInput');
const sendBtn = $('sendBtn');
const timerEl = $('timerMeta');
const partnerNameEl = $('partnerCountryMeta');
const typingIndicator = $('partnerTypingMeta');
const extendTimeBtn = $('extendTimeBtn');
const friendBtn = $('friendBtn');
const reportBtn = $('reportBtn');
const endChatBtn = $('endChatBtn');
const confirmModal = $('confirmModal');
const confirmTitle = $('confirmTitle');
const confirmMessage = $('confirmMessage');
const confirmYes = $('confirmYes');
const confirmNo = $('confirmNo');
const landingPage = $('landingPage');
const chatApp = $('chatApp');
const startLandingBtn = $('startLandingBtn');
const backBtn = $('backBtn');
const liveUsersEl = $('liveUsers');           // landing counter
const headerActiveUsers = $('headerActiveUsers');   // prechat card counter
const preChatView = $('preChatView');
const activeChatView = $('activeChatView');
const waitingView = $('waitingView');
const connectionStatus = $('connectionStatus');
const cancelWaitBtn = $('cancelWaitBtn');
const toastContainer = $('toastContainer');
const headerOnlineCount = $('headerOnlineCount');   // header pill
const actionBarOnline = $('actionBarOnline');     // action bar online count
const pingBtn = $('pingBtn');
const flashToggleBtn = $('flashToggleBtn');
const friendPingBtn = $('friendPingBtn');
const friendFlashToggleBtn = $('friendFlashToggleBtn');

// Home tabs references
const homeTabs = $('homeTabs');
const tabRandom = $('tabRandom');
const tabSettings = $('tabSettings');
const tabFriends = $('tabFriends');
let activeHomeTab = 'random'; // 'random', 'settings', or 'friends'

// Settings view references
const settingsView = $('settingsView');
const chatTranscriptModal = $('chatTranscriptModal');

// Friends view references
const friendsView = $('friendsView');
const friendsList = $('friendsList');
const findChatBtn = $('findChatBtn');

// Friends DM view references
const friendDMView = $('friendDMView');
const friendDMNameMeta = $('friendDMNameMeta');
const friendChatBox = $('friendChatBox');
const friendTypingMeta = $('friendTypingMeta');
const friendMessageForm = $('friendMessageForm');
const friendMessageInput = $('friendMessageInput');
const friendSendBtn = $('friendSendBtn');
const friendEmojiBtn = $('friendEmojiBtn');
const friendEmojiPickerPopup = $('friendEmojiPickerPopup');
const friendFullEmojiPicker = $('friendFullEmojiPicker');
const backToFriendsBtn = $('backToFriendsBtn');
const friendReportBtn = $('friendReportBtn');
const invisibleToggle = $('invisibleToggle');
const endFriendDMBtn = $('endFriendDMBtn');
const friendCountryLabel = $('friendCountryLabel');
const friendStatusLabel = $('friendStatusLabel');
const friendPresenceDot = $('friendPresenceDot');
const autoSearchBar = $('autoSearchBar');
const autoSearchStatus = $('autoSearchStatus');
const autoSearchNowBtn = $('autoSearchNowBtn');
const networkStatusBar = $('networkStatusBar');
const networkStatusText = $('networkStatusText');
const reconnectNowBtn = $('reconnectNowBtn');
const partnerCountryLabel = $('partnerCountryLabel'); // Ensure this is also present
const homeAuthBtn = $('homeAuthBtn');
const exploreAuthBtn = $('exploreAuthBtn');
const landingAuthBtn = $('landingAuthBtn');

// ── APPSTATE CONTROLLER ──────────────────────────────────────
const AppState = {
  activeTab: 'EXPLORE', // 'EXPLORE' | 'FRIENDS'
  explore: { 
    roomId: null, 
    partnerId: null, 
    partnerCountry: null,
    inChat: false, 
    isWaiting: false, 
    timerEndMs: 0,
    history: [] // Client-side message deduplication buffer
  },
  friends: { 
    activeFriendId: null, 
    activeRoomId: null, 
    inChat: false, 
    history: [] // Client-side message deduplication buffer
  },
  user: {
    id: persistentUserId,
    isAuthenticated: false, // Tracks guest vs authenticated status
    country: null,
    profile: null
  },
  deferredFriendRequest: false
};

// Map old global variables to AppState via window properties for backwards compatibility
Object.defineProperty(window, 'selfUserId', {
  get() { return AppState.user.id; },
  set(val) { AppState.user.id = val; }
});

Object.defineProperty(window, 'currentChatType', {
  get() { return AppState.activeTab === 'EXPLORE' ? 'stranger' : 'friend'; },
  set(val) {
    if (val === 'stranger') AppState.activeTab = 'EXPLORE';
    else if (val === 'friend') AppState.activeTab = 'FRIENDS';
  }
});

Object.defineProperty(window, 'inChat', {
  get() { return AppState.activeTab === 'EXPLORE' ? AppState.explore.inChat : AppState.friends.inChat; },
  set(val) {
    if (AppState.activeTab === 'EXPLORE') AppState.explore.inChat = val;
    else AppState.friends.inChat = val;
  }
});

Object.defineProperty(window, 'isWaiting', {
  get() { return AppState.activeTab === 'EXPLORE' ? AppState.explore.isWaiting : false; },
  set(val) {
    if (AppState.activeTab === 'EXPLORE') AppState.explore.isWaiting = val;
  }
});

Object.defineProperty(window, 'activeRoomId', {
  get() { return AppState.activeTab === 'EXPLORE' ? AppState.explore.roomId : AppState.friends.activeRoomId; },
  set(val) {
    if (AppState.activeTab === 'EXPLORE') AppState.explore.roomId = val;
    else AppState.friends.activeRoomId = val;
  }
});

Object.defineProperty(window, 'currentFriendId', {
  get() { return AppState.friends.activeFriendId; },
  set(val) { AppState.friends.activeFriendId = val; }
});

Object.defineProperty(window, 'friendRoomId', {
  get() { return AppState.friends.activeRoomId; },
  set(val) { AppState.friends.activeRoomId = val; }
});

let isConnected = false;
let isReconnecting = false;  // Track reconnection state
let typingTimeout = null;
let confirmCb = null;
let hasErrShown = false;
let pendingStart = false;
let lastKnownRoomId = null;    // Store room ID during disconnect
let isFlashMode = false;       // Track active Flash mode state for stranger chat
let isFriendFlashMode = false; // Track active Flash mode state for friend DM

// ── BOOT UI & STATE RESET ────────────────────────────────────
// Force complete UI state reset on application boot / page load
AppState.explore.roomId = null;
AppState.explore.timerEndMs = 0;
AppState.friends.activeRoomId = null;
AppState.friends.activeFriendId = null;
AppState.activeTab = 'EXPLORE';
AppState.explore.inChat = false;
AppState.explore.isWaiting = false;
isReconnecting = false;
pendingStart = false;

// ── FIREBASE CLIENT INITIALIZATION ───────────────────────────
let authInstance = null;
let dbInstance = null;

async function applyUserSession(userProfile, isCloudFallback = false) {
  if (!userProfile) return;
  const uid = userProfile.uid || ('usr_' + Date.now().toString(36));
  const email = userProfile.email || '';
  const displayName = userProfile.displayName || (email ? email.split('@')[0] : 'Ping User');

  console.log("Applying User Session:", uid, email, displayName);
  AppState.user.id = uid;
  AppState.user.isAuthenticated = true;
  AppState.user.profile = {
    uid,
    email,
    displayName,
    isAnonymous: userProfile.isAnonymous || false
  };

  try {
    localStorage.setItem('ping_persistent_uid', uid);
    localStorage.setItem('ping_user_id', uid);
    if (email) localStorage.setItem('ping_user_email', email);
    localStorage.setItem('ping_is_auth', 'true');
    localStorage.setItem('ping_displayName', displayName);
  } catch (_) {}

  // Manage dynamic UI buttons
  const eAuth = document.getElementById('exploreAuthBtn');
  if (eAuth) eAuth.style.display = 'none';

  const hAuth = document.getElementById('homeAuthBtn');
  if (hAuth) {
    hAuth.innerHTML = `<span>👤 Profile</span>`;
    hAuth.title = `Signed in as ${displayName}`;
  }

  const lAuth = document.getElementById('landingAuthBtn');
  if (lAuth) {
    lAuth.innerHTML = `<span class="cta-label">👤 Profile</span>`;
    lAuth.title = `Signed in as ${displayName}`;
  }

  // Synchronize user profile in Firestore
  try {
    if (dbInstance) {
      const userRef = dbInstance.collection('users').doc(uid);
      await userRef.set({
        userId: uid,
        country: AppState.user.country || 'Global',
        displayName: displayName,
        email: email,
        lastSeenAt: firebase?.firestore?.FieldValue?.serverTimestamp ? firebase.firestore.FieldValue.serverTimestamp() : new Date(),
        updatedAt: firebase?.firestore?.FieldValue?.serverTimestamp ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
      }, { merge: true });
    }
  } catch (dbErr) {
    console.warn("Firestore user sync notice:", dbErr);
  }

  // Authenticate socket session
  socket.emit('authenticate', { 
    userId: uid,
    oldUserId: persistentUserId,
    activeFriendId: currentFriendId,
    email: email,
    displayName: displayName
  }, (ack) => {
    if (ack && ack.success) {
      console.log("Socket successfully authenticated with user:", uid);
    }
  });

  // Persist active friendship in Firestore if present
  if (currentFriendId && dbInstance) {
    try {
      const pairId = [uid, currentFriendId].sort().join('__');
      await dbInstance.collection('friendships').doc(pairId).set({
        userAId: [uid, currentFriendId].sort()[0],
        userBId: [uid, currentFriendId].sort()[1],
        users: [uid, currentFriendId],
        createdAt: firebase?.firestore?.FieldValue?.serverTimestamp ? firebase.firestore.FieldValue.serverTimestamp() : new Date(),
        updatedAt: firebase?.firestore?.FieldValue?.serverTimestamp ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
      }, { merge: true });
    } catch (_) {}
  }

  if (AppState.deferredFriendRequest) {
    AppState.deferredFriendRequest = false;
    showToast("Signed in! Sending friend request now... 👫", "success", 2000);
    socket.emit('send_friend_request');
  }

  const banner = document.getElementById('softAuthBanner');
  if (banner) banner.remove();
  closeModal();

  updateSettingsUI();
}

async function initFirebaseClient() {
  if (window.firebaseReadyPromise) {
    try {
      await window.firebaseReadyPromise;
    } catch (_) {}
  } else if (typeof firebase === 'undefined') {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2500);
      window.addEventListener('firebase:ready', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  if (typeof firebase === 'undefined') {
    console.log("Firebase module is not ready, running in Guest Mode.");
    return;
  }

  try {
    authInstance = firebase.auth();
    dbInstance = firebase.firestore("ai-studio-ping-97f03824-bc8c-4fb8-b4e8-22aa46e3bdea");

    authInstance.onAuthStateChanged(async (user) => {
      if (user) {
        await applyUserSession(user);
        showToast(`Logged in as ${user.displayName || user.email?.split('@')[0] || 'Ping User'}! ✨`, 'success', 3000);
      } else {
        // Only clear state if not logged in via local cloud session
        const isLocallyAuth = localStorage.getItem('ping_is_auth') === 'true';
        const savedEmail = localStorage.getItem('ping_user_email');
        const savedUid = localStorage.getItem('ping_persistent_uid');
        if (isLocallyAuth && savedEmail && savedUid && savedUid.startsWith('usr_')) {
          await applyUserSession({
            uid: savedUid,
            email: savedEmail,
            displayName: localStorage.getItem('ping_displayName') || savedEmail.split('@')[0]
          }, true);
          return;
        }

        AppState.user.isAuthenticated = false;
        AppState.user.id = persistentUserId;
        AppState.user.profile = null;

        const eAuth = document.getElementById('exploreAuthBtn');
        if (eAuth && currentChatType === 'stranger' && inChat) {
          eAuth.style.display = 'block';
        } else if (eAuth) {
          eAuth.style.display = 'none';
        }

        const hAuth = document.getElementById('homeAuthBtn');
        if (hAuth) {
          hAuth.innerHTML = `<span>🔑 Sign In</span>`;
          hAuth.title = "Sign in to persist your connections";
        }

        const lAuth = document.getElementById('landingAuthBtn');
        if (lAuth) {
          lAuth.innerHTML = `<span class="cta-label">🔑 Account</span>`;
          lAuth.title = "Sign in to persist your connections";
        }

        updateSettingsUI();
      }
    });
  } catch (err) {
    console.warn("Client-side Firebase failed to initialize:", err);
  }
}

// Auto bootstrap Firebase on startup and on ready event
initFirebaseClient();
window.addEventListener('firebase:ready', () => {
  initFirebaseClient();
});

let isGoogleLoginPending = false;
async function triggerGoogleLogin() {
  if (isGoogleLoginPending) return;
  isGoogleLoginPending = true;

  if (window.firebaseReadyPromise) {
    try { await window.firebaseReadyPromise; } catch (_) {}
  }
  if (!authInstance && typeof firebase !== 'undefined' && firebase.auth) {
    try { authInstance = firebase.auth(); } catch (_) {}
  }
  if (typeof firebase === 'undefined' || !authInstance) {
    isGoogleLoginPending = false;
    showToast("Ping Cloud is initializing, please try again in a moment.", "warn", 2500);
    return;
  }
  
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    showToast("Opening Google Sign-in...", "info", 1500);
    const result = await authInstance.signInWithPopup(provider);
    if (result && result.user) {
      await applyUserSession(result.user);
      showToast(`Welcome ${result.user.displayName || 'to Ping'}! ✨`, 'success', 3000);
    }
  } catch (err) {
    console.warn("Google sign-in exception caught:", err);
    const code = err?.code || '';
    const msg = (err?.message || '').toLowerCase();
    if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request' || msg.includes('popup') || msg.includes('assertion failed')) {
      showToast("⚠️ Browser blocked Google popup. Please allow popups for this site and try again.", "warn", 4000);
    } else if (code !== 'auth/popup-closed-by-user') {
      showToast(err?.message || "Sign-in could not be completed. Please try again.", "error", 4000);
    }
  } finally {
    isGoogleLoginPending = false;
  }
}

// ── SINGLETON AUDIO CONTEXT (PREVENTS MEMORY & HARDWARE LEAKS) ──
let sharedAudioCtx = null;
function getSharedAudioContext() {
  if (!sharedAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
  }
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str || '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatChatTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  const d = new Date(Number(ts));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function updateSettingsUI() {
  const isAuth = AppState.user.isAuthenticated;
  const guestSection = document.getElementById('settingsGuestAuthSection');
  const userSection = document.getElementById('settingsUserAuthSection');
  const authBadge = document.getElementById('settingsAuthBadge');
  const statusText = document.getElementById('settingsCloudStatusText');

  if (statusText) {
    statusText.textContent = isAuth ? 'Ping Synced' : 'Ping Connected';
  }

  if (isAuth) {
    if (authBadge) {
      authBadge.textContent = '⚡ Ping Synced';
      authBadge.className = 'sc-badge auth';
    }
    if (guestSection) guestSection.style.display = 'none';
    if (userSection) userSection.style.display = 'flex';

    // Populate user profile info
    const user = authInstance?.currentUser || AppState.user.profile || {};
    const dName = user.displayName || user.email?.split('@')[0] || 'Ping User';
    const email = user.email || (user.isAnonymous ? 'Demo Guest Account' : 'Cloud Account');
    const uid = AppState.user.id || user.uid || 'Anonymous';

    const nameEl = document.getElementById('settingsUserDisplayName');
    const emailEl = document.getElementById('settingsUserEmailText');
    const uidEl = document.getElementById('settingsUserUid');
    const avatarEl = document.getElementById('settingsUserAvatar');

    if (nameEl) nameEl.textContent = dName;
    if (emailEl) emailEl.textContent = email;
    if (uidEl) uidEl.textContent = `UID: ${uid.slice(0, 10)}…`;
    if (avatarEl) avatarEl.textContent = (dName && dName[0] ? dName[0].toUpperCase() : '👤');
  } else {
    if (authBadge) {
      authBadge.textContent = 'Guest Mode';
      authBadge.className = 'sc-badge guest';
    }
    if (guestSection) guestSection.style.display = 'flex';
    if (userSection) userSection.style.display = 'none';
  }
}

function initSettingsTab() {
  // Google sign in
  document.getElementById('settingsGoogleLoginBtn')?.addEventListener('click', () => {
    triggerGoogleLogin();
  });

  const customUsernameInput = document.getElementById('customUsernameInput');
  const saveUsernameBtn = document.getElementById('saveUsernameBtn');
  if (customUsernameInput) {
    customUsernameInput.value = localStorage.getItem('ping_custom_username') || '';
  }
  if (saveUsernameBtn) {
    saveUsernameBtn.addEventListener('click', () => {
      const uname = customUsernameInput ? customUsernameInput.value.trim() : '';
      if (!uname) {
        showToast('Please enter a username', 'warn', 2000);
        return;
      }
      localStorage.setItem('ping_custom_username', uname);
      socket.emit('update_username', { username: uname }, (ack) => {
        if (ack && ack.ok) {
          showToast(`Username saved as "${uname}"! ✨`, 'success', 2500);
        } else {
          showToast('Failed to save username', 'error', 2000);
        }
      });
    });
  }

  // Experience & Preference Toggles
  const soundToggle = document.getElementById('prefSoundToggle');
  const hapticToggle = document.getElementById('prefHapticToggle');
  const autoScrollToggle = document.getElementById('prefAutoScrollToggle');
  const typingToggle = document.getElementById('prefTypingToggle');

  if (soundToggle) {
    soundToggle.checked = localStorage.getItem('ping_pref_sound') !== 'false';
    soundToggle.addEventListener('change', (e) => {
      localStorage.setItem('ping_pref_sound', e.target.checked);
      showToast(e.target.checked ? '🔊 Sound alerts enabled' : '🔇 Sound alerts muted', 'info', 1500);
    });
  }

  if (hapticToggle) {
    hapticToggle.checked = localStorage.getItem('ping_pref_haptic') !== 'false';
    hapticToggle.addEventListener('change', (e) => {
      localStorage.setItem('ping_pref_haptic', e.target.checked);
      if (e.target.checked && navigator.vibrate) navigator.vibrate(30);
      showToast(e.target.checked ? '📳 Haptics enabled' : '📴 Haptics disabled', 'info', 1500);
    });
  }

  if (autoScrollToggle) {
    autoScrollToggle.checked = localStorage.getItem('ping_pref_autoscroll') !== 'false';
    autoScrollToggle.addEventListener('change', (e) => {
      localStorage.setItem('ping_pref_autoscroll', e.target.checked);
      showToast(e.target.checked ? '⬇️ Auto-scroll active' : '⏸️ Auto-scroll disabled', 'info', 1500);
    });
  }

  if (typingToggle) {
    typingToggle.checked = localStorage.getItem('ping_pref_typing') !== 'false';
    typingToggle.addEventListener('change', (e) => {
      localStorage.setItem('ping_pref_typing', e.target.checked);
      showToast(e.target.checked ? '✍️ Typing indicators visible' : '🙈 Typing indicators hidden', 'info', 1500);
    });
  }

  // Logout button
  document.getElementById('settingsLogoutBtn')?.addEventListener('click', () => {
    showConfirm('Log Out?', 'Would you like to log out of your Google account?', async () => {
      try {
        if (authInstance) {
          try { await authInstance.signOut(); } catch (_) {}
        }
        const freshGuestId = 'guest_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
        try {
          localStorage.setItem('ping_persistent_uid', freshGuestId);
          localStorage.setItem('ping_user_id', freshGuestId);
          localStorage.removeItem('ping_user_email');
          localStorage.removeItem('ping_is_auth');
          localStorage.removeItem('ping_displayName');
          localStorage.removeItem('ping_active_friend_id');
        } catch (_) {}

        persistentUserId = freshGuestId;
        AppState.user.isAuthenticated = false;
        AppState.user.id = freshGuestId;
        AppState.user.profile = null;

        socket.emit('logout_user', { newGuestId: freshGuestId });

        const eAuth = document.getElementById('exploreAuthBtn');
        if (eAuth && currentChatType === 'stranger' && inChat) {
          eAuth.style.display = 'block';
        } else if (eAuth) {
          eAuth.style.display = 'none';
        }

        const hAuth = document.getElementById('homeAuthBtn');
        if (hAuth) {
          hAuth.innerHTML = `<span>🔑 Sign In</span>`;
          hAuth.title = "Sign in to persist your connections";
        }

        const lAuth = document.getElementById('landingAuthBtn');
        if (lAuth) {
          lAuth.innerHTML = `<span class="cta-label">🔑 Account</span>`;
          lAuth.title = "Sign in to persist your connections";
        }

        showToast('Logged out of Ping. Returned to Guest Mode.', 'info', 3000);
        updateSettingsUI();
      } catch (err) {
        console.error('Logout error:', err);
        showToast('Logout error: ' + (err.message || 'Unknown error'), 'error', 3000);
      }
    });
  });
}

// Initialize settings handlers & preferences
initSettingsTab();

function showInChatAuthModal(onDismiss = null) {
  // Disabled: No login popups during anonymous chat
  if (typeof onDismiss === 'function') onDismiss();
}

function showFirebaseConnectModal(options = {}) {
  // Always remove any existing modals to prevent stacking / double popups
  document.querySelectorAll('.glass-modal-overlay').forEach(m => m.remove());

  const isAlreadyAuth = AppState.user.isAuthenticated;
  const friendLabel = options.friendCountry || 'your connection';

  if (isAlreadyAuth) {
    showToast(`✨ Friends list saved in Ping Cloud! (${friendLabel})`, 'success', 3000);
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'firebaseConnectModal';
  modal.className = 'glass-modal-overlay';
  modal.innerHTML = `
    <div class="glass-modal-card">
      <div class="gmc-icon">⚡</div>
      <div class="gmc-badge" style="color:#a78bfa;background:rgba(124,58,237,0.15);border-color:rgba(124,58,237,0.35);">⚡ Save Friends List</div>
      <h3>Save Your Friends List in Ping</h3>
      <p>Friend request connected! Log into Ping with Google now to keep your friends list synced across all your devices.</p>
      <div class="gmc-actions">
        <button id="fcGoogleBtn" class="btn-primary" type="button" style="background:linear-gradient(135deg,#8b5cf6,#ec4899);font-weight:600;">
          <svg width="18" height="18" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:8px;"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.8s.2-2.1.4-2.8L1.9 6.3C.7 8.7 0 10.3 0 12s.7 3.3 1.9 5.7l3.7-2.9z"/><path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16c1.8 3.7 5.6 7 10.1 7z"/></svg>
          Continue with Google
        </button>
        <button id="fcDismissBtn" class="btn-ghost" type="button" style="color:#94a3b8;">
          Continue As Guest
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const dismissBtn = document.getElementById('fcDismissBtn');
  if (dismissBtn) {
    dismissBtn.onclick = () => {
      if (navigator.vibrate) navigator.vibrate(10);
      modal.remove();
      showToast('Continuing as guest.', 'info', 2000);
    };
  }

  const googleBtn = document.getElementById('fcGoogleBtn');
  if (googleBtn) {
    googleBtn.onclick = async () => {
      if (navigator.vibrate) navigator.vibrate(20);
      modal.remove();
      triggerGoogleLogin();
    };
  }

  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  };
}
window.showPostFriendAuthModal = showFirebaseConnectModal;
window.showFirebaseConnectModal = showFirebaseConnectModal;

function formatPartnerLocation(countryString) {
  if (!countryString || countryString === 'Unknown' || countryString === 'Someone nearby') {
    return '🇮🇳 India (Karnataka)';
  }
  // If the string already contains state info, return formatted; else append state context if available
  if (countryString.includes('(') && countryString.includes(')')) {
    return countryString;
  }
  if (countryString.includes('India')) {
    const flag = countryString.includes('🇮🇳') ? '' : '🇮🇳 ';
    return `${flag}${countryString} (Karnataka)`.trim();
  }
  if (countryString.includes('United States') || countryString.includes('USA')) {
    const flag = countryString.includes('🇺🇸') ? '' : '🇺🇸 ';
    return `${flag}${countryString} (California)`.trim();
  }
  if (countryString.includes('United Kingdom') || countryString.includes('UK')) {
    const flag = countryString.includes('🇬🇧') ? '' : '🇬🇧 ';
    return `${flag}${countryString} (London)`.trim();
  }
  if (countryString.includes('Canada')) {
    const flag = countryString.includes('🇨🇦') ? '' : '🇨🇦 ';
    return `${flag}${countryString} (Ontario)`.trim();
  }
  if (countryString.includes('Germany')) {
    const flag = countryString.includes('🇩🇪') ? '' : '🇩🇪 ';
    return `${flag}${countryString} (Berlin)`.trim();
  }
  if (countryString.includes('Australia')) {
    const flag = countryString.includes('🇦🇺') ? '' : '🇦🇺 ';
    return `${flag}${countryString} (New South Wales)`.trim();
  }
  return countryString;
}


function triggerSoftAuthBanner() {
  // Disabled: No login popups or banners during chat per lean MVP requirements
  return;
}

// Start Firebase client initialization
initFirebaseClient();

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initSettingsTab();
      document.querySelectorAll('#start-chat-btn, #startBtn, #startLandingBtn, #findChatBtn').forEach(btn => {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('disabled');
        }
      });
      if (confirmModal) confirmModal.style.display = 'none';
    });
  } else {
    initSettingsTab();
    document.querySelectorAll('#start-chat-btn, #startBtn, #startLandingBtn, #findChatBtn').forEach(btn => {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('disabled');
      }
    });
    if (confirmModal) confirmModal.style.display = 'none';
  }
}

socket.off('friend_status_change');
socket.on('friend_status_change', ({ friendId, online }) => {
  const item = document.querySelector(`.friend-item[data-friend-id="${friendId}"]`);
  if (!item) return;

  const dot = item.querySelector('.friend-status');
  const statusTxt = item.querySelector('.friend-status-text');

  if (dot) {
    dot.className = `friend-status ${online ? '' : 'offline'}`;
  }
  if (statusTxt) {
    statusTxt.className = `friend-status-text ${online ? '' : 'offline'}`;
    statusTxt.textContent = online ? '🟢 Online' : 'Offline';
  }
});

socket.off('message_edited');
socket.on('message_edited', ({ msgId, newMessage }) => {
  const el = chatBox.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  const textNode = el.querySelector('.msg-text');
  if (textNode) {
    textNode.textContent = newMessage;
    if (!textNode.querySelector('.msg-edited-tag')) {
      const tag = document.createElement('span');
      tag.className = 'msg-edited-tag';
      tag.textContent = '(edited)';
      textNode.appendChild(tag);
    }
  }
});

socket.off('message_deleted');
socket.on('message_deleted', ({ msgId }) => {
  const el = chatBox.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  el.classList.add('deleted');
  const textNode = el.querySelector('.msg-text');
  if (textNode) textNode.textContent = 'Message deleted 🗑️';
});

socket.off('dm_edited');
socket.on('dm_edited', ({ msgId, newMessage }) => {
  const el = friendChatBox.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  const textNode = el.querySelector('.msg-text');
  if (textNode) textNode.textContent = newMessage;
  if (!textNode.querySelector('.msg-edited-tag')) {
    const tag = document.createElement('span');
    tag.className = 'msg-edited-tag';
    tag.textContent = '(edited)';
    textNode.appendChild(tag);
  }
});

socket.off('dm_deleted');
socket.on('dm_deleted', ({ msgId }) => {
  const el = friendChatBox.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  el.classList.add('deleted');
  const textNode = el.querySelector('.msg-text');
  if (textNode) textNode.textContent = 'Message deleted 🗑️';
});

// ── INSTAGRAM-STYLE ATTACHED EMOJI REACTIONS ────────────────────────
const messageReactions = new Map(); // msgId -> { [userId]: emoji }

function renderMessageReactions(msgId) {
  if (!msgId) return;
  const reactionsMap = messageReactions.get(msgId) || {};
  const selector = `[data-msg-id="${msgId}"]`;
  const msgEls = document.querySelectorAll(selector);
  if (!msgEls.length) return;

  // Calculate counts for each emoji (each user contributes at most 1 count)
  const counts = {};
  Object.values(reactionsMap).forEach(emo => {
    if (emo) counts[emo] = (counts[emo] || 0) + 1;
  });

  const emojis = Object.keys(counts);

  msgEls.forEach(msgEl => {
    let tray = msgEl.querySelector('.msg-reactions-tray');
    if (emojis.length === 0) {
      if (tray) tray.remove();
      msgEl.classList.remove('has-reactions');
      return;
    }

    if (!tray) {
      tray = document.createElement('div');
      tray.className = 'msg-reactions-tray';
      msgEl.appendChild(tray);
      msgEl.classList.add('has-reactions');
    }

    tray.innerHTML = '';
    emojis.forEach(emo => {
      const badge = document.createElement('div');
      badge.className = 'msg-reaction-badge';
      badge.dataset.emoji = emo;
      const myId = selfUserId || persistentUserId;
      if (myId && reactionsMap[myId] === emo) {
        badge.classList.add('self-reacted');
      }
      const count = counts[emo];
      badge.innerHTML = `<span class="rxn-emoji">${emo}</span>${count > 1 ? `<span class="rxn-count">${count}</span>` : ''}`;
      badge.onclick = (e) => {
        e.stopPropagation();
        badge.style.transform = 'scale(1.3)';
        setTimeout(() => { badge.style.transform = ''; }, 160);
      };
      tray.appendChild(badge);
    });
  });
}

function attachOrToggleReaction(msgId, emoji, isFriend) {
  const roomId = isFriend ? friendRoomId : activeRoomId;
  if (!roomId || !msgId || !emoji) return;

  const currentUserId = selfUserId || persistentUserId || 'local_user';
  if (!messageReactions.has(msgId)) {
    messageReactions.set(msgId, {});
  }
  const currentMap = messageReactions.get(msgId);

  // Single emoji per user: updates/replaces any previous emoji reaction for this user
  currentMap[currentUserId] = emoji;

  // 1. Emit reaction event to socket server
  socket.emit('react_message', { roomId, msgId, emoji, isFriend });

  // 2. Re-render badges with accurate single count
  renderMessageReactions(msgId);

  // 3. Fun visual feedback
  if (emoji === '❤️') triggerEffect('hearts');
  else if (emoji === '🔥') triggerEffect('fire');
  else if (emoji === '👍' || emoji === '✨') triggerEffect('confetti');
}

socket.off('message_reaction');
socket.on('message_reaction', ({ msgId, emoji, fromUserId, roomId }) => {
  if (!msgId || !emoji || !fromUserId) return;
  if (!messageReactions.has(msgId)) {
    messageReactions.set(msgId, {});
  }
  const currentMap = messageReactions.get(msgId);
  currentMap[fromUserId] = emoji; // Store exactly one emoji per user ID
  renderMessageReactions(msgId);

  const isMe = (fromUserId === selfUserId || fromUserId === persistentUserId);
  if (!isMe) {
    if (emoji === '❤️') triggerEffect('hearts');
    else if (emoji === '🔥') triggerEffect('fire');
  }
});

// ── TIME EXTENSION EVENTS ─────────────────────────────────────────────
const waitingTexts = [
  'Searching across the globe 🌎', 'Scanning the vibes... 📶',
  'Finding your match ⚡', 'Matching frequencies ✨',
  'Hold tight bestie 💖', 'Locating cool strangers 👣'
];
let waitingTextIdx = 0;
let waitingTextInterval = null;
let waitStartTime = 0;
let waitElapsedInterval = null;
let timerInterval = null;

// ── UTILS ────────────────────────────────────────────────────
function formatTime(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function formatTimestamp(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

// Smooth scroll to bottom using requestAnimationFrame
function scrollToBottom(container) {
  if (!container) return;
  const target = container.scrollHeight;
  const start = container.scrollTop;
  const dist = target - start;
  if (dist <= 0) return;
  const dur = Math.min(300, Math.max(80, dist * 0.3));
  let startTime = null;
  function ease(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
  function step(ts) {
    if (!startTime) startTime = ts;
    const elapsed = ts - startTime;
    const prog = Math.min(elapsed / dur, 1);
    container.scrollTop = start + dist * ease(prog);
    if (prog < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── TOAST ────────────────────────────────────────────────────
let lastToastMsg = '';
let lastToastTime = 0;
function showToast(msg, type = 'info', duration = 3800) {
  if (!toastContainer || !msg) return;
  // Never show popup or toast for leaving queue
  const lower = String(msg).toLowerCase();
  if (lower.includes('queue') || lower.includes('left the queue') || lower.includes('left queue')) {
    return;
  }
  // Debounce identical toasts within 3 seconds
  const now = Date.now();
  if (msg === lastToastMsg && now - lastToastTime < 3000) {
    return;
  }
  lastToastMsg = msg;
  lastToastTime = now;

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  // Slide-out before removing
  setTimeout(() => {
    el.style.animation = 'toast-out .25s var(--ease) forwards';
    el.addEventListener('animationend', () => el.remove(), { once: true });
    // Fallback removal
    setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
  }, duration - 300);
}

// ── MODAL ────────────────────────────────────────────────────
function showConfirm(title, message, onYes, onNo, yesText = 'Confirm', noText = 'Cancel', icon = '⚠️') {
  // Never show confirmation popup for queue actions
  const titleLower = String(title || '').toLowerCase();
  const msgLower = String(message || '').toLowerCase();
  if (titleLower.includes('queue') || msgLower.includes('queue') || titleLower.includes('left the queue')) {
    return;
  }

  // Enforce strictly one single popup: close/remove any other modals or banners first
  document.querySelectorAll('.glass-modal-overlay').forEach(m => m.remove());
  const existingBanner = document.getElementById('softAuthBanner');
  if (existingBanner) existingBanner.remove();

  if (!confirmModal) { onYes?.(); return; }

  // If a modal with the same title is already open, do not re-trigger / stack
  if (confirmModal.style.display === 'flex' && confirmTitle?.textContent === title) {
    return;
  }

  if (confirmTitle) confirmTitle.textContent = title;
  if (confirmMessage) confirmMessage.innerHTML = message;
  const modalIcon = $('modalIcon');
  if (modalIcon) modalIcon.textContent = icon;
  if (confirmYes) confirmYes.textContent = yesText;
  if (confirmNo) {
    if (!noText) {
      confirmNo.style.display = 'none';
    } else {
      confirmNo.style.display = '';
      confirmNo.textContent = noText;
    }
  }
  confirmCb = onYes;
  confirmModal.dataset.onNo = typeof onNo === 'function' ? true : false;
  confirmModal.confirmNoFn = onNo;
  confirmModal.style.display = 'flex';
}
function closeModal() {
  if (confirmModal) confirmModal.style.display = 'none';
  if (confirmYes) confirmYes.textContent = 'Confirm';
  if (confirmNo) {
    confirmNo.textContent = 'Cancel';
    confirmNo.style.display = '';
  }
  document.querySelectorAll('.glass-modal-overlay').forEach(m => m.remove());
  const existingBanner = document.getElementById('softAuthBanner');
  if (existingBanner) existingBanner.remove();
}

// ── CONNECTION BADGE & NETWORK STATUS ─────────────────────────
let networkStatusTimeout = null;

function showNetworkStatus(text, type = 'error') {
  if (networkStatusTimeout) {
    clearTimeout(networkStatusTimeout);
    networkStatusTimeout = null;
  }
  if (!networkStatusBar) return;
  networkStatusBar.className = `network-status-bar ${type}`;
  if (networkStatusText) networkStatusText.textContent = text;
  networkStatusBar.style.display = 'flex';
}

function hideNetworkStatus(delay = 0) {
  if (networkStatusTimeout) {
    clearTimeout(networkStatusTimeout);
    networkStatusTimeout = null;
  }
  if (!networkStatusBar) return;
  if (delay > 0) {
    networkStatusTimeout = setTimeout(() => {
      if (networkStatusBar) networkStatusBar.style.display = 'none';
      networkStatusTimeout = null;
    }, delay);
  } else {
    networkStatusBar.style.display = 'none';
  }
}

function setConnStatus(state) {
  if (!connectionStatus) return;
  connectionStatus.className = `conn-badge ${state}`;
  const lbl = connectionStatus.querySelector('.conn-label');
  if (lbl) lbl.textContent =
    state === 'connected' ? '●' :
      state === 'disconnected' ? '✗' : '…';
}

reconnectNowBtn?.addEventListener('click', () => {
  if (!socket.connected) {
    showNetworkStatus('Attempting to reconnect now…', 'warning');
    socket.connect();
  }
});

// ── SCREEN INDICATOR ──────────────────────────────────────────
function setScreenIndicator(step) {
  const steps = ['home', 'searching', 'chatting'];
  const idx = steps.indexOf(step);
  document.querySelectorAll('.si-step').forEach((el, i) => {
    el.classList.toggle('si-active', i === idx);
    el.classList.toggle('si-done', i < idx);
  });
  document.querySelectorAll('.si-line').forEach((el, i) => {
    el.classList.toggle('si-filled', i < idx);
  });
}

// ── REAL-TIME ONLINE COUNT ───────────────────────────────────
function setOnlineCount(n) {
  const num = Math.max(1, Number(n) || 1);
  const display = num.toLocaleString();
  if (liveUsersEl && window.__pingCountUp) window.__pingCountUp(liveUsersEl, num);
  else if (liveUsersEl) liveUsersEl.textContent = display;
  if (headerActiveUsers) headerActiveUsers.textContent = display;
  if (headerOnlineCount) headerOnlineCount.textContent = display;
  if (actionBarOnline) actionBarOnline.textContent = display;
  const ws = $('wsCount'); if (ws) ws.textContent = display;
}

// Fetch initial stats immediately on page load
try {
  fetch('/api/stats')
    .then(r => r.json())
    .then(data => {
      if (data && typeof data.activeUsers === 'number') {
        setOnlineCount(data.activeUsers);
      }
    })
    .catch(() => {});
} catch (_) {}

// ── REUSABLE OPTIMIZED INSTAGRAM-STYLE LONG-PRESS HANDLER ──
function attachMsgLongPress(el, { msgId, textNode, text, isPartner, isFriend, isSelf, sentAt }) {
  let pressTimer = null;
  let startX = 0, startY = 0;
  let hasTriggered = false;

  const getCleanText = () => {
    if (textNode && textNode.childNodes) {
      const parts = Array.from(textNode.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE || (n.classList && !n.classList.contains('edited-tag') && !n.classList.contains('msg-reply-block')))
        .map(n => n.textContent);
      if (parts.length > 0) return parts.join('').trim();
    }
    return (text || '').replace(/<[^>]*>/g, '').trim();
  };

  const handleStart = (e) => {
    if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.msg-reply-block') || e.target.closest('.rxn-btn') || e.target.closest('.msg-reply-trigger')) return;

    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    hasTriggered = false;

    if (e.type === 'touchstart') {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    } else {
      startX = e.clientX;
      startY = e.clientY;
    }

    el.classList.add('msg-pressing');

    // Snappy 320ms hold timing with immediate haptic touch
    pressTimer = setTimeout(() => {
      hasTriggered = true;
      el.classList.remove('msg-pressing');
      if (navigator.vibrate) navigator.vibrate(28);
      showInstagramMsgMenu(e, msgId, getCleanText(), isPartner, isFriend, isSelf, sentAt, startX, startY);
      pressTimer = null;
    }, 320);
  };

  const handleMove = (e) => {
    if (pressTimer) {
      const touch = e.touches ? e.touches[0] : e;
      const dx = Math.abs(touch.clientX - startX);
      const dy = Math.abs(touch.clientY - startY);
      // Cancel long-press if finger moved > 8px so chat scrolling remains buttery smooth
      if (dx > 8 || dy > 8) {
        clearTimeout(pressTimer);
        pressTimer = null;
        el.classList.remove('msg-pressing');
      }
    }
  };

  const handleEnd = (e) => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    el.classList.remove('msg-pressing');
    if (hasTriggered && e && e.cancelable) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  el.addEventListener('touchstart', handleStart, { passive: true });
  el.addEventListener('touchmove', handleMove, { passive: true });
  el.addEventListener('touchend', handleEnd);
  el.addEventListener('touchcancel', handleEnd);
  el.addEventListener('mousedown', handleStart);
  el.addEventListener('mousemove', handleMove);
  el.addEventListener('mouseup', handleEnd);
  el.addEventListener('mouseleave', handleEnd);

  // Desktop right-click context menu opens Instagram-style menu directly
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    el.classList.remove('msg-pressing');
    if (navigator.vibrate) navigator.vibrate(25);
    showInstagramMsgMenu(e, msgId, getCleanText(), isPartner, isFriend, isSelf, sentAt, e.clientX, e.clientY);
  });
}

// ── MESSAGES ─────────────────────────────────────────────────
let lastSystemMsgText = '';
let lastSystemMsgTime = 0;

function appendMsg(text, opts = {}) {
  const { isSelf = false, isPartner = false, isSystem = false, isHTML = false, variant = '', status = 'sending', msgId = '' } = opts;
  if (!chatBox) return;

  // Client-Side Deduplication (Bug 1 Fix)
  if (msgId && chatBox.querySelector(`[data-msg-id="${msgId}"]`)) {
    return;
  }

  // Deduplicate system messages
  if (isSystem) {
    const now = Date.now();
    if (text === lastSystemMsgText && (now - lastSystemMsgTime < 2000)) {
      return;
    }
    lastSystemMsgText = text;
    lastSystemMsgTime = now;
  }


  const empty = chatBox.querySelector('.msgs-empty');
  if (empty) empty.remove();

  // Cap message DOM nodes to prevent memory leaks
  while (chatBox.children.length > 150) {
    const first = chatBox.firstElementChild;
    if (first) first.remove();
    else break;
  }

  const el = document.createElement('div');
  const cls = ['msg'];
  if (isSelf) cls.push('self');
  if (isPartner) cls.push('partner');
  if (isSystem) cls.push('system');
  if (variant) cls.push(variant);
  if (opts.extraClass) cls.push(opts.extraClass);
  el.className = cls.join(' ');
  if (msgId) el.dataset.msgId = msgId;

  const contentWrap = document.createElement('div');
  contentWrap.className = 'msg-content';

  if (opts.replyTo) {
    const rBlock = document.createElement('div');
    rBlock.className = 'msg-reply-block';
    if (opts.replyTo.msgId) rBlock.dataset.replyTo = opts.replyTo.msgId;
    rBlock.onclick = () => false;
    const rAuthor = document.createElement('strong');
    const isReplyFromPartner = opts.replyTo.isPartner ?? !opts.replyTo.wasSender;
    rAuthor.textContent = isReplyFromPartner ? 'Stranger' : 'You';
    const rText = document.createElement('span');
    rText.textContent = opts.replyTo.text;
    rBlock.appendChild(rAuthor);
    rBlock.appendChild(rText);
    contentWrap.appendChild(rBlock);
  }

  const textNode = document.createElement('div');
  textNode.className = 'msg-text';
  if (isHTML) textNode.innerHTML = text;
  else textNode.textContent = text;
  contentWrap.appendChild(textNode);

  if (opts.isFlash) {
    el.classList.add('flash');
    const sentAt = opts.sentAt || Date.now();
    const age = Date.now() - sentAt;
    const totalDuration = 10000;
    const remaining = Math.max(0, totalDuration - age);

    if (remaining > 0) {
      // Only evaporate for the receiver
      if (!isSelf) {
        // Start evaporating 6s before expiry (after 4s of stability)
        const evaporateDelay = Math.max(0, remaining - 6000);
        setTimeout(() => {
          el.classList.add('flash-evaporating');
        }, evaporateDelay);
      }


      // Final removal for both
      setTimeout(() => {
        // Find all reply blocks pointing to this message and clear them
        if (msgId) {
          document.querySelectorAll(`.msg-reply-block[data-reply-to="${msgId}"]`).forEach(rb => {
            const s = rb.querySelector('span');
            if (s) s.textContent = '⚡ Flash message expired';
            rb.style.opacity = '0.5';
            rb.style.fontStyle = 'italic';
          });
        }

        el.remove();
        if (chatBox.children.length === 0) {
          clearChat();
        }
      }, remaining);
    } else {
      el.remove();
    }
  }

  if (opts.isEdited) {
    const tag = document.createElement('span');
    tag.className = 'msg-edited-tag';
    tag.textContent = '(edited)';
    textNode.appendChild(tag);
  }



  const footer = document.createElement('div');
  footer.className = 'msg-footer';

  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = formatTimestamp(opts.sentAt);
  footer.appendChild(time);

  if (isSelf && !isSystem) {
    const statusEl = document.createElement('div');
    statusEl.className = `msg-status msg-status--${status}`;
    statusEl.setAttribute('data-status', status);
    statusEl.setAttribute('data-msg-status', status);
    statusEl.innerHTML = `<svg class="status-icon" viewBox="0 0 20 12" fill="none"><path d="M1 6l4 4 8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10l8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/></svg>`;
    footer.appendChild(statusEl);
  }

  contentWrap.appendChild(footer);
  el.appendChild(contentWrap);

  // Context Menu & Long press event listener for advanced options
  if (!isSystem) {
    attachMsgLongPress(el, { msgId, textNode, text, isPartner, isFriend: false, isSelf, sentAt: opts.sentAt });
  }

  // Double tap to heart
  el.ondblclick = (e) => {
    e.stopPropagation();
    if (msgId) {
      attachOrToggleReaction(msgId, '❤️', false);
    }
  };

  // Message appending without inline hover reactions or reply buttons (handled via Instagram-style long-press)
  chatBox.appendChild(el);
  scrollToBottom(chatBox);

  // Auto-disappear green text, warning signs, system messages or notices after 7 seconds
  if (isSystem || variant || opts.extraClass) {
    setTimeout(() => {
      if (el && el.parentNode) {
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        el.style.opacity = '0';
        el.style.transform = 'scale(0.95) translateY(-4px)';
        setTimeout(() => {
          if (el && el.parentNode) el.remove();
        }, 650);
      }
    }, 7000);
  }

  if (isPartner) {
    if (document.hasFocus() && !invisibleToggle?.checked) {
      socket.emit('message_read', { roomId: activeRoomId, msgId });
    }
  }

  if (!isSystem) checkKeywordEffects(text);
}

// ── INSTAGRAM-STYLE LONG PRESS TO REPLY & REACT (PING UI) ────
function showInstagramMsgMenu(e, msgId, text, isPartner, isFriend, isSelf, sentAt, touchX, touchY) {
  // Clean up any previously opened menus or backdrops
  document.querySelectorAll('.ping-ig-backdrop, .ping-ig-reaction-pill, .ping-ig-menu, .msg-context-menu').forEach(el => el.remove());
  document.querySelectorAll('.ping-msg-highlighted').forEach(el => el.classList.remove('ping-msg-highlighted'));

  const targetBubble = (e && e.currentTarget && e.currentTarget.classList && e.currentTarget.classList.contains('msg'))
    ? e.currentTarget
    : (e?.target?.closest ? e.target.closest('.msg') : null)
      || (msgId ? document.querySelector(`[data-msg-id="${msgId}"]`) : null);

  if (targetBubble) {
    targetBubble.classList.add('ping-msg-highlighted');
  }

  // 1. Transparent/darkened backdrop (no blur so keyboard stays sharp)
  const backdrop = document.createElement('div');
  backdrop.className = 'ping-ig-backdrop';
  document.body.appendChild(backdrop);

  // 2. Floating Instagram reaction pill (capsule)
  const pill = document.createElement('div');
  pill.className = 'ping-ig-reaction-pill';

  // Prevent buttons in pill from taking focus away from keyboard
  pill.addEventListener('pointerdown', (evt) => {
    evt.stopPropagation();
    if (evt.target.closest('button')) {
      evt.preventDefault();
    }
  });

  const primaryEmojis = ['❤️', '😂', '😮', '😢', '🔥', '👍'];
  primaryEmojis.forEach(emo => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ping-ig-rxn-btn';
    btn.textContent = emo;
    btn.title = `React ${emo}`;
    btn.onclick = (evt) => {
      evt.stopPropagation();
      if (navigator.vibrate) navigator.vibrate(18);
      closeAll();
      attachOrToggleReaction(msgId, emo, isFriend);
      const targetInput = isFriend ? $('friendMessageInput') : $('messageInput');
      if (targetInput) targetInput.focus({ preventScroll: true });
    };
    pill.appendChild(btn);
  });

  // Secondary emoji expander tray
  const moreTray = document.createElement('div');
  moreTray.className = 'ping-ig-more-tray';
  const extraEmojis = ['💀', '🥺', '✨', '🙌', '💯', '👏'];
  extraEmojis.forEach(emo => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ping-ig-rxn-btn';
    btn.textContent = emo;
    btn.title = `React ${emo}`;
    btn.onclick = (evt) => {
      evt.stopPropagation();
      if (navigator.vibrate) navigator.vibrate(18);
      closeAll();
      attachOrToggleReaction(msgId, emo, isFriend);
      const targetInput = isFriend ? $('friendMessageInput') : $('messageInput');
      if (targetInput) targetInput.focus({ preventScroll: true });
    };
    moreTray.appendChild(btn);
  });
  pill.appendChild(moreTray);

  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'ping-ig-rxn-more';
  moreBtn.innerHTML = '+';
  moreBtn.title = 'More reactions';
  moreBtn.onclick = (evt) => {
    evt.stopPropagation();
    const isOpening = !moreTray.classList.contains('open');
    moreTray.classList.toggle('open', isOpening);
    pill.classList.toggle('expanded', isOpening);
    moreBtn.innerHTML = isOpening ? '✕' : '+';
    reposition();
  };
  pill.appendChild(moreBtn);

  document.body.appendChild(pill);

  // 3. Floating Instagram Action Menu with Ping UI (Clean & uncluttered)
  const menu = document.createElement('div');
  menu.className = 'ping-ig-menu';

  // Prevent buttons in menu from taking focus away from keyboard
  menu.addEventListener('pointerdown', (evt) => {
    evt.stopPropagation();
    if (evt.target.closest('button')) {
      evt.preventDefault();
    }
  });

  // Primary Action: Reply
  const replyItem = document.createElement('button');
  replyItem.type = 'button';
  replyItem.className = 'ping-ig-item ping-ig-reply-item';
  replyItem.innerHTML = `
    <div class="ping-ig-item-icon">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 14 4 9 9 4"/>
        <path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
      </svg>
    </div>
    <span class="ping-ig-item-title">Reply</span>
  `;
  replyItem.onclick = (evt) => {
    evt.stopPropagation();
    if (navigator.vibrate) navigator.vibrate(22);
    closeAll();
    if (typeof window.startReply === 'function') {
      window.startReply(text, isPartner, msgId);
    }
    const rp = isFriend ? $('friendReplyPreview') : $('replyPreview');
    if (rp) {
      rp.classList.remove('rp-flash-highlight');
      void rp.offsetWidth;
      rp.classList.add('rp-flash-highlight');
    }
    const targetInput = isFriend ? $('friendMessageInput') : $('messageInput');
    if (targetInput) {
      targetInput.focus({ preventScroll: true });
      targetInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };
  menu.appendChild(replyItem);

  // Copy Text
  const copyItem = document.createElement('button');
  copyItem.type = 'button';
  copyItem.className = 'ping-ig-item';
  copyItem.innerHTML = `
    <div class="ping-ig-item-icon">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
    </div>
    <span class="ping-ig-item-title">Copy</span>
  `;
  copyItem.onclick = async (evt) => {
    evt.stopPropagation();
    if (navigator.vibrate) navigator.vibrate(18);
    closeAll();
    const cleanText = (text || '').replace(/<[^>]*>/g, '').trim();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(cleanText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = cleanText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      showToast('📋 Copied to clipboard!', 'info', 1500);
    } catch (err) {
      showToast('📋 Copied to clipboard!', 'info', 1500);
    }
    const targetInput = isFriend ? $('friendMessageInput') : $('messageInput');
    if (targetInput) targetInput.focus({ preventScroll: true });
  };
  menu.appendChild(copyItem);

  // Edit / Delete (for own messages)
  if (isSelf && msgId) {
    const editItem = document.createElement('button');
    editItem.type = 'button';
    editItem.className = 'ping-ig-item';
    editItem.innerHTML = `
      <div class="ping-ig-item-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </div>
      <span class="ping-ig-item-title">Edit</span>
    `;
    editItem.onclick = (evt) => {
      evt.stopPropagation();
      closeAll();
      openEditModal(msgId, text, isFriend);
    };
    menu.appendChild(editItem);

    const deleteItem = document.createElement('button');
    deleteItem.type = 'button';
    deleteItem.className = 'ping-ig-item danger';
    deleteItem.innerHTML = `
      <div class="ping-ig-item-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </div>
      <span class="ping-ig-item-title">Delete</span>
    `;
    deleteItem.onclick = (evt) => {
      evt.stopPropagation();
      closeAll();
      openDeleteModal(msgId, isFriend);
    };
    menu.appendChild(deleteItem);
  }

  // Report option for stranger messages
  if (!isSelf && !isFriend) {
    const reportItem = document.createElement('button');
    reportItem.type = 'button';
    reportItem.className = 'ping-ig-item danger';
    reportItem.innerHTML = `
      <div class="ping-ig-item-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
          <line x1="4" y1="22" x2="4" y2="15"/>
        </svg>
      </div>
      <span class="ping-ig-item-title">Report</span>
    `;
    reportItem.onclick = (evt) => {
      evt.stopPropagation();
      closeAll();
      showConfirm('Report User?', 'The chat will end immediately and the user will receive a warning.', () => {
        socket.emit('report_user', { roomId: activeRoomId, reason: 'inappropriate' });
        endCurrentChat();
        showToast('User reported. Returned to home screen.', 'info', 3000);
      });
    };
    menu.appendChild(reportItem);
  }

  document.body.appendChild(menu);

  // Dynamic positioning calculation respecting on-screen virtual keyboard and visual viewport
  function reposition() {
    menu.style.maxHeight = '';
    menu.style.overflowY = '';

    const vv = window.visualViewport;
    const winW = vv ? vv.width : window.innerWidth;
    const winH = vv ? vv.height : window.innerHeight;
    const vTop = vv ? vv.offsetTop : 0;
    const vLeft = vv ? vv.offsetLeft : 0;

    const bRect = targetBubble ? targetBubble.getBoundingClientRect() : {
      top: touchY || (vTop + 150),
      bottom: (touchY || (vTop + 150)) + 40,
      left: touchX || (vLeft + 100),
      right: (touchX || (vLeft + 100)) + 120,
      width: 120,
      height: 40
    };

    const pRect = pill.getBoundingClientRect();
    const pW = pRect.width || 280;
    const pH = pRect.height || 44;

    const mRect = menu.getBoundingClientRect();
    const mW = mRect.width || 224;
    const mH = mRect.height || 180;

    // The chat-bottom-wrapper (input row) sits at the bottom of the visible visual viewport
    const topPadding = vTop + 54;
    const bottomBarPadding = 62;
    const maxBottom = Math.max(topPadding + 100, vTop + winH - bottomBarPadding);
    const GAP = 6;

    // ── HORIZONTAL ALIGNMENT (PREVENT RIGHT-SIDE CUTOFF) ──
    const minLeft = vLeft + 12;
    const maxPillLeft = Math.max(minLeft, vLeft + winW - pW - 12);
    const maxMenuLeft = Math.max(minLeft, vLeft + winW - mW - 12);

    const targetCenterX = bRect.left + (bRect.width / 2);
    let pLeft, mLeft;

    if (winW < 540) {
      pLeft = Math.round(targetCenterX - (pW / 2));
      mLeft = Math.round(targetCenterX - (mW / 2));
    } else if (isSelf) {
      pLeft = Math.round(bRect.right - pW);
      mLeft = Math.round(bRect.right - mW);
    } else {
      pLeft = Math.round(bRect.left);
      mLeft = Math.round(bRect.left);
    }

    // Viewport boundary guardrails (ensures fully visible horizontally without cutoffs)
    pLeft = Math.max(minLeft, Math.min(pLeft, maxPillLeft));
    mLeft = Math.max(minLeft, Math.min(mLeft, maxMenuLeft));

    // ── VERTICAL ALIGNMENT (OVERLAPS CLEANLY ABOVE KEYBOARD) ──
    let pTop, mTop;
    const spaceAbove = bRect.top - topPadding;
    const spaceBelow = maxBottom - bRect.bottom;

    if (spaceAbove >= pH + GAP && spaceBelow >= mH + GAP) {
      // Natural: Emoji pill directly above bubble, Reply menu directly below bubble
      pTop = bRect.top - pH - GAP;
      mTop = bRect.bottom + GAP;
    } else if (spaceAbove >= pH + mH + (GAP * 2)) {
      // Bubble is near bottom (above keyboard): place both above bubble
      mTop = bRect.top - mH - GAP;
      pTop = mTop - pH - GAP;
    } else if (spaceBelow >= pH + mH + (GAP * 2)) {
      // Bubble is near top: place both below bubble
      pTop = bRect.bottom + GAP;
      mTop = pTop + pH + GAP;
    } else if (spaceAbove >= spaceBelow) {
      pTop = Math.max(topPadding, bRect.top - pH - GAP);
      mTop = pTop + pH + GAP;
    } else {
      pTop = Math.max(topPadding, Math.min(bRect.bottom + GAP, maxBottom - pH - 60));
      mTop = pTop + pH + GAP;
    }

    // ── ABSOLUTE INVARIANTS ──
    pTop = Math.max(topPadding, pTop);
    if (mTop < pTop + pH + GAP) {
      mTop = pTop + pH + GAP;
    }

    // Reply options menu must fit on screen above the keyboard
    if (mTop + mH > maxBottom) {
      const allowedHeight = Math.max(64, maxBottom - mTop);
      menu.style.maxHeight = `${allowedHeight}px`;
      menu.style.overflowY = 'auto';
      menu.style.webkitOverflowScrolling = 'touch';
    }

    pill.style.position = 'fixed';
    pill.style.top = `${Math.round(pTop)}px`;
    pill.style.left = `${Math.round(pLeft)}px`;

    menu.style.position = 'fixed';
    menu.style.top = `${Math.round(mTop)}px`;
    menu.style.left = `${Math.round(mLeft)}px`;
  }
  reposition();

  // Dismiss listeners
  let isClosed = false;
  function closeAll() {
    if (isClosed) return;
    isClosed = true;
    if (targetBubble) targetBubble.classList.remove('ping-msg-highlighted');
    backdrop.classList.add('closing');
    pill.style.opacity = '0';
    pill.style.transform = 'scale(0.8)';
    pill.style.transition = 'all 0.08s cubic-bezier(0, 0, 0.2, 1)';
    menu.style.opacity = '0';
    menu.style.transform = 'scale(0.85)';
    menu.style.transition = 'all 0.08s cubic-bezier(0, 0, 0.2, 1)';
    setTimeout(() => {
      backdrop.remove();
      pill.remove();
      menu.remove();
    }, 90);
    cleanup();
  }

  const handlePointerDown = (evt) => {
    if (pill.contains(evt.target) || menu.contains(evt.target)) return;
    closeAll();
  };
  const handleKeyDown = (evt) => {
    if (evt.key === 'Escape') closeAll();
  };

  const scrollTarget = isFriend ? friendChatBox : chatBox;
  const initialScrollTop = scrollTarget ? scrollTarget.scrollTop : 0;

  const handleScroll = () => {
    if (!scrollTarget) return;
    if (Math.abs(scrollTarget.scrollTop - initialScrollTop) > 35) {
      closeAll();
    } else {
      reposition();
    }
  };

  const handleResize = () => {
    reposition();
  };

  backdrop.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('keydown', handleKeyDown);
  scrollTarget?.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('resize', handleResize);
  window.visualViewport?.addEventListener('resize', handleResize);
  window.visualViewport?.addEventListener('scroll', handleResize);

  function cleanup() {
    backdrop.removeEventListener('pointerdown', handlePointerDown);
    window.removeEventListener('keydown', handleKeyDown);
    scrollTarget?.removeEventListener('scroll', handleScroll);
    window.removeEventListener('resize', handleResize);
    window.visualViewport?.removeEventListener('resize', handleResize);
    window.visualViewport?.removeEventListener('scroll', handleResize);
  }
}
window.showInstagramMsgMenu = showInstagramMsgMenu;
window.showAdvancedMsgOptions = showInstagramMsgMenu;

function openEditModal(msgId, currentText, isFriend) {
  const safeText = (currentText || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  showConfirm('Edit Message', 
    `<div style="margin-top:8px;"><textarea id="editInput" style="width:100%; height:90px; background:rgba(255,255,255,0.06); color:#f8fafc; border:1px solid rgba(139,92,246,0.35); padding:10px; border-radius:12px; font-family:inherit; font-size:14px; outline:none; resize:none; box-sizing:border-box;">${safeText}</textarea></div>`,
    () => {
      const editEl = document.getElementById('editInput');
      const newText = editEl ? editEl.value.trim() : '';
      if (newText && newText !== currentText) {
        const roomId = isFriend 
          ? (AppState.friends.activeRoomId || friendRoomId) 
          : (AppState.explore.roomId || activeRoomId);
        if (isFriend) socket.emit('edit_dm', { roomId, msgId, newMessage: newText });
        else socket.emit('edit_message', { roomId, msgId, newMessage: newText });
      }
    }
  );
  const modalIcon = $('modalIcon');
  if (modalIcon) modalIcon.textContent = '✏️';
  setTimeout(() => {
    const editEl = document.getElementById('editInput');
    if (editEl) {
      editEl.focus();
      editEl.setSelectionRange(editEl.value.length, editEl.value.length);
    }
  }, 100);
}

function openDeleteModal(msgId, isFriend) {
  showConfirm('Delete Message', 'Are you sure you want to delete this message? This action cannot be undone.', () => {
    const roomId = isFriend 
      ? (AppState.friends.activeRoomId || friendRoomId) 
      : (AppState.explore.roomId || activeRoomId);
    if (isFriend) socket.emit('delete_dm', { roomId, msgId });
    else socket.emit('delete_message', { roomId, msgId });
  });
  const modalIcon = $('modalIcon');
  if (modalIcon) modalIcon.textContent = '🗑️';
}

function updateMsgStatus(msgId, newStatus) {
  if (!msgId) return;
  const el = (chatBox && chatBox.querySelector(`[data-msg-id="${msgId}"]`)) || 
             (friendChatBox && friendChatBox.querySelector(`[data-msg-id="${msgId}"]`));
  if (!el) return;
  const statusEl = el.querySelector('.msg-status');
  if (!statusEl) return;
  statusEl.setAttribute('data-status', newStatus);
  statusEl.className = `msg-status msg-status--${newStatus}`;
  if (newStatus === 'sent') {
    statusEl.innerHTML = `<svg class="status-icon" viewBox="0 0 20 12" fill="none"><path d="M1 6l4 4 8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10l8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/></svg>`;
    // Briefly flash the sent state
    statusEl.classList.add('status-flash');
    setTimeout(() => statusEl.classList.remove('status-flash'), 600);
  }
}

function clearChat() {
  if (!chatBox) return;
  chatBox.innerHTML = `
    <div class="msgs-empty">
      <div class="msgs-empty-pulse"></div>
      <span class="msgs-empty-icon" style="margin-top:-78px;position:relative">💭</span>
      <p>Say hi — they're waiting!</p>
    </div>`;
}

function clearFriendChat() {
  if (!friendChatBox) return;
  friendChatBox.innerHTML = `
    <div class="msgs-empty">
      <div class="msgs-empty-pulse"></div>
      <span class="msgs-empty-icon" style="margin-top:-78px;position:relative">💭</span>
      <p>Start a conversation!</p>
    </div>`;
}

let lastFriendSystemMsgText = '';
let lastFriendSystemMsgTime = 0;

function appendFriendMsg(text, opts = {}) {
  const { isSelf = false, isPartner = false, isSystem = false, isHTML = false, variant = '', status = 'sending', msgId = '' } = opts;
  if (!friendChatBox) return;

  // Client-Side Deduplication (Bug 1 Fix)
  if (msgId && friendChatBox.querySelector(`[data-msg-id="${msgId}"]`)) {
    return;
  }

  if (isSystem) {
    const now = Date.now();
    if (text === lastFriendSystemMsgText && (now - lastFriendSystemMsgTime < 2000)) {
      return;
    }
    lastFriendSystemMsgText = text;
    lastFriendSystemMsgTime = now;
  }


  const empty = friendChatBox.querySelector('.msgs-empty');
  if (empty) empty.remove();

  // Cap friend message DOM nodes to prevent memory leaks
  while (friendChatBox.children.length > 150) {
    const first = friendChatBox.firstElementChild;
    if (first) first.remove();
    else break;
  }

  const el = document.createElement('div');
  const cls = ['msg'];
  if (isSelf) cls.push('self');
  if (isPartner) cls.push('partner');
  if (isSystem) cls.push('system');
  if (variant) cls.push(variant);
  el.className = cls.join(' ');
  if (msgId) el.dataset.msgId = msgId;

  const contentWrap = document.createElement('div');
  contentWrap.className = 'msg-content';

  if (opts.replyTo) {
    const rBlock = document.createElement('div');
    rBlock.className = 'msg-reply-block';
    if (opts.replyTo.msgId) rBlock.dataset.replyTo = opts.replyTo.msgId;
    const rAuthor = document.createElement('strong');
    const isReplyFromPartner = opts.replyTo.isPartner ?? !opts.replyTo.wasSender;
    rAuthor.textContent = isReplyFromPartner ? 'Friend' : 'You';
    const rText = document.createElement('span');
    rText.textContent = opts.replyTo.text;
    rBlock.appendChild(rAuthor);
    rBlock.appendChild(rText);
    contentWrap.appendChild(rBlock);
  }

  const textNode = document.createElement('div');
  textNode.className = 'msg-text';
  if (isHTML) textNode.innerHTML = text;
  else textNode.textContent = text;
  contentWrap.appendChild(textNode);

  if (opts.isFlash) {
    el.classList.add('flash');
    const sentAt = opts.sentAt || Date.now();
    const age = Date.now() - sentAt;
    const totalDuration = 10000;
    const remaining = Math.max(0, totalDuration - age);

    if (remaining > 0) {
      // Only evaporate for the receiver
      if (!isSelf) {
        // Start evaporating 6s before expiry (after 4s of stability)
        const evaporateDelay = Math.max(0, remaining - 6000);
        setTimeout(() => {
          el.classList.add('flash-evaporating');
        }, evaporateDelay);
      }

      // Final removal for both
      setTimeout(() => {
        // Find all reply blocks pointing to this message and clear them
        if (msgId) {
          document.querySelectorAll(`.msg-reply-block[data-reply-to="${msgId}"]`).forEach(rb => {
            const s = rb.querySelector('span');
            if (s) s.textContent = '⚡ Flash message expired';
            rb.style.opacity = '0.5';
            rb.style.fontStyle = 'italic';
          });
        }

        el.remove();
        if (friendChatBox.children.length === 0) {
          clearFriendChat();
        }
      }, remaining);
    } else {
      el.remove();
    }
  }

  if (opts.isEdited) {
    const tag = document.createElement('span');
    tag.className = 'msg-edited-tag';
    tag.textContent = '(edited)';
    textNode.appendChild(tag);
  }

  const footer = document.createElement('div');
  footer.className = 'msg-footer';
  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = formatTimestamp(opts.sentAt);
  footer.appendChild(time);

  if (isSelf && !isSystem) {
    const statusEl = document.createElement('div');
    statusEl.className = `msg-status msg-status--${status}`;
    statusEl.setAttribute('data-status', status);
    statusEl.setAttribute('data-msg-status', status);
    statusEl.innerHTML = `<svg class="status-icon" viewBox="0 0 20 12" fill="none"><path d="M1 6l4 4 8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10l8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/></svg>`;
    footer.appendChild(statusEl);
  }

  contentWrap.appendChild(footer);
  el.appendChild(contentWrap);

  // Context Menu & Long press event listener for advanced options
  if (!isSystem) {
    attachMsgLongPress(el, { msgId, textNode, text, isPartner, isFriend: true, isSelf, sentAt: opts.sentAt });
  }

  // Double tap to heart
  el.ondblclick = (e) => {
    e.stopPropagation();
    if (msgId) {
      attachOrToggleReaction(msgId, '❤️', true);
    }
  };

  // Friend message appending without inline hover reactions or reply buttons (handled via Instagram-style long-press)
  friendChatBox.appendChild(el);
  scrollToBottom(friendChatBox);

  // Auto-disappear green text, warning signs, system messages or notices after 7 seconds
  if (isSystem || variant) {
    setTimeout(() => {
      if (el && el.parentNode) {
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        el.style.opacity = '0';
        el.style.transform = 'scale(0.95) translateY(-4px)';
        setTimeout(() => {
          if (el && el.parentNode) el.remove();
        }, 650);
      }
    }, 7000);
  }

  if (isPartner) {
    if (document.hasFocus() && !invisibleToggle?.checked) {
      socket.emit('message_read', { roomId: friendRoomId, msgId });
    }
  }

  if (!isSystem) checkKeywordEffects(text);
}

function checkKeywordEffects(text) {
  const t = text.toLowerCase();
  if (t.includes('congrats') || t.includes('yay') || t.includes('celebrate')) triggerEffect('confetti');
  if (t.includes('love') || t.includes('❤️') || t.includes('heart')) triggerEffect('hearts');
  if (t.includes('fire') || t.includes('🔥') || t.includes('lit')) triggerEffect('fire');
}

function triggerEffect(type) {
  const container = document.createElement('div');
  container.className = `fullscreen-effect ${type}-effect`;
  document.body.appendChild(container);

  if (type === 'confetti') {
    for (let i = 0; i < 50; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-particle';
      p.style.left = Math.random() * 100 + 'vw';
      p.style.backgroundColor = `hsl(${Math.random() * 360}, 70%, 60%)`;
      p.style.animationDelay = Math.random() * 2 + 's';
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      container.appendChild(p);
    }
  } else if (type === 'hearts') {
    for (let i = 0; i < 20; i++) {
      const p = document.createElement('div');
      p.className = 'heart-particle';
      p.textContent = '❤️';
      p.style.left = Math.random() * 100 + 'vw';
      p.style.fontSize = (20 + Math.random() * 30) + 'px';
      p.style.animationDelay = Math.random() * 1.5 + 's';
      container.appendChild(p);
    }
  }

  setTimeout(() => container.remove(), 4000);
}

// ── TIMER ────────────────────────────────────────────────────
function startTimer(endMs) {
  stopTimer();
  if (!timerEl) return;
  AppState.explore.timerEndMs = endMs;
  function tick() {
    const rem = (AppState.explore.timerEndMs || endMs) - Date.now();
    timerEl.textContent = formatTime(rem);
    if (rem <= 30000) timerEl.classList.add('danger');
    else timerEl.classList.remove('danger');
    if (rem <= 0) {
      stopTimer();
      handleTimeExpired();
    }
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}
function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  if (timerEl) { timerEl.textContent = '--:--'; timerEl.classList.remove('danger'); }
}

// ── BUTTON SYNC ──────────────────────────────────────────────
let syncButtonsDebounceTimer = null;
function syncButtons() {
  if (syncButtonsDebounceTimer) cancelAnimationFrame(syncButtonsDebounceTimer);
  syncButtonsDebounceTimer = requestAnimationFrame(() => {
    _executeSyncButtons();
  });
}

function _executeSyncButtons() {
  if (messageInput) {
    messageInput.disabled = !inChat && !autoSearchInterval;
    messageInput.placeholder = inChat ? 'Type a message…' : (autoSearchInterval ? 'Partner disconnected...' : 'Waiting for a match…');
    if (inChat || autoSearchInterval) setTimeout(() => messageInput.focus(), 80);
  }
  if (sendBtn) sendBtn.disabled = (!inChat && !autoSearchInterval) || !messageInput?.value.trim();
  if (startBtn) startBtn.disabled = inChat || isWaiting || !isConnected;
  if (nextBtn) nextBtn.disabled = !inChat && !isWaiting;
  if (reportSkipBtn) reportSkipBtn.disabled = !inChat;
  if (reportBtn) reportBtn.disabled = !inChat;
  if (endChatBtn) endChatBtn.disabled = !inChat;
  if (extendTimeBtn) extendTimeBtn.disabled = !inChat;
  if (friendBtn) friendBtn.disabled = !inChat;

  document.querySelectorAll('.eq-btn').forEach(btn => btn.disabled = !inChat);

  if (actionBarOnline) {
    actionBarOnline.parentElement?.classList.toggle('visible', true);
  }
}

// ── EMOJIS ───────────────────────────────────────────────────
document.querySelectorAll('.eq-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!inChat || messageInput.disabled) return;
    const emoji = btn.textContent.trim();
    messageInput.value += emoji;
    messageInput.focus();
    if (sendBtn) sendBtn.disabled = false;
  });
});

const emojiMoreBtn = $('emojiMoreBtn');
const emojiPickerPopup = $('emojiPickerPopup');
const fullEmojiPicker = $('fullEmojiPicker');
const emojiAllBtn = $('emojiAllBtn');

if (emojiMoreBtn && emojiPickerPopup) {
  emojiMoreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!inChat || messageInput.disabled) return;
    emojiPickerPopup.classList.toggle('visible');
  });
  document.addEventListener('click', (e) => {
    if (!emojiPickerPopup.contains(e.target) && e.target !== emojiMoreBtn && e.target !== emojiAllBtn) {
      emojiPickerPopup.classList.remove('visible');
    }
  });
}

// All Emojis button - opens full emoji picker
if (emojiAllBtn && emojiPickerPopup) {
  emojiAllBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!inChat || messageInput.disabled) return;
    emojiPickerPopup.classList.toggle('visible');
  });
}
if (fullEmojiPicker && messageInput) {
  fullEmojiPicker.addEventListener('emoji-click', event => {
    if (!inChat || messageInput.disabled) return;
    messageInput.value += event.detail.unicode;
    messageInput.dispatchEvent(new Event('input')); // trigger char counter & sync
    if (sendBtn) sendBtn.disabled = false;
  });
}

// Friend DM emoji picker
if (friendEmojiBtn && friendEmojiPickerPopup) {
  friendEmojiBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentChatType !== 'friend') return;
    friendEmojiPickerPopup.classList.toggle('visible');
  });

  document.addEventListener('click', (e) => {
    if (friendEmojiPickerPopup && !friendEmojiPickerPopup.contains(e.target) && e.target !== friendEmojiBtn) {
      friendEmojiPickerPopup.classList.remove('visible');
    }
  });
}

if (friendFullEmojiPicker && friendMessageInput) {
  friendFullEmojiPicker.addEventListener('emoji-click', event => {
    if (currentChatType !== 'friend') return;
    friendMessageInput.value += event.detail.unicode;
    friendMessageInput.dispatchEvent(new Event('input'));
  });
}



// ── REPLIES ──────────────────────────────────────────────────
window.currentReplyTarget = null;
window.startReply = (text, isPartner, msgId) => {
  const isFriend = currentChatType === 'friend';
  const fromLabel = isPartner ? (isFriend ? 'Friend' : 'Stranger') : 'You';
  const isFlash = isFriend ? isFriendFlashMode : isFlashMode;
  
  window.currentReplyTarget = { 
    text: text.slice(0, 100), 
    from: fromLabel,
    msgId: msgId,
    isFlash: isFlash
  };

  const rp = $(isFriend ? 'friendReplyPreview' : 'replyPreview');

  if (rp) {
    rp.querySelector('.rp-text').textContent = window.currentReplyTarget.text;
    const label = rp.querySelector('span:first-of-type') || rp.querySelector('.rp-info span');
    if (label) {
      label.textContent = isFriend
        ? (isPartner ? 'Replying to Friend:' : 'Replying to You:')
        : (isPartner ? 'Replying to Stranger:' : 'Replying to You:');
    }
    
    // Add flash icon if reply target is a flash message or flash mode is active
    const flashIcon = rp.querySelector('.rp-flash-icon');
    if (flashIcon) {
      flashIcon.style.display = isFlash ? 'inline-block' : 'none';
    }

    rp.style.display = 'flex';
  }

  const input = isFriend ? friendMessageInput : messageInput;
  if (input) input.focus({ preventScroll: true });
};

window.cancelReply = () => {
  window.currentReplyTarget = null;
  const rp = $('replyPreview');
  const frp = $('friendReplyPreview');
  if (rp) rp.style.display = 'none';
  if (frp) frp.style.display = 'none';
  const input = currentChatType === 'friend' ? friendMessageInput : messageInput;
  if (input) input.focus({ preventScroll: true });
};

const cancelReplyBtn = $('cancelReplyBtn');
const cancelFriendReplyBtn = $('cancelFriendReplyBtn');

if (cancelReplyBtn) {
  cancelReplyBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  cancelReplyBtn.addEventListener('click', window.cancelReply);
}
if (cancelFriendReplyBtn) {
  cancelFriendReplyBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  cancelFriendReplyBtn.addEventListener('click', window.cancelReply);
}

// ── VIEWS (ZERO-FLICKER HARDWARE ACCELERATED) ─────────────────
let currentActiveView = 'prechat';

function showView(which) {
  const views = [
    { key: 'prechat', el: preChatView },
    { key: 'waiting', el: waitingView },
    { key: 'chat', el: activeChatView },
    { key: 'friends', el: friendsView },
    { key: 'friendDM', el: friendDMView },
    { key: 'settings', el: settingsView },
  ];

  const viewChanged = currentActiveView !== which;
  currentActiveView = which;

  views.forEach(({ key, el }) => {
    if (!el) return;
    const isTarget = key === which;
    if (isTarget) {
      el.style.display = 'flex';
      if (viewChanged) {
        el.classList.remove('view-enter');
        void el.offsetWidth;
        el.classList.add('view-enter');
      }
    } else {
      el.style.display = 'none';
      el.classList.remove('view-enter');
    }
  });

  // Show/hide home tabs — visible on ALL views except waiting
  const showTabs = (which === 'prechat' || which === 'friends' || which === 'friendDM' || which === 'chat' || which === 'settings');
  if (homeTabs) homeTabs.style.display = showTabs ? 'flex' : 'none';

  // Sync active tab highlight
  if (which === 'friendDM' || which === 'friends') {
    activeHomeTab = 'friends';
    if (tabFriends) tabFriends.classList.add('active');
    if (tabSettings) tabSettings.classList.remove('active');
    if (tabRandom) tabRandom.classList.remove('active');
  } else if (which === 'settings') {
    activeHomeTab = 'settings';
    if (tabSettings) tabSettings.classList.add('active');
    if (tabFriends) tabFriends.classList.remove('active');
    if (tabRandom) tabRandom.classList.remove('active');
  } else if (which === 'prechat' || which === 'chat' || which === 'waiting') {
    activeHomeTab = 'random';
    if (tabRandom) tabRandom.classList.add('active');
    if (tabSettings) tabSettings.classList.remove('active');
    if (tabFriends) tabFriends.classList.remove('active');
  }

  if (window.__pingSetAppMode) window.__pingSetAppMode(which);
}

// ── WAITING SCREEN ────────────────────────────────────────────
function updateWaitingScreen() {
  const el = $('waitingSubText');
  if (el) el.textContent = waitingTexts[waitingTextIdx];
  waitingTextIdx = (waitingTextIdx + 1) % waitingTexts.length;
}
function updateWaitElapsed() {
  const el = $('waitTimer');
  if (!el || !waitStartTime) return;
  const s = Math.floor((Date.now() - waitStartTime) / 1000);
  el.textContent = `${s}s`;
}
function stopWaitingScreen() {
  clearInterval(waitingTextInterval);
  clearInterval(waitElapsedInterval);
  waitStartTime = 0;
}
function startWaitingScreen() {
  stopWaitingScreen();
  waitingTextIdx = 0;
  updateWaitingScreen();
  waitingTextInterval = setInterval(updateWaitingScreen, 3000);
  waitStartTime = Date.now();
  updateWaitElapsed();
  waitElapsedInterval = setInterval(updateWaitElapsed, 1000);
}

// ── APPLY STATE ───────────────────────────────────────────────
function applyState(status, roomId = null) {
  if (currentChatType === 'friend' && (!status || status === 'idle')) {
    return;
  }

  isWaiting = status === 'waiting';
  inChat = status === 'matched';
  if (inChat) {
    if (roomId) activeRoomId = roomId;
    currentChatType = 'stranger';
  } else {
    activeRoomId = null;
    stopTimer();
  }

  if (isWaiting) startWaitingScreen();
  else stopWaitingScreen();

  syncButtons();

  if (status === 'waiting') showView('waiting');
  else if (status === 'matched') {
    showView('chat');
    if (autoSearchBar) autoSearchBar.style.display = 'none';
    stopAutoSearch();
  }
  else if (activeHomeTab === 'random' && currentChatType !== 'friend') {
    showView('prechat');
  }
}

// ── END CHAT ─────────────────────────────────────────────────
function endCurrentChat() {
  userInitiatedLeave = true;
  setTimeout(() => { userInitiatedLeave = false; }, 3000);
  pendingStart = false;
  isWaiting = false;
  inChat = false;
  activeRoomId = null;
  AppState.explore.inChat = false;
  AppState.explore.isWaiting = false;
  AppState.explore.roomId = null;
  AppState.explore.timerEndMs = 0;
  
  stopAutoSearch(); // Always kill the auto-search timer when ending any chat
  stopTimer();
  
  // Clear any pending message retry timers to eliminate timer memory leaks
  if (typeof messageRetryQueue !== 'undefined' && messageRetryQueue.size > 0) {
    messageRetryQueue.forEach(entry => {
      if (entry?.timer) clearTimeout(entry.timer);
    });
    messageRetryQueue.clear();
  }

  if (currentChatType === 'stranger') {
    currentChatType = 'stranger';
  }
  syncButtons();
  clearChat();
  if (partnerNameEl) partnerNameEl.textContent = 'Stranger';
  if (typingIndicator) typingIndicator.classList.remove('visible');
  if (isConnected) setConnStatus('connected');

  // Return to home screen (Random tab) if we are on the random tab
  if (activeHomeTab === 'random') {
    showView('prechat');
  }
}

function loadAndShowFriendsView() {
  socket.emit('get_friends', (data) => {
    renderFriendsList(data?.friends || []);
    showView('friends');
  });
}

function updateFriendsTabBadge() {
  const unreadCount = document.querySelectorAll('.friend-item.unread').length;
  let badge = tabFriends?.querySelector('.tab-badge');
  if (unreadCount > 0) {
    if (!badge && tabFriends) {
      badge = document.createElement('span');
      badge.className = 'tab-badge';
      tabFriends.appendChild(badge);
    }
    if (badge) badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
  } else if (badge) {
    badge.remove();
  }
}

function renderFriendsList(friends) {
  if (!friendsList) return;

  if (!friends || friends.length === 0) {
    friendsList.innerHTML = `
      <div class="friends-empty">
        <span class="friends-empty-icon">👥</span>
        <p>No connections yet</p>
        <p class="friends-empty-sub">Make friends during a chat to message them later</p>
        <button class="btn-primary btn-sm" id="findChatBtn2">Start Chat</button>
      </div>
    `;
    const findBtn2 = document.getElementById('findChatBtn2');
    if (findBtn2) {
      findBtn2.addEventListener('click', () => {
        switchHomeTab('random');
      });
    }
    updateFriendsTabBadge();
    return;
  }

  friendsList.innerHTML = friends.map(friend => {
    // Calculate longevity
    let longevity = 'New connection';
    if (friend.friendshipDate) {
      const days = Math.floor((Date.now() - new Date(friend.friendshipDate)) / (1000 * 60 * 60 * 24));
      if (days === 0) longevity = 'Added today';
      else if (days < 30) longevity = `Friend for ${days} days`;
      else longevity = `Friend for ${Math.floor(days / 30)} months`;
    }

    const deterministicRoomId = ['friend_chat', ...[selfUserId || persistentUserId || '', friend.friendId].sort()].join('_');

    return `
      <div class="friend-item ${friend.isTopFriend ? 'top-friend' : ''}" data-friend-id="${friend.friendId}" data-room-id="${friend.dmRoomId || deterministicRoomId}">
        <div class="friend-info">
          <div class="friend-avatar">
            👤
            <div class="friend-status ${friend.online ? '' : 'offline'}"></div>
            ${friend.isTopFriend ? '<div class="top-friend-badge" title="Top Friend! 🔥">🔥</div>' : ''}
            ${friend.isVerified ? '<div class="verified-badge-mini" title="Verified Human ✅">✅</div>' : ''}
          </div>
          <div class="friend-details">
            <div class="friend-name-row">
              <div class="friend-country">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:2px; opacity:0.7"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                ${friend.country}
              </div>
              <span class="friend-longevity">${longevity}</span>
            </div>
            <div class="friend-status-text ${friend.online ? '' : 'offline'}">
              ${friend.online ? (friend.isInvisible ? 'Offline' : `🟢 ${friend.activity || 'Active Now'}`) : 'Offline'}
            </div>
            <div class="friend-meta">${friend.lastMessage ? friend.lastMessage.slice(0, 44) : 'Continue your saved conversation'}</div>
          </div>
        </div>
        <div class="friend-actions">
          <button class="friend-msg-btn" title="Message" aria-label="Message friend">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Add event listeners to friend items to immediately open friend DM on click
  document.querySelectorAll('.friend-item').forEach(item => {
    const friendId = item.dataset.friendId;
    const msgBtn = item.querySelector('.friend-msg-btn');
    const openFriendDM = () => {
      item.classList.remove('unread');
      updateFriendsTabBadge();
      socket.emit('open_friend_dm', { friendId });
    };

    if (msgBtn) {
      msgBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openFriendDM();
      });
    }

    item.addEventListener('click', () => {
      openFriendDM();
    });
  });

  updateFriendsTabBadge();
}

// ── NAVIGATION ───────────────────────────────────────────────
function goToChat() {
  if (landingPage) landingPage.style.display = 'none';
  if (chatApp) {
    chatApp.style.display = 'flex';
    chatApp.style.opacity = '1';
  }
  showView('prechat');
  switchHomeTab('random');
  const ac = $('appCanvas');
  if (ac) { ac.width = ac.offsetWidth || innerWidth; ac.height = ac.offsetHeight || innerHeight; }
}

function goToLanding() {
  if (inChat || activeRoomId) {
    showConfirm('Leave Chat?', 'Going back home will end your current conversation. Are you sure?', () => {
      if (activeRoomId) {
        socket.emit('end_chat', { roomId: activeRoomId });
      }
      endCurrentChat();
      executeGoToLanding();
    });
    return;
  }
  if (isWaiting || AppState.explore.isWaiting) {
    if (typeof cancelWaitBtn?.click === 'function') {
      cancelWaitBtn.click();
    } else {
      socket.emit('cancel_wait');
      stopWaitingScreen();
    }
  }
  executeGoToLanding();
}

function executeGoToLanding() {
  if (chatApp) chatApp.style.display = 'none';
  if (landingPage) {
    landingPage.style.display = 'flex';
    landingPage.style.opacity = '1';
  }
}

startLandingBtn?.addEventListener('click', goToChat);
backBtn?.addEventListener('click', goToLanding);

// ── HOME TAB SWITCHING ────────────────────────────────────────
function switchHomeTab(tab) {
  // Update active tab state
  activeHomeTab = tab;
  AppState.activeTab = tab === 'random' ? 'EXPLORE' : (tab === 'settings' ? 'SETTINGS' : 'FRIENDS');

  // Update tab visual state
  if (tabRandom) tabRandom.classList.toggle('active', tab === 'random');
  if (tabSettings) tabSettings.classList.toggle('active', tab === 'settings');
  if (tabFriends) tabFriends.classList.toggle('active', tab === 'friends');

  if (tab === 'settings') {
    // ── Switch to Settings context ──
    stopAutoSearch();
    if (friendRoomId) {
      socket.emit('leave_friend_dm', { roomId: friendRoomId });
    }
    showView('settings');
    updateSettingsUI();
  } else if (tab === 'friends') {
    // ── Switch to Friends context ──
    // Matchmaking timers paused
    stopAutoSearch();

    // Show friends list
    socket.emit('get_friends', (data) => {
      renderFriendsList(data?.friends || []);
      if (friendRoomId) {
        showView('friendDM');
      } else {
        showView('friends');
      }
    });
  } else {
    // ── Switch to Explore (random) context ──
    // Leave any active friend_chat_ROOMID Socket.io room on the server
    if (friendRoomId) {
      socket.emit('leave_friend_dm', { roomId: friendRoomId });
    }

    // Reset Friend DM states
    friendRoomId = null;
    currentFriendId = null;
    try {
      localStorage.removeItem('ping_active_friend_id');
    } catch (e) {}

    // Clear Friends DM UI containers and clear preview replies
    clearFriendChat();
    window.cancelReply();
    stopAutoSearch();

    // If currently in an active explore chat, restore it!
    if (AppState.explore.inChat && AppState.explore.roomId) {
      // Re-establish socket room membership on server to prevent "room does not exist" errors
      socket.emit('rejoin_explore_room', { roomId: AppState.explore.roomId }, (ack) => {
        showView('chat');
        if (AppState.explore.timerEndMs) {
          startTimer(AppState.explore.timerEndMs);
        }
        syncButtons();
      });
    } else if (AppState.explore.isWaiting) {
      showView('waiting');
      syncButtons();
    } else {
      pendingStart = false;
      isWaiting = false;
      AppState.explore.inChat = false;
      AppState.explore.isWaiting = false;
      showView('prechat');
      syncButtons();
    }
  }
}

tabRandom?.addEventListener('click', () => switchHomeTab('random'));
tabSettings?.addEventListener('click', () => switchHomeTab('settings'));
tabFriends?.addEventListener('click', () => switchHomeTab('friends'));

// ═══════════════════════════════════════════════
//  SOCKET LIFECYCLE & EVENT HANDLERS
// ═══════════════════════════════════════════════

function handleSuccessfulConnection() {
  const wasReconnecting = isReconnecting || !isConnected;
  isConnected = true;
  isReconnecting = false;
  hasErrShown = false;

  // 1. Immediately update connection state badge and hide offline status
  setConnStatus('connected');
  hideNetworkStatus(0);

  // 2. Synchronize interactive button states (enables Start Chat immediately)
  syncButtons();

  if (wasReconnecting) {
    showNetworkStatus('⚡ Connected! Everything is in sync.', 'connected');
    hideNetworkStatus(2000);
  }

  // 3. Auto-rejoin active friend chat room on page load/reconnection if previously open
  const activeFriendId = localStorage.getItem('ping_active_friend_id') || currentFriendId;
  socket.emit('authenticate', { userId: AppState.user.id, activeFriendId }, (authRes) => {
    if (activeFriendId) {
      currentFriendId = activeFriendId;
      socket.emit('open_friend_dm', { friendId: activeFriendId });
    }
  });

  // 4. Request authoritative status from server
  socket.emit('get_status', (state) => {
    if (state && state.status) {
      if (state.status === 'matched' && state.roomId) {
        if (!activeFriendId) {
          activeRoomId = state.roomId;
          inChat = true;
          isWaiting = false;
          showView('chat');
          if (wasReconnecting && lastKnownRoomId) {
            appendMsg('⚡ Connection restored! You are back in the chat.', { isSystem: true, variant: 'success' });
          }
        }
      } else if (state.status === 'waiting') {
        if (!activeFriendId) applyState('waiting');
      } else if (state.status === 'idle') {
        if (wasReconnecting && lastKnownRoomId && inChat && !activeFriendId) {
          endCurrentChat();
          appendMsg('Chat ended while connection was lost ✌️', { isSystem: true });
        }
      }
    }
    lastKnownRoomId = null;
    syncButtons();
  });

  // 5. Fetch metrics without overriding user room state
  socket.emit('get_stats', (s) => {
    if (s && typeof s.activeUsers === 'number') {
      setOnlineCount(s.activeUsers);
    }
  });

  startHeartbeat();
}

socket.off('connect');
socket.on('connect', () => {
  console.log('[Ping] Socket connected successfully, id:', socket.id, 'transport:', socket.io?.engine?.transport?.name);
  handleSuccessfulConnection();
});

// In Socket.IO v4, reconnection lifecycle is managed by socket.io
if (socket.io) {
  socket.io.off('reconnect');
  socket.io.on('reconnect', (attemptNumber) => {
    console.log('[Ping] Reconnected successfully after attempt:', attemptNumber);
    handleSuccessfulConnection();
  });

  socket.io.off('reconnect_attempt');
  socket.io.on('reconnect_attempt', (attemptNumber) => {
    console.log('[Ping] Reconnection attempt:', attemptNumber);
    isReconnecting = true;
    setConnStatus('disconnected');
    syncButtons();
    showNetworkStatus(`Connection lost. Reconnecting (attempt ${attemptNumber})…`, 'warning');
  });

  socket.io.off('reconnect_error');
  socket.io.on('reconnect_error', (err) => {
    const msg = err?.message || err;
    if (msg === 'websocket error') {
      console.warn('[Ping] Socket transport notice (polling fallback active):', msg);
    } else {
      console.error('[Ping] Socket reconnection error:', msg);
    }
    isReconnecting = true;
    setConnStatus('disconnected');
    syncButtons();
    showNetworkStatus('Connection lost. Still trying to reconnect…', 'error');
  });

  socket.io.off('reconnect_failed');
  socket.io.on('reconnect_failed', () => {
    console.error('[Ping] Socket reconnection failed');
    isReconnecting = false;
    setConnStatus('disconnected');
    syncButtons();
    showNetworkStatus('Unable to reach server. Please check your connection.', 'error');
    if (inChat) {
      endCurrentChat();
      showToast('Could not reconnect. Chat ended.', 'error');
    }
  });
}

socket.off('disconnect');
socket.on('disconnect', (reason) => {
  console.warn('[Ping] Socket disconnected. Reason:', reason);
  isConnected = false;
  isReconnecting = true;
  stopHeartbeat();

  // Store the current room ID in case we reconnect to the same session
  if (inChat && activeRoomId) {
    lastKnownRoomId = activeRoomId;
    console.log('[Ping] Disconnected during chat, preserving session. Room:', lastKnownRoomId);
  }

  setConnStatus('disconnected');
  syncButtons();
  
  if (reason !== 'io client namespace disconnect' && reason !== 'io server namespace disconnect') {
    showNetworkStatus('Connection lost. Reconnecting to server…', 'error');
  }
});

socket.off('connect_error');
socket.on('connect_error', (error) => {
  const msg = error?.message || error;
  if (typeof msg === 'string' && msg.includes('TEMPORARY_BAN:')) {
    const minutes = parseInt(msg.split('TEMPORARY_BAN:')[1], 10) || 15;
    let overlay = document.getElementById('temporaryBanOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'temporaryBanOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background-color:rgba(5,5,14,0.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;';
      overlay.innerHTML = `
        <div style="max-width:460px;width:100%;background-color:#0c0c1e;border:1px solid rgba(239,68,68,0.35);border-radius:20px;padding:36px 28px;text-align:center;box-shadow:0 25px 60px rgba(0,0,0,0.7), 0 0 35px rgba(239,68,68,0.15);display:flex;flex-direction:column;align-items:center;gap:16px;">
          <div style="width:60px;height:60px;border-radius:50%;background-color:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);display:flex;align-items:center;justify-content:center;font-size:28px;">🚫</div>
          <h2 style="color:#ffffff;font-family:'Space Grotesk',sans-serif;font-size:1.45rem;font-weight:700;margin:0;">Access Suspended</h2>
          <p id="temporaryBanMsgText" style="color:#f87171;font-family:'Space Grotesk',sans-serif;font-size:1.1rem;line-height:1.5;margin:0;font-weight:600;">Suspended for ${minutes} minutes due to community reports</p>
          <p style="color:#94a3b8;font-size:0.875rem;line-height:1.5;margin:0;">Matchmaking and chatting are temporarily disabled. Your access will automatically resume when this suspension expires.</p>
        </div>
      `;
      document.body.appendChild(overlay);
    } else {
      const msgText = document.getElementById('temporaryBanMsgText');
      if (msgText) msgText.textContent = `Suspended for ${minutes} minutes due to community reports`;
      overlay.style.display = 'flex';
    }
    document.querySelectorAll('#start-chat-btn, #startBtn, #startLandingBtn, #findChatBtn').forEach((btn) => {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
      btn.style.pointerEvents = 'none';
    });
    return;
  }
  if (msg === 'websocket error') {
    console.warn('[Ping] Socket connection notice (polling fallback active):', msg);
  } else {
    console.error('[Ping] Socket connection error:', msg);
  }
  isConnected = false;
  isReconnecting = true;
  setConnStatus('disconnected');
  syncButtons();
  if (!navigator.onLine) {
    showNetworkStatus('You are currently offline. Check your internet connection.', 'error');
  } else {
    showNetworkStatus('Connection issue. Reconnecting to server…', 'warning');
  }
});

socket.off('self');
socket.on('self', ({ userId }) => {
  selfUserId = userId;
  const activeFriendId = localStorage.getItem('ping_active_friend_id') || currentFriendId;
  if (activeFriendId) {
    socket.emit('open_friend_dm', { friendId: activeFriendId });
  }
});

socket.off('state_update');
socket.on('state_update', ({ status, roomId }) => applyState(status, roomId));

socket.off('queue_joined');
socket.on('queue_joined', () => {
  pendingStart = false;
  isWaiting = true;
  AppState.explore.isWaiting = true;
  if (AppState.activeTab === 'EXPLORE') {
    showView('waiting');
  }
  syncButtons();
});

socket.off('queue_rejected');
socket.on('queue_rejected', ({ reason, message }) => {
  pendingStart = false;
  isWaiting = false;
  AppState.explore.isWaiting = false;
  if (reason === 'banned') {
    showToast(message || '🚫 Matchmaking suspended.', 'error', 4000);
  } else if (reason !== 'already_queued' && reason !== 'already_waiting') {
    if (!inChat && AppState.activeTab === 'EXPLORE') {
      showView('prechat');
    }
  }
  syncButtons();
});

socket.off('system_metrics');
socket.on('system_metrics', m => {
  const u = Number(m?.activeUsers ?? m?.liveUsers ?? 1);
  setOnlineCount(u);
});

socket.off('onlineCount');
socket.on('onlineCount', c => {
  const u = typeof c === 'number' ? c : (c?.count ?? 1);
  setOnlineCount(u);
});

socket.off('count');
socket.on('count', c => {
  const u = typeof c === 'number' ? c : (c?.count ?? 1);
  setOnlineCount(c);
});

// ── INTEREST TAGS & ICEBREAKERS ────────────────────────────────
let selectedInterests = new Set();
let currentMatchedInterestTag = null;

try {
  const saved = localStorage.getItem('ping_selected_interests');
  if (saved) {
    const arr = JSON.parse(saved);
    if (Array.isArray(arr)) arr.slice(0, 3).forEach(t => selectedInterests.add(t));
  }
} catch (e) {}

function initInterestGridUI() {
  const grid = document.getElementById('interestPillGrid');
  if (!grid) return;
  const pills = grid.querySelectorAll('.interest-pill');
  pills.forEach(pill => {
    const tag = pill.dataset.tag;
    if (tag && selectedInterests.has(tag)) {
      pill.classList.add('active');
    }
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      if (selectedInterests.has(tag)) {
        selectedInterests.delete(tag);
        pill.classList.remove('active');
      } else {
        if (selectedInterests.size >= 3) {
          showToast("⚠️ Can't select more than 3 tags", "warn", 2500);
          if (navigator.vibrate) navigator.vibrate([25, 40, 25]);
          return;
        }
        selectedInterests.add(tag);
        pill.classList.add('active');
      }
      try {
        localStorage.setItem('ping_selected_interests', JSON.stringify([...selectedInterests]));
      } catch (err) {}
      if (navigator.vibrate) navigator.vibrate(15);
    });
  });
}

const TAG_ICEBREAKERS = {
  movies: [
    "What's a movie you can rewatch 100 times without getting bored?",
    "What's the best movie plot twist you never saw coming?",
    "What movie soundtrack or score gives you chills every time?",
    "If you could live inside any movie universe, which one would it be?",
    "What's an overrated movie that everyone loves but you secretly dislike?",
    "Who is your absolute favorite actor or movie director of all time?",
    "What's the scariest or most intense horror movie you've ever seen?",
    "If they made a movie about your life, who should play you?"
  ],
  music: [
    "Who is your top artist or favorite album right now?",
    "What's a song that always puts you in a good mood instantly?",
    "What was the first concert or live music event you ever attended?",
    "What's a genre or song you secretly love but don't tell many people about?",
    "If you could see any musician live, dead or alive, who would it be?",
    "What song lyrics hit you the hardest personally?",
    "Do you prefer listening to music on headphones or speakers?",
    "What's the late-night song you listen to when you're introspective?"
  ],
  gaming: [
    "PC, Console, or Mobile? What game are you playing lately?",
    "What's a game you have put 100+ hours into?",
    "What's your all-time favorite video game storyline or character?",
    "Co-op multiplayer or single-player story mode?",
    "What's the hardest video game boss or level you ever beat?",
    "What's a nostalgic game from your childhood you miss playing?",
    "If you could live in any video game world, which game would it be?",
    "What upcoming video game release are you most excited for?"
  ],
  tech: [
    "What's the coolest gadget or AI tool you've used recently?",
    "If you could invent any futuristic technology today, what would it be?",
    "What app on your phone do you use the most every single day?",
    "Do you think AI will replace smartphones in 10 years?",
    "What's the most useful tech hack or shortcut you use daily?",
    "Apple or Android? Defend your choice in one sentence!",
    "If you could telepathically control one device in your room, what is it?",
    "What's the most mind-blowing piece of technology you've seen recently?"
  ],
  studies: [
    "What field or subject are you studying or super passionate about?",
    "What's a fascinating fact you learned recently that blew your mind?",
    "If you could master any skill or degree overnight, what would it be?",
    "What was your favorite subject in high school or college?",
    "Do you study better late at night or early in the morning?",
    "What's a topic you could give an impromptu 15-minute presentation on?",
    "What's the hardest exam or subject you ever successfully passed?",
    "What's an underrated area of science or history you find super cool?"
  ],
  sports: [
    "What sport or team do you follow most passionately?",
    "What's the most legendary sporting moment you've ever watched live?",
    "Do you prefer playing sports or watching them?",
    "Who is your favorite athlete or sports icon of all time?",
    "What workout or exercise routine keeps you most active?",
    "What's an extreme sport you would love to try if safety was guaranteed?",
    "Football/Soccer, Basketball, or F1? Which one takes top priority?",
    "What's the best stadium or arena environment you've ever experienced?"
  ],
  food: [
    "What's your ultimate go-to comfort food at 2 AM?",
    "What's a food everyone loves that you personally can't stand?",
    "If you could only eat one cuisine for the rest of your life, what is it?",
    "What's the most unique or unusual dish you've ever tried?",
    "Are you a master chef or do you struggle with basic microwave meals?",
    "Sweet or savory snacks when you're binge-watching something?",
    "What's your dream 3-course meal if price didn't matter?",
    "Coffee, Tea, or Boba? What's your daily caffeine fix?"
  ],
  travel: [
    "If you could hop on a plane anywhere right now, where would you go?",
    "What's the most beautiful place you've ever visited in person?",
    "Do you prefer relaxing beach vacations or exploring big cities?",
    "What's top 1 on your travel bucket list?",
    "What's the craziest or funniest travel story you have?",
    "Solo traveling or group trip with best friends?",
    "What culture or country's tradition do you find most interesting?",
    "Mountains and nature, or historical historic cities?"
  ]
};

const GENERAL_ICEBREAKERS_LIST = [
  "What's the most underrated thing that happened to you this week?",
  "If you could have any superpower for 24 hours, what would it be?",
  "What's your ultimate comfort show or movie?",
  "What's something you're really looking forward to right now?",
  "Tell me one true story and one lie about your day!",
  "What's the funniest meme or video you've seen recently?",
  "If you could ask a time-traveler from 2050 one question, what would it be?",
  "What's a random habit or quirk you have that most people don't know?"
];

function initDicePromptHandler() {
  const diceBtn = document.getElementById('dicePromptBtn');
  if (!diceBtn) return;
  diceBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!messageInput || messageInput.disabled) return;

    // Trigger instant roll animation on every click
    diceBtn.classList.remove('rolling');
    void diceBtn.offsetWidth; // force reflow
    diceBtn.classList.add('rolling');

    let pool = [];
    if (currentMatchedInterestTag && TAG_ICEBREAKERS[currentMatchedInterestTag]) {
      pool = TAG_ICEBREAKERS[currentMatchedInterestTag];
    } else {
      const userSelected = Array.from(selectedInterests);
      if (userSelected.length > 0) {
        userSelected.forEach(tag => {
          if (TAG_ICEBREAKERS[tag]) pool.push(...TAG_ICEBREAKERS[tag]);
        });
      }
    }

    if (pool.length === 0) {
      pool = GENERAL_ICEBREAKERS_LIST;
    }

    let randomPrompt = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && randomPrompt === messageInput.value) {
      const filtered = pool.filter(p => p !== messageInput.value);
      if (filtered.length > 0) {
        randomPrompt = filtered[Math.floor(Math.random() * filtered.length)];
      }
    }

    messageInput.value = randomPrompt;
    messageInput.dispatchEvent(new Event('input'));
    if (sendBtn) sendBtn.disabled = false;
    messageInput.focus();
    if (navigator.vibrate) navigator.vibrate(18);

    setTimeout(() => {
      diceBtn.classList.remove('rolling');
    }, 450);
  });
}

function renderMatchedInterestBanner(label, icebreaker) {
  if (!chatBox) return;
  const existing = document.getElementById('matchedInterestBanner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'matchedInterestBanner';
  banner.className = 'matched-interest-banner glass-card';

  const titleText = label ? `Matched via ${label}` : `✨ Conversation Starter`;

  banner.innerHTML = `
    <div class="mib-top">
      <span class="mib-sparkle">✨</span>
      <span>${escapeHtml(titleText)}</span>
    </div>
    <p class="mib-icebreaker">"${escapeHtml(icebreaker)}"</p>
    <button type="button" class="mib-use-btn" id="useIcebreakerBtn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
      <span>Use Icebreaker</span>
    </button>
  `;

  const useBtn = banner.querySelector('#useIcebreakerBtn');
  const applyIcebreaker = () => {
    if (messageInput && !messageInput.disabled) {
      messageInput.value = icebreaker;
      messageInput.dispatchEvent(new Event('input'));
      if (sendBtn) sendBtn.disabled = false;
      messageInput.focus();
      banner.remove(); // Remove conversation starter card once used
    }
  };

  if (useBtn) useBtn.addEventListener('click', applyIcebreaker);
  banner.addEventListener('click', (e) => {
    if (e.target !== useBtn && !useBtn.contains(e.target)) {
      applyIcebreaker();
    }
  });

  const empty = chatBox.querySelector('.msgs-empty');
  if (empty) empty.remove();

  chatBox.appendChild(banner);
  scrollToBottom(chatBox);
}

document.addEventListener('DOMContentLoaded', () => {
  initInterestGridUI();
  initDicePromptHandler();
});

socket.off('matched');
socket.on('matched', ({ roomId, endAt, expiresInMs, partnerCountry: pc, matchedInterest, matchedInterestLabel, icebreaker, fallbackMessage }) => {
  pendingStart = false;
  clearChat();
  currentMatchedInterestTag = matchedInterest || null;
  AppState.explore.roomId = roomId;
  AppState.explore.inChat = true;
  AppState.explore.isWaiting = false;
  AppState.explore.timerEndMs = Number(endAt) || Date.now() + (Number(expiresInMs) || 180000);

  applyState('matched', roomId);
  const displayLocation = formatPartnerLocation(pc) || '🇮🇳 India (Karnataka)';
  if (partnerNameEl) {
    partnerNameEl.innerHTML = `<span class="location-flag">${displayLocation.split(' ')[0]}</span> ${displayLocation.split(' ').slice(1).join(' ') || 'Stranger'}`;
  }
  if (partnerCountryLabel && partnerCountryLabel !== partnerNameEl) {
    partnerCountryLabel.innerHTML = partnerNameEl ? partnerNameEl.innerHTML : displayLocation;
  }

  appendMsg(`Connected to ${displayLocation}. Say hi! 👋✨`, { isSystem: true, variant: 'success' });

  // If cross-tag fallback intermatch occurred, display inline notice on screen (no popup)
  if (fallbackMessage) {
    appendMsg(`ℹ️ ${fallbackMessage}`, { isSystem: true, variant: 'warn' });
  }

  // Render Matched Interest Banner if available
  if (icebreaker) {
    renderMatchedInterestBanner(matchedInterestLabel, icebreaker);
  }

  startTimer(AppState.explore.timerEndMs);
  if (window.__pingMatchBurst) window.__pingMatchBurst();
});

socket.off('new_message');
socket.on('new_message', (payload) => {
  if (AppState.activeTab !== 'EXPLORE') return;
  const { from, message, roomId } = payload;
  const isMe = (from === socket.id || from === persistentUserId || from === selfUserId || (AppState.user.id && from === AppState.user.id));
  if (isMe) return; // Optimistically rendered.

  // Remove icebreaker banner as soon as conversation starts from either partner
  const banner = document.getElementById('matchedInterestBanner');
  if (banner) banner.remove();

  let processedReplyTo = null;
  if (payload.replyTo) {
    const isReplyingToMe = (isMe === payload.replyTo.wasSender);
    processedReplyTo = {
      text: payload.replyTo.text,
      isPartner: !isReplyingToMe
    };
  }

  appendMsg(message, {
    isSelf: false,
    isPartner: true,
    replyTo: processedReplyTo,
    isFlash: payload.isFlash,
    msgId: payload.msgId,
    sentAt: payload.sentAt
  });

  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && inChat) {
    socket.emit('mark_read', { roomId: activeRoomId });
  }
});

socket.off('message_seen');
socket.on('message_seen', () => {
  // Checkmarks removed
});

function handleIncomingDm(payload) {
  const { from, fromUserId, message, roomId, replyTo } = payload;
  const senderId = fromUserId || from;
  const isMe = (from === socket.id || senderId === persistentUserId || senderId === selfUserId || (AppState.user.id && (senderId === AppState.user.id || from === AppState.user.id)));

  // 1. Update friends list preview if visible
  const item = document.querySelector(`.friend-item[data-room-id="${roomId}"]`) ||
    document.querySelector(`.friend-item[data-friend-id="${senderId}"]`) ||
    document.querySelector(`.friend-item[data-friend-id="${from}"]`);

  if (item) {
    const meta = item.querySelector('.friend-meta');
    if (meta && message) meta.textContent = message.slice(0, 44) + (message.length > 44 ? '...' : '');

    // Add unread indicator if not currently inside this friend DM
    if (currentChatType !== 'friend' || roomId !== friendRoomId) {
      item.classList.add('unread');
      updateFriendsTabBadge();
    }
  }

  if (isMe) return;

  // 2. If currently in this active DM view, append message directly
  if (currentChatType === 'friend' && roomId === friendRoomId) {
    let processedReplyTo = null;
    if (replyTo) {
      processedReplyTo = {
        text: replyTo.text,
        wasSender: !replyTo.wasSender // inverted since it's the other person
      };
    }
    appendFriendMsg(message, {
      isSelf: false,
      isPartner: true,
      replyTo: processedReplyTo,
      isFlash: payload.isFlash,
      msgId: payload.msgId,
      sentAt: payload.sentAt,
      isEdited: payload.isEdited
    });

    // Directly persist to Cloud Firestore for recipient backup
    if (AppState.user.isAuthenticated && dbInstance && senderId) {
      try {
        const canonicalChatId = [AppState.user.id, senderId].sort().join('__');
        const mId = payload.msgId || ('f_' + Date.now());
        dbInstance.collection('friend_chats').doc(canonicalChatId).collection('messages').doc(mId).set({
          messageId: mId,
          chatId: canonicalChatId,
          fromUserId: senderId,
          message: payload.message,
          replyTo: processedReplyTo || null,
          isFlash: Boolean(payload.isFlash),
          sentAt: payload.sentAt || Date.now(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(() => {});
      } catch (_) {}
    }
  }
}

socket.off('new_dm').on('new_dm', handleIncomingDm);
socket.off('dm_message').on('dm_message', handleIncomingDm);

socket.off('friend_dm_notification').on('friend_dm_notification', (payload) => {
  const { from, fromUserId, message, roomId, friendCountry } = payload;
  const senderId = fromUserId || from;
  const isMe = (from === socket.id || senderId === persistentUserId || senderId === selfUserId || (AppState.user.id && (senderId === AppState.user.id || from === AppState.user.id)));
  if (isMe) return;

  // 1. Update friends list item preview and unread status if present
  const item = document.querySelector(`.friend-item[data-room-id="${roomId}"]`) ||
    document.querySelector(`.friend-item[data-friend-id="${senderId}"]`) ||
    document.querySelector(`.friend-item[data-friend-id="${payload.friendId}"]`);

  if (item) {
    const meta = item.querySelector('.friend-meta');
    if (meta && message) meta.textContent = message.slice(0, 44) + (message.length > 44 ? '...' : '');
    if (currentChatType !== 'friend' || roomId !== friendRoomId) {
      item.classList.add('unread');
    }
  }

  // 2. If not currently chatting with this friend, show badge and notification toast
  if (currentChatType !== 'friend' || roomId !== friendRoomId) {
    updateFriendsTabBadge();
    const senderTitle = friendCountry ? `Friend (${friendCountry})` : 'Friend';
    const preview = message && message.length > 35 ? `${message.slice(0, 35)}...` : message;
    showToast(`💬 ${senderTitle}: ${preview}`, 'info', 4000);
  }
});

socket.off('dm_partner_typing').on('dm_partner_typing', ({ roomId, isTyping, fromUserId }) => {
  // 1. Update active DM view if open
  if (friendTypingMeta && roomId === friendRoomId) {
    const show = Boolean(isTyping);
    friendTypingMeta.classList.toggle('visible', show);
    friendTypingMeta.style.display = '';
    if (show) scrollToBottom(friendChatBox);
  }

  // 2. Update friends list item if visible
  const item = document.querySelector(`.friend-item[data-room-id="${roomId}"]`) ||
    document.querySelector(`.friend-item[data-friend-id="${fromUserId}"]`);
  if (item) {
    const details = item.querySelector('.friend-details');
    let typingInd = item.querySelector('.list-typing-indicator');
    if (isTyping) {
      if (!typingInd) {
        typingInd = document.createElement('span');
        typingInd.className = 'list-typing-indicator';
        typingInd.textContent = 'typing...';
        details?.appendChild(typingInd);
      }
    } else {
      typingInd?.remove();
    }
  }
});

socket.off('partner_typing');
socket.on('partner_typing', ({ isTyping }) => {
  if (AppState.activeTab !== 'EXPLORE') return;
  if (!typingIndicator) return;
  const show = Boolean(isTyping && inChat);
  typingIndicator.classList.toggle('visible', show);
  // Smoothly scroll so the typing indicator is visible
  if (show) scrollToBottom(chatBox);
});

window.forceNextChat = () => {
  stopAutoSearch();
  if (currentChatType === 'stranger') {
    socket.emit('next_chat', { autoStart: true });
    appendMsg('Neural search initiated... 🔍', { isSystem: true });
  }
};

let autoSearchInterval = null;
let autoSearchTimerSeconds = 15;

let userInitiatedLeave = false;
let userInitiatedSkip = false;

function startAutoSearch(seconds = 15) {
  stopAutoSearch();
  autoSearchTimerSeconds = seconds;

  const bar = document.getElementById('autoSearchBar');
  const statusText = document.getElementById('autoSearchStatus');
  const timerCount = document.getElementById('autoSearchTimerCount');

  if (bar) bar.style.display = 'flex';
  if (statusText) {
    statusText.textContent = 'Stranger left the screen';
  }
  if (timerCount) {
    timerCount.textContent = `${autoSearchTimerSeconds}s`;
  }

  autoSearchInterval = setInterval(() => {
    autoSearchTimerSeconds -= 1;
    const remaining = Math.max(0, autoSearchTimerSeconds);
    if (timerCount) {
      timerCount.textContent = `${remaining}s`;
    }

    if (autoSearchTimerSeconds <= 0) {
      stopAutoSearch();
      showToast('🔍 Searching for a new stranger...', 'info', 2000);
      forceNextChat();
    }
  }, 1000);
}

function stopAutoSearch() {
  if (autoSearchInterval) {
    clearInterval(autoSearchInterval);
    autoSearchInterval = null;
  }
  const bar = document.getElementById('autoSearchBar');
  if (bar) bar.style.display = 'none';
}

function showStrangerDisconnectedPopup() {
  closeModal();
  startAutoSearch(15);
}

let isHandlingTimeExpired = false;
function handleTimeExpired() {
  if (isHandlingTimeExpired) return;
  if (!inChat && !AppState.explore.inChat && !activeRoomId) return;

  isHandlingTimeExpired = true;
  closeModal();
  stopTimer();
  stopAutoSearch();

  const closingRoomId = activeRoomId || AppState.explore.roomId;
  if (closingRoomId) {
    socket.emit('end_chat', { roomId: closingRoomId });
  }

  // Close the room and reset UI immediately, returning to prechat (do not auto connect)
  inChat = false;
  activeRoomId = null;
  AppState.explore.inChat = false;
  AppState.explore.isWaiting = false;
  AppState.explore.roomId = null;
  AppState.explore.timerEndMs = 0;
  pendingStart = false;
  isWaiting = false;

  if (autoSearchBar) autoSearchBar.style.display = 'none';
  syncButtons();
  clearChat();
  if (partnerNameEl) partnerNameEl.textContent = 'Stranger';

  appendMsg("⏳ Time's up! Room closed. Click Start Chat to chat again.", { isSystem: true, variant: 'warn' });

  // Return to prechat view and let the user click Start Chat to chat again
  showView('prechat');

  setTimeout(() => {
    isHandlingTimeExpired = false;
  }, 1200);
}

function handleSkippedChat(reason, rawReason) {
  if (isReconnecting) return;
  stopTimer();

  const wasInChat = inChat || AppState.explore.inChat || activeRoomId;
  inChat = false;
  activeRoomId = null;
  AppState.explore.inChat = false;
  AppState.explore.roomId = null;
  AppState.explore.timerEndMs = 0;

  stopWaitingScreen();
  if (partnerNameEl) partnerNameEl.textContent = 'Stranger';

  syncButtons();

  // If local user skipped/left, go to prechat immediately
  if (userInitiatedLeave || userInitiatedSkip) {
    userInitiatedLeave = false;
    userInitiatedSkip = false;
    stopAutoSearch();
    closeModal();
    clearChat();
    showView('prechat');
    return;
  }

  // When stranger skips, load the searching screen without duplicate popup
  stopAutoSearch();
  closeModal();
  clearChat();

  isWaiting = true;
  AppState.explore.isWaiting = true;
  pendingStart = true;
  showView('waiting');
  startWaitingScreen();
  syncButtons();
  socket.emit('start_chat');

  setTimeout(() => {
    pendingStart = false;
    syncButtons();
  }, 1000);
}

function handleChatEnd(reason, rawReason) {
  if (isReconnecting) return;
  closeModal();
  stopTimer();

  // Reset UI states
  if (friendBtn) friendBtn.disabled = true;
  if (reportBtn) reportBtn.disabled = true;
  if (extendTimeBtn) extendTimeBtn.disabled = true;

  const wasInChat = inChat || AppState.explore.inChat || activeRoomId;
  inChat = false;
  activeRoomId = null;
  AppState.explore.inChat = false;
  AppState.explore.isWaiting = false;
  AppState.explore.roomId = null;
  AppState.explore.timerEndMs = 0;
  syncButtons();

  if (partnerNameEl) partnerNameEl.textContent = 'Stranger';

  // If local user left/skipped, go to prechat immediately
  if (userInitiatedLeave || userInitiatedSkip) {
    userInitiatedLeave = false;
    userInitiatedSkip = false;
    stopAutoSearch();
    clearChat();
    showView('prechat');
    return;
  }

  const reasonStr = String(reason || rawReason || '').toLowerCase();
  if (reasonStr.includes('user_reported_warning')) {
    showToast('⚠️ You were reported by your chat partner. Returned to home screen.', 'warn', 5000);
    showView('prechat');
    return;
  }
  if (reasonStr.includes('report_submitted') || reasonStr === 'user_reported') {
    showToast('User reported. Returned to home screen.', 'info', 3500);
    showView('prechat');
    return;
  }
  if (reasonStr.includes('next_clicked') || reasonStr.includes('skipped') || reasonStr.includes('skip')) {
    handleSkippedChat(reason, rawReason);
    return;
  }
  if (reasonStr.includes('queue') || reasonStr === 'left_queue' || reasonStr === 'you_ended') {
    showView('prechat');
    return;
  }
  if (reasonStr.includes("time's up") || reasonStr.includes('time_expired')) {
    showView('prechat');
    return;
  }

  // When stranger leaves/disconnects, show 15s auto-search countdown banner
  if (wasInChat) {
    startAutoSearch(15);
  } else {
    showView('prechat');
  }
}

socket.off('chat_end');
socket.off('chat_ended');
let lastEndChatHandledMs = 0;
const handleGenericChatEnd = ({ reason, rawReason, message }) => {
  if (AppState.activeTab !== 'EXPLORE') return;
  const endReason = reason || rawReason;
  if (endReason === 'user_reported_warning' || rawReason === 'user_reported_warning' || String(endReason).includes('user_reported_warning')) {
    stopTimer();
    stopAutoSearch();
    closeModal();
    inChat = false;
    activeRoomId = null;
    AppState.explore.inChat = false;
    AppState.explore.isWaiting = false;
    AppState.explore.roomId = null;
    AppState.explore.timerEndMs = 0;
    isWaiting = false;
    stopWaitingScreen();
    clearChat();
    syncButtons();
    showView('prechat');
    showToast('⚠️ You were reported by your chat partner. Please follow community guidelines.', 'warn', 5000);
    return;
  }
  if (endReason === 'report_submitted' || endReason === 'user_reported' || rawReason === 'report_submitted' || rawReason === 'user_reported') {
    stopTimer();
    stopAutoSearch();
    closeModal();
    inChat = false;
    activeRoomId = null;
    AppState.explore.inChat = false;
    AppState.explore.isWaiting = false;
    AppState.explore.roomId = null;
    AppState.explore.timerEndMs = 0;
    isWaiting = false;
    stopWaitingScreen();
    clearChat();
    syncButtons();
    showView('prechat');
    showToast('User reported. Returned to home screen.', 'info', 3500);
    return;
  }
  if (endReason === 'left_queue' || rawReason === 'left_queue' || String(endReason).toLowerCase().includes('queue')) {
    stopTimer();
    stopAutoSearch();
    inChat = false;
    activeRoomId = null;
    AppState.explore.inChat = false;
    AppState.explore.isWaiting = false;
    AppState.explore.roomId = null;
    AppState.explore.timerEndMs = 0;
    isWaiting = false;
    stopWaitingScreen();
    showView('prechat');
    syncButtons();
    // Do NOT show any toast or popup for leaving queue
    return;
  }

  // Deduplicate rapid successive end events for the same chat
  const now = Date.now();
  if (now - lastEndChatHandledMs < 2000 && !inChat && !activeRoomId) {
    return;
  }
  lastEndChatHandledMs = now;

  if (rawReason === 'time_expired' || (typeof reason === 'string' && (reason.toLowerCase().includes("time's up") || reason.toLowerCase().includes("time_expired")))) {
    handleTimeExpired();
    return;
  }
  if (rawReason === 'next_clicked' || (typeof reason === 'string' && (reason.toLowerCase().includes('skipped') || reason.toLowerCase().includes('next')))) {
    handleSkippedChat(reason, rawReason);
    return;
  }
  handleChatEnd(message || reason, rawReason || reason);
};
socket.on('chat_end', handleGenericChatEnd);
socket.on('chat_ended', handleGenericChatEnd);

socket.off('partner_disconnected');
socket.on('partner_disconnected', ({ roomId, message }) => {
  if (AppState.activeTab !== 'EXPLORE') return;
  startAutoSearch(15);
  if (messageInput) {
    messageInput.disabled = true;
    messageInput.placeholder = 'Stranger left the screen...';
  }
});

socket.off('partner_reconnected');
socket.on('partner_reconnected', () => {
  if (AppState.activeTab !== 'EXPLORE') return;
  stopAutoSearch();
  inChat = true;
  syncButtons();
  if (autoSearchBar) autoSearchBar.style.display = 'none';
  if (messageInput) {
    messageInput.disabled = false;
    messageInput.placeholder = 'Type a message…';
  }
  appendMsg('⚡ Partner reconnected! Keep chatting ✨', { isSystem: true, variant: 'success' });
});

socket.off('warning_message');
socket.on('warning_message', ({ message }) => {
  if (!message) return;
  // Backend already formats the message with emoji prefix — display as-is
  appendMsg(message, { isSystem: true, variant: 'warn' });
  if (currentChatType === 'friend') {
    appendFriendMsg(message, { isSystem: true, variant: 'warn' });
  }
});

socket.off('error_message');
socket.on('error_message', ({ message, action, duration }) => {
  if (!message) return;

  // Backend already formats the message with emoji prefix — display as-is
  appendMsg(message, { isSystem: true, variant: 'error' });
  if (currentChatType === 'friend') {
    appendFriendMsg(message, { isSystem: true, variant: 'error' });
  }
});

socket.off('message_rejected');
socket.on('message_rejected', ({ message, reason }) => {
  if (!message) return;
  if (reason && (reason.startsWith('strike_') || reason === 'banned_15min')) {
    return; // Already rendered by warning_message or chat_ended_banned
  }
  appendMsg(message, { isSystem: true, variant: 'error' });
});

let banExpiryTimestamp = localStorage.getItem('ping_ban_expires_at') || null;

socket.off('chat_ended_banned');
socket.on('chat_ended_banned', ({ reason, message, isOffender, banExpiresAt, remainingMs, autoRequeue }) => {
  stopAutoSearch();
  stopTimer();
  endCurrentChat();

  if (isOffender || (!autoRequeue && message && message.toLowerCase().includes('you have been banned'))) {
    const expiry = banExpiresAt || (Date.now() + (remainingMs || 900000));
    banExpiryTimestamp = expiry;
    try { localStorage.setItem('ping_ban_expires_at', expiry); } catch (e) {}

    const formattedMsg = message || '⚠️ You have been banned for 15 minutes due to inappropriate behavior or restricted content.';
    appendMsg(formattedMsg, { isSystem: true, variant: 'error' });
    showToast(formattedMsg, 'error', 5000);
  } else {
    const formattedMsg = message || '🛡️ The stranger attempted to use restricted content/slurs and has been banned for 15 minutes.';
    appendMsg(formattedMsg, { isSystem: true, variant: 'success' });
    showToast(formattedMsg, 'info', 4000);

    if (autoRequeue) {
      appendMsg('⚡ Finding a fresh match for you...', { isSystem: true, variant: 'success' });
      setTimeout(() => {
        if (socket && socket.connected) {
          socket.emit('start_chat');
        }
      }, 1200);
    }
  }
});

// ═══════════════════════════════════════════════
//  TIME EXTENSION EVENTS
// ═══════════════════════════════════════════════

socket.off('time_extension_offer');
socket.on('time_extension_offer', ({ roomId, fromUserId }) => {
  if (!inChat || activeRoomId !== roomId) return;
  // Ensure any existing modal is closed so ONLY a single popup is shown to the opponent
  closeModal();
  appendMsg('⏳ Partner wants more time! Do you agree?', { isSystem: true, variant: 'success' });
  showConfirm(
    'More Time?',
    '<div style="line-height:1.5; margin-top:4px;"><p style="font-size:0.95rem; color:var(--t-med);">Your partner wants to extend the chat time by 2 minutes. Agree?</p></div>',
    () => {
      socket.emit('time_extension_response', { accept: true });
    },
    () => {
      socket.emit('time_extension_response', { accept: false });
    },
    'Agree',
    'Decline',
    '⏳'
  );
});

socket.off('time_extension_pending');
socket.on('time_extension_pending', ({ roomId }) => {
  if (!inChat || activeRoomId !== roomId) return;
  appendMsg('⏳ Waiting for your partner to respond...', { isSystem: true });
});

socket.off('time_extended');
socket.on('time_extended', ({ roomId, addedMs, remainingMs }) => {
  if (!inChat || activeRoomId !== roomId) return;
  closeModal();
  const addedMin = Math.round(addedMs / 60000);
  appendMsg(`✅ Time extended by ${addedMin} minutes! Keep chatting 🎉`, { isSystem: true, variant: 'success', extraClass: 'time-extended-msg' });
  // Popup toast removed per user request: only show in chat screen
  startTimer(Date.now() + remainingMs);
});

socket.off('time_extension_declined');
socket.on('time_extension_declined', ({ roomId }) => {
  if (!inChat || activeRoomId !== roomId) return;
  closeModal();
  appendMsg('❌ Partner declined to extend time', { isSystem: true });
});

// ═══════════════════════════════════════════════
//  FRIEND SYSTEM EVENTS
// ═══════════════════════════════════════════════

socket.off('friend_request_sent');
socket.on('friend_request_sent', ({ requestId, toUserId } = {}) => {
  showToast('👫 Friend request sent!', 'success', 3000);
  if (!AppState.user.isAuthenticated) {
    showFirebaseConnectModal({ friendCountry: partnerNameEl?.textContent || 'Stranger' });
  }
});

socket.off('friend_request_received');
socket.on('friend_request_received', ({ requestId, fromUserId, fromCountry }) => {
  appendMsg(`👋 ${fromCountry} wants to be friends!`, { isSystem: true, variant: 'success' });
  showConfirm('New Friend?', `${fromCountry} wants to add you as a friend!`, () => {
    socket.emit('friend_request_response', { requestId, accept: true });
  }, () => {
    socket.emit('friend_request_response', { requestId, accept: false });
  });
});

socket.off('friend_request_accepted');
socket.on('friend_request_accepted', ({ friendId, friendCountry, dmRoomId }) => {
  appendMsg(`✨ You're now friends with ${friendCountry}!`, { isSystem: true, variant: 'success' });
  showToast(`✨ Friends with ${friendCountry}!`, 'success', 3000);
  if (!AppState.user.isAuthenticated) {
    setTimeout(() => {
      showFirebaseConnectModal({ friendCountry });
    }, 600);
  }
});

socket.off('friend_request_declined');
socket.on('friend_request_declined', ({ fromUserId }) => {
});

socket.off('friend_dm_opened');
socket.on('friend_dm_opened', ({ roomId, friendId, friendCountry, friendOnline, messages = [] }) => {
  // ── Clean up any lingering stranger-chat state ──
  // Stop the auto-search countdown (runs after stranger leaves) so it can't
  // hijack state or emit next_chat while we're inside a friend DM.
  stopAutoSearch();
  stopTimer();
  isWaiting = false;
  activeRoomId = null; // clear stranger room, friend uses friendRoomId

  // ── Activate friend DM ──
  friendRoomId = roomId;
  currentFriendId = friendId;
  currentChatType = 'friend';
  inChat = true;

  // Persist active friend ID so page refresh or tab reopening auto-reconnects
  try {
    localStorage.setItem('ping_active_friend_id', friendId);
  } catch (e) {}

  goToChat();
  if (homeTabs) homeTabs.style.display = 'flex';
  if (tabFriends) tabFriends.classList.add('active');
  if (tabRandom) tabRandom.classList.remove('active');
  activeHomeTab = 'friends';

  showView('friendDM');
  clearFriendChat();

  if (friendDMNameMeta) friendDMNameMeta.textContent = friendCountry;
  appendFriendMsg(`Connected with ${friendCountry} ✨`, { isSystem: true, variant: 'success' });

  messages.forEach((msg) => {
    appendFriendMsg(msg.message, {
      isSelf: msg.from === selfUserId || msg.from === persistentUserId,
      isPartner: msg.from !== selfUserId && msg.from !== persistentUserId,
      replyTo: msg.replyTo,
      isFlash: msg.isFlash,
      sentAt: msg.sentAt,
      isEdited: msg.isEdited,
      msgId: msg.msgId
    });
    if (msg.reactions && msg.msgId) {
      const msgEl = friendChatBox.querySelector(`[data-msg-id="${msg.msgId}"]`);
      if (msgEl) {
        Object.entries(msg.reactions).forEach(([uId, emo]) => {
          attachReactionBadge(msgEl, emo, uId);
        });
      }
    }
  });

  // Ensure friend input is ready
  if (friendMessageInput) {
    friendMessageInput.disabled = false;
    friendMessageInput.placeholder = 'Message your friend...';
    friendMessageInput.focus();
  }
  if (friendSendBtn) friendSendBtn.disabled = !friendMessageInput?.value.trim();

  syncButtons();
});

// ═══════════════════════════════════════════════
//  UI EVENT LISTENERS
// ═══════════════════════════════════════════════

// Login button - goes to app with tabs visible
window.forceNextChat = () => {
  stopAutoSearch();
  stopTimer();
  if (autoSearchBar) autoSearchBar.style.display = 'none';

  inChat = false;
  activeRoomId = null;
  AppState.explore.inChat = false;
  AppState.explore.isWaiting = true;
  AppState.explore.roomId = null;
  AppState.explore.timerEndMs = 0;
  isWaiting = true;

  clearChat();
  if (partnerNameEl) partnerNameEl.textContent = 'Stranger';

  showView('waiting');
  startWaitingScreen();
  syncButtons();
  showToast('Searching for a new stranger... 🔍', 'info', 2500);

  socket.emit('next_chat', { autoStart: true, interests: Array.from(selectedInterests) });
};

autoSearchNowBtn?.addEventListener('click', () => window.forceNextChat());

startLandingBtn?.addEventListener('click', () => {
  goToChat();
  // Show tabs and default to Random tab
  if (homeTabs) homeTabs.style.display = 'flex';
  switchHomeTab('random');
});

findChatBtn?.addEventListener('click', () => {
  if (banExpiryTimestamp && Date.now() < Number(banExpiryTimestamp)) {
    const remainingMs = Number(banExpiryTimestamp) - Date.now();
    const mins = Math.floor(remainingMs / 60000);
    const secs = Math.floor((remainingMs % 60000) / 1000);
    showToast(`⚠️ You are banned for bad behavior. Please wait ${mins} minute${mins !== 1 ? 's' : ''} and ${secs} second${secs !== 1 ? 's' : ''} before chatting again.`, 'error', 4000);
    return;
  }
  stopAutoSearch();
  pendingStart = false;
  isWaiting = true;
  AppState.explore.isWaiting = true;
  switchHomeTab('random');
  showView('waiting');
  syncButtons();
  socket.emit('start_chat', { interests: Array.from(selectedInterests) });
});

backBtn?.addEventListener('click', () => {
  // If in friend DM chat, go back to friends list
  if (friendDMView && friendDMView.style.display === 'flex') {
    friendRoomId = null;
    currentFriendId = null;
    switchHomeTab('friends');
    return;
  }

  // If in friends view, go back to prechat (Random tab)
  if (friendsView && friendsView.style.display === 'flex') {
    switchHomeTab('random');
    return;
  }

  if (inChat || isWaiting) {
    showConfirm('Leave?', "Return home?", () => {
      if (isWaiting) socket.emit('cancel_search');
      else if (activeRoomId) socket.emit('end_chat', { roomId: activeRoomId });
      endCurrentChat();
      goToLanding();
    });
  } else goToLanding();
});

function triggerStartChat() {
  if (banExpiryTimestamp && Date.now() < Number(banExpiryTimestamp)) {
    const remainingMs = Number(banExpiryTimestamp) - Date.now();
    const mins = Math.floor(remainingMs / 60000);
    const secs = Math.floor((remainingMs % 60000) / 1000);
    showToast(`⚠️ You are banned for bad behavior. Please wait ${mins} minute${mins !== 1 ? 's' : ''} and ${secs} second${secs !== 1 ? 's' : ''} before chatting again.`, 'error', 4000);
    return;
  }

  if (!isConnected) {
    showToast("Connecting to server...", "info", 1500);
    return;
  }

  stopAutoSearch();
  pendingStart = true;
  isWaiting = true;
  AppState.explore.isWaiting = true;
  showView('waiting');
  syncButtons();
  socket.emit('start_chat', { interests: Array.from(selectedInterests) });

  // Safeguard: auto-clear pending lock after 1.5s
  setTimeout(() => {
    pendingStart = false;
    syncButtons();
  }, 1500);
}
window.triggerStartChat = triggerStartChat;

startBtn?.addEventListener('click', triggerStartChat);

let skipConfirmTimer = null;
nextBtn?.addEventListener('click', (e) => {
  if (nextBtn.dataset.confirming !== 'true') {
    e.stopPropagation();
    nextBtn.dataset.confirming = 'true';
    const originalHTML = nextBtn.innerHTML;
    nextBtn.innerHTML = 'Sure? 👀';
    nextBtn.classList.add('confirming-skip');

    skipConfirmTimer = setTimeout(() => {
      nextBtn.dataset.confirming = 'false';
      nextBtn.innerHTML = originalHTML;
      nextBtn.classList.remove('confirming-skip');
    }, 3000); // 3 seconds to confirm
    return;
  }

  clearTimeout(skipConfirmTimer);
  nextBtn.dataset.confirming = 'false';
  nextBtn.innerHTML = '⏩ Skip Stranger';
  nextBtn.classList.remove('confirming-skip');

  const threeDotsMenu = $('threeDotsMenu');
  if (threeDotsMenu) threeDotsMenu.classList.add('hidden');

  userInitiatedSkip = true;
  userInitiatedLeave = true;
  setTimeout(() => { userInitiatedSkip = false; userInitiatedLeave = false; }, 2500);

  stopAutoSearch();
  stopTimer();
  socket.emit('next_chat', { autoStart: false });
  inChat = false;
  activeRoomId = null;
  isWaiting = false;
  AppState.explore.inChat = false;
  AppState.explore.isWaiting = false;
  AppState.explore.roomId = null;
  AppState.explore.timerEndMs = 0;
  stopWaitingScreen();
  clearChat();
  if (partnerNameEl) partnerNameEl.textContent = 'Stranger';
  syncButtons();
  showView('prechat');
  // No popup/toast for the person who skips the chat per user requirement
});

let reportSkipConfirmTimer = null;
reportSkipBtn?.addEventListener('click', (e) => {
  if (reportSkipBtn.dataset.confirming !== 'true') {
    e.stopPropagation();
    reportSkipBtn.dataset.confirming = 'true';
    const originalHTML = reportSkipBtn.innerHTML;
    reportSkipBtn.innerHTML = 'Sure? ⚠️';
    reportSkipBtn.classList.add('confirming-skip');

    reportSkipConfirmTimer = setTimeout(() => {
      reportSkipBtn.dataset.confirming = 'false';
      reportSkipBtn.innerHTML = originalHTML;
      reportSkipBtn.classList.remove('confirming-skip');
    }, 3000); // 3 seconds to confirm
    return;
  }

  clearTimeout(reportSkipConfirmTimer);
  reportSkipBtn.dataset.confirming = 'false';
  reportSkipBtn.innerHTML = '⚑ Report User';
  reportSkipBtn.classList.remove('confirming-skip');

  const threeDotsMenu = $('threeDotsMenu');
  if (threeDotsMenu) threeDotsMenu.classList.add('hidden');

  stopAutoSearch();
  socket.emit('report_user', { roomId: AppState.explore.roomId || activeRoomId, reason: 'inappropriate' });
  endCurrentChat();
  showToast('User reported. Returned to home screen.', 'info', 3000);
});

cancelWaitBtn?.addEventListener('click', () => {
  socket.emit('cancel_search');
  applyState('idle');
});

let msgIdGen = 0;
const messageRetryQueue = new Map(); // msgId -> { payload, timer, retries, chatType }

function sendMessage(overrideText = null) {
  const text = (overrideText || messageInput?.value || "").trim();
  if (!text || (!inChat && !autoSearchInterval)) return;

  // Remove icebreaker card from screen once a message is sent
  const banner = document.getElementById('matchedInterestBanner');
  if (banner) banner.remove();

  if (sendBtn) sendBtn.disabled = true;

  const msgId = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + (++msgIdGen);
  const isFlash = isFlashMode;
  const replyTarget = window.currentReplyTarget;

  // Optimistic rendering
  appendMsg(text, {
    isSelf: true,
    status: 'sending',
    msgId: msgId,
    replyTo: replyTarget,
    isFlash: isFlash
  });

  if (!overrideText) {
    messageInput.value = '';
    messageInput.style.height = 'auto';
    messageInput?.focus();
  }
  syncButtons();
  const cc = document.getElementById('charCounter');
  if (cc) { cc.textContent = ''; cc.className = 'char-counter'; }
  window.cancelReply();

  const payload = { message: text, replyTo: replyTarget, msgId, isFlash };

  const attemptSend = (isRetry = false) => {
    socket.emit('send_message', payload, (ack) => {
      const entry = messageRetryQueue.get(msgId);
      if (entry?.timer) clearTimeout(entry.timer);
      messageRetryQueue.delete(msgId);

      if (ack && (ack.ok || ack.success)) {
        updateMsgStatus(msgId, 'sent');
      } else {
        const isModBlock = ack?.reason && (
          ack.reason.startsWith('strike_') ||
          ack.reason.includes('warning') ||
          ack.reason.includes('blocked') ||
          ack.reason === 'banned_15min' ||
          ack.reason === 'low_effort_warning' ||
          ack.reason === 'slur_blocked' ||
          ack.reason === 'moderation_blocked'
        );
        if (isModBlock) {
          const el = (chatBox && chatBox.querySelector(`[data-msg-id="${msgId}"]`)) || 
                     (friendChatBox && friendChatBox.querySelector(`[data-msg-id="${msgId}"]`));
          if (el) el.remove();
        } else {
          updateMsgStatus(msgId, 'failed');
          if (ack?.reason) showToast(ack.reason, 'error', 3000);
        }
      }
      if (sendBtn) syncButtons();
    });
  };

  // 3-second retry queue
  const timer = setTimeout(() => {
    const entry = messageRetryQueue.get(msgId);
    if (entry) {
      if (entry.retries < 1) {
        entry.retries++;
        attemptSend(true);
        entry.timer = setTimeout(() => {
          messageRetryQueue.delete(msgId);
          updateMsgStatus(msgId, 'failed');
        }, 3000);
      } else {
        messageRetryQueue.delete(msgId);
        updateMsgStatus(msgId, 'failed');
      }
    }
  }, 3000);

  messageRetryQueue.set(msgId, { payload, timer, retries: 0, chatType: 'explore' });
  attemptSend(false);
}

function sendFriendMessage(overrideText = null) {
  const text = (overrideText || friendMessageInput?.value || "").trim();
  if (!text || !inChat || currentChatType !== 'friend') return;

  if (friendSendBtn && !overrideText) friendSendBtn.disabled = true;

  const msgId = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + (++msgIdGen);
  const isFlash = isFriendFlashMode;
  const replyTarget = window.currentReplyTarget;

  // Optimistic rendering
  appendFriendMsg(text, { isSelf: true, replyTo: replyTarget, msgId, isFlash, status: 'sending' });

  if (!overrideText) {
    friendMessageInput.value = '';
    friendMessageInput.style.height = 'auto';
    if (friendSendBtn) friendSendBtn.disabled = true;
    const fcc = document.getElementById('friendCharCounter');
    if (fcc) { fcc.textContent = ''; fcc.className = 'char-counter'; }
    friendMessageInput?.focus();
  }

  window.cancelReply();

  const payload = { roomId: friendRoomId, friendId: currentFriendId, message: text, replyTo: replyTarget, msgId, isFlash };

  const attemptSend = (isRetry = false) => {
    socket.emit('send_dm', payload, (ack) => {
      const entry = messageRetryQueue.get(msgId);
      if (entry?.timer) clearTimeout(entry.timer);
      messageRetryQueue.delete(msgId);

      if (ack && (ack.ok || ack.success)) {
        updateMsgStatus(msgId, 'sent');
      } else {
        const isModBlock = ack?.reason && (
          ack.reason.startsWith('strike_') ||
          ack.reason.includes('warning') ||
          ack.reason.includes('blocked') ||
          ack.reason === 'banned_15min' ||
          ack.reason === 'low_effort_warning' ||
          ack.reason === 'slur_blocked' ||
          ack.reason === 'moderation_blocked'
        );
        if (isModBlock) {
          const el = (friendChatBox && friendChatBox.querySelector(`[data-msg-id="${msgId}"]`)) || 
                     (chatBox && chatBox.querySelector(`[data-msg-id="${msgId}"]`));
          if (el) el.remove();
        } else {
          updateMsgStatus(msgId, 'failed');
          if (ack?.reason) showToast(ack.reason, 'error', 3000);
        }
      }
    });
  };

  const timer = setTimeout(() => {
    const entry = messageRetryQueue.get(msgId);
    if (entry) {
      if (entry.retries < 1) {
        entry.retries++;
        attemptSend(true);
        entry.timer = setTimeout(() => {
          messageRetryQueue.delete(msgId);
          updateMsgStatus(msgId, 'failed');
        }, 3000);
      } else {
        messageRetryQueue.delete(msgId);
        updateMsgStatus(msgId, 'failed');
      }
    }
  }, 3000);

  messageRetryQueue.set(msgId, { payload, timer, retries: 0, chatType: 'friend' });
  attemptSend(false);

  // Directly persist to Cloud Firestore if user is authenticated with Firebase
  if (AppState.user.isAuthenticated && dbInstance && currentFriendId) {
    try {
      const canonicalChatId = [AppState.user.id, currentFriendId].sort().join('__');
      dbInstance.collection('friend_chats').doc(canonicalChatId).collection('messages').doc(msgId).set({
        messageId: msgId,
        chatId: canonicalChatId,
        fromUserId: AppState.user.id,
        message: text,
        replyTo: replyTarget || null,
        isFlash: Boolean(isFlash),
        sentAt: Date.now(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch((err) => console.warn('Direct Firestore msg write notice:', err));
    } catch (dbErr) {
      console.warn('Firestore msg write notice:', dbErr);
    }
  }
}

messageForm?.addEventListener('submit', e => {
  e.preventDefault();
});

// Prevent soft keyboard from dismissing on mobile send button tap
sendBtn?.addEventListener('pointerdown', e => {
  e.preventDefault();
});

sendBtn?.addEventListener('click', e => {
  e.preventDefault();
  sendMessage();
  messageInput?.focus({ preventScroll: true });
});

messageInput?.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    // Prevent Enter key from submitting form or sending message
    // Pressing Enter inserts a newline (\n) in the message input
    e.stopPropagation();
  }
});

// ── DISABLE LINK & TEXT PASTING (ANTI-SPAM / ANTI-BOT) ────────
function handleChatInputPaste(e) {
  e.preventDefault();
  showToast('📋 Pasting links or text is disabled to prevent spam bots.', 'info', 3000);
}

messageInput?.addEventListener('paste', handleChatInputPaste);
friendMessageInput?.addEventListener('paste', handleChatInputPaste);

document.addEventListener('paste', (e) => {
  const target = e.target;
  if (target && (target.id === 'messageInput' || target.id === 'friendMessageInput' || target.classList?.contains('chat-input') || (target.tagName === 'TEXTAREA' && target.closest('.chat-input-bar, .chat-input-wrap, .view-chat, .view-friend-dm')))) {
    e.preventDefault();
    showToast('📋 Pasting links or text is disabled to prevent spam bots.', 'info', 3000);
  }
}, true);

messageInput?.addEventListener('input', function () {
  this.style.height = 'auto';
  const newH = Math.min(this.scrollHeight, 160);
  this.style.height = newH + 'px';
  syncButtons();
  // Update char counter
  const cc = document.getElementById('charCounter');
  if (cc) {
    const len = this.value.length;
    const max = parseInt(this.getAttribute('maxlength') || 500);
    if (len > max * 0.8) {
      cc.textContent = max - len;
      cc.className = len > max * 0.95 ? 'char-counter danger' : 'char-counter warn';
    } else {
      cc.textContent = '';
      cc.className = 'char-counter';
    }
  }
  if (inChat) {
    socket.emit('typing', { isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('typing', { isTyping: false }), 2000);
  }
});

// Friend DM message form listeners
friendMessageForm?.addEventListener('submit', e => {
  e.preventDefault();
});

friendSendBtn?.addEventListener('pointerdown', e => {
  e.preventDefault();
});

friendSendBtn?.addEventListener('click', e => {
  e.preventDefault();
  sendFriendMessage();
  friendMessageInput?.focus({ preventScroll: true });
});

friendMessageInput?.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.stopPropagation();
  }
});

friendMessageInput?.addEventListener('input', function () {
  this.style.height = 'auto';
  const newH = Math.min(this.scrollHeight, 160);
  this.style.height = newH + 'px';
  if (friendSendBtn) friendSendBtn.disabled = !this.value.trim();

  // Update char counter
  const cc = document.getElementById('friendCharCounter');
  if (cc) {
    const len = this.value.length;
    const max = parseInt(this.getAttribute('maxlength') || 500);
    if (len > max * 0.8) {
      cc.textContent = max - len;
      cc.className = len > max * 0.95 ? 'char-counter danger' : 'char-counter warn';
    } else {
      cc.textContent = '';
      cc.className = 'char-counter';
    }
  }

  if (inChat && currentChatType === 'friend') {
    socket.emit('dm_typing', { roomId: friendRoomId, isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('dm_typing', { roomId: friendRoomId, isTyping: false }), 2000);
  }
});

// Explicit background tap allows user to dismiss the keyboard on demand
const handleChatBackgroundTap = (e) => {
  if (e.target === chatBox || e.target === friendChatBox || e.target.classList?.contains('msgs-empty') || e.target.closest?.('.msgs-empty')) {
    if (document.activeElement === messageInput || document.activeElement === friendMessageInput) {
      document.activeElement.blur();
    }
  }
};
chatBox?.addEventListener('click', handleChatBackgroundTap);
friendChatBox?.addEventListener('click', handleChatBackgroundTap);

reportBtn?.addEventListener('click', () => {
  showConfirm('Report User?', "The chat will end immediately and the user will receive a warning.", () => {
    socket.emit('report_user', { roomId: activeRoomId, reason: 'inappropriate' });
    endCurrentChat();
    showToast('User reported. Returned to home screen.', 'info', 3000);
  });
});

extendTimeBtn?.addEventListener('click', () => {
  socket.emit('request_time_extension');
});

friendBtn?.addEventListener('click', () => {
  const threeDotsMenu = $('threeDotsMenu');
  if (threeDotsMenu) threeDotsMenu.classList.add('hidden');
  socket.emit('send_friend_request');
  showFirebaseConnectModal({ friendCountry: partnerNameEl?.textContent || 'Stranger' });
});

homeAuthBtn?.addEventListener('click', () => {
  if (AppState.user.isAuthenticated) {
    showConfirm('Sign Out?', 'Would you like to sign out of your account?', async () => {
      if (authInstance) {
        await authInstance.signOut();
        showToast("Signed out successfully! 👋", "info", 3000);
      }
    });
  } else {
    triggerGoogleLogin();
  }
});

landingAuthBtn?.addEventListener('click', () => {
  if (AppState.user.isAuthenticated) {
    showConfirm('Sign Out?', 'Would you like to sign out of your account?', async () => {
      if (authInstance) {
        await authInstance.signOut();
        showToast("Signed out successfully! 👋", "info", 3000);
      }
    });
  } else {
    triggerGoogleLogin();
  }
});

exploreAuthBtn?.addEventListener('click', () => {
  triggerGoogleLogin();
});

endChatBtn?.addEventListener('click', () => {
  showConfirm('End Chat?', "Are you sure?", () => {
    socket.emit('end_chat', { roomId: activeRoomId });
    endCurrentChat();
  });
});

// Friend DM button listeners
backToFriendsBtn?.addEventListener('click', () => {
  // Go back to friends view
  try { localStorage.removeItem('ping_active_friend_id'); } catch (e) {}
  friendRoomId = null;
  currentChatType = 'stranger';
  currentFriendId = null;
  switchHomeTab('friends');
  loadAndShowFriendsView();
});

friendReportBtn?.addEventListener('click', () => {
  showConfirm('Report?', "Block and report this user?", () => {
    try { localStorage.removeItem('ping_active_friend_id'); } catch (e) {}
    socket.emit('report_user', { reason: 'friend_report' });
    showToast('Reported.', 'success', 2000);
    showView('friends');
    loadAndShowFriendsView();
  });
});

endFriendDMBtn?.addEventListener('click', () => {
  try { localStorage.removeItem('ping_active_friend_id'); } catch (e) {}
  inChat = false;
  activeRoomId = null;
  currentChatType = 'stranger';
  currentFriendId = null;
  showView('friends');
  loadAndShowFriendsView();
});

confirmYes?.addEventListener('click', () => { confirmCb?.(); closeModal(); });
confirmNo?.addEventListener('click', () => {
  if (confirmModal?.confirmNoFn && typeof confirmModal.confirmNoFn === 'function') {
    confirmModal.confirmNoFn();
  }
  closeModal();
});

let clientHeartbeatTimer = null;

function startHeartbeat() {
  stopHeartbeat();
  clientHeartbeatTimer = setInterval(() => {
    if (socket && socket.connected) {
      socket.emit('heartbeat');
    }
  }, 15000);
}

function stopHeartbeat() {
  if (clientHeartbeatTimer) {
    clearInterval(clientHeartbeatTimer);
    clientHeartbeatTimer = null;
  }
}

// Automatic network recovery when device regains connectivity or wakes up
window.addEventListener('online', () => {
  showNetworkStatus('Internet connection detected. Reconnecting…', 'warning');
  if (!socket.connected) {
    socket.connect();
  } else {
    handleSuccessfulConnection();
  }
});

window.addEventListener('offline', () => {
  isConnected = false;
  isReconnecting = true;
  setConnStatus('disconnected');
  showNetworkStatus('You are currently offline. Check your internet connection.', 'error');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!socket.connected) {
      socket.connect();
    } else {
      socket.emit('heartbeat');
      socket.emit('get_status');
    }
  }
});

// ── THEME SWITCHER ──────────────────────────────────────────
function setTheme(name) {
  document.body.className = `theme-${name}`;
  localStorage.setItem('ping-theme', name);
}

// Load saved theme
const savedTheme = localStorage.getItem('ping-theme') || 'midnight';
setTheme(savedTheme);

setConnStatus('connecting');
syncButtons();
setScreenIndicator('home');

// ── SCREENSAVER MODE ──────────────────────────────────────────
window.addEventListener('blur', () => {
  if (inChat) document.body.classList.add('privacy-blur');
});
window.addEventListener('focus', () => {
  document.body.classList.remove('privacy-blur');
});
// ── FLASH & PING LISTENERS ───────────────────────────────────
function triggerFlash(isFriend = false) {
  const targetRoom = isFriend ? friendRoomId : activeRoomId;
  if (targetRoom) {
    socket.emit('send_flash', { roomId: targetRoom });
  }
}

flashToggleBtn?.addEventListener('pointerdown', (e) => {
  e.preventDefault();
});

flashToggleBtn?.addEventListener('click', toggleFlash);

function toggleFlash(e) {
  e.preventDefault();
  isFlashMode = !isFlashMode;
  flashToggleBtn.classList.toggle('active', isFlashMode);
  messageInput?.classList.toggle('flash-active', isFlashMode);
  if (inChat && activeRoomId) {
    triggerFlash(false);
  }
}

friendFlashToggleBtn?.addEventListener('pointerdown', (e) => {
  e.preventDefault();
});

friendFlashToggleBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  isFriendFlashMode = !isFriendFlashMode;
  friendFlashToggleBtn.classList.toggle('active', isFriendFlashMode);
  friendMessageInput?.classList.toggle('flash-active', isFriendFlashMode);
  if (currentChatType === 'friend' && friendRoomId) {
    triggerFlash(true);
  }
});

function triggerPing(isFriend = false) {
  const rid = isFriend ? friendRoomId : activeRoomId;
  if (!rid) return;
  socket.emit('send_ping', { roomId: rid });
  // No popup/toast when sending a ping per user requirement
}

pingBtn?.addEventListener('pointerdown', (e) => {
  e.preventDefault();
});

pingBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  triggerPing(false);
});

friendPingBtn?.addEventListener('pointerdown', (e) => {
  e.preventDefault();
});

friendPingBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  triggerPing(true);
});

socket.off('incoming_ping');
socket.on('incoming_ping', () => {
  const container = (currentChatType === 'friend') ? friendChatBox : chatBox;
  if (container) {
    container.classList.add('ping-shake');
    setTimeout(() => container.classList.remove('ping-shake'), 400);
  }
  // Optional: Play subtle sound if allowed using shared AudioContext singleton
  try {
    const context = getSharedAudioContext();
    if (context) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.connect(gain);
      gain.connect(context.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, context.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, context.currentTime + 0.2);
      gain.gain.setValueAtTime(0.1, context.currentTime);
      gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.2);
      osc.start();
      osc.stop(context.currentTime + 0.2);
    }
  } catch (e) { }
});

// ── REAL-TIME PRIVACY & STATUS ────────────────────────────────
socket.off('message_read');
socket.on('message_read', ({ msgId }) => {
  updateMsgStatus(msgId, 'read');
});

socket.off('message_delivered');
socket.on('message_delivered', ({ msgId }) => {
  updateMsgStatus(msgId, 'delivered');
});

invisibleToggle?.addEventListener('change', () => {
  const isInvisible = invisibleToggle.checked;
  socket.emit('toggle_invisible', { invisible: isInvisible });
});

// Preference toggles in settings (sound, haptics, auto-scroll, typing)
['prefSoundToggle', 'prefHapticToggle', 'prefAutoScrollToggle', 'prefTypingToggle'].forEach(id => {
  const el = $(id);
  if (el) {
    // Restore saved state
    const saved = localStorage.getItem(`ping_${id}`);
    if (saved !== null) {
      el.checked = saved === 'true';
    }
    el.addEventListener('change', () => {
      localStorage.setItem(`ping_${id}`, el.checked);
    });
  }
});

// Privacy Shield Click
document.querySelectorAll('.privacy-shield').forEach(el => {
  el.onclick = () => showToast('🛡️ E2EE Active. Connection is private.', 'success', 3000);
});

socket.off('flash_received');
socket.on('flash_received', ({ senderId }) => {
  const container = (currentChatType === 'friend') ? friendChatBox : chatBox;
  if (container) {
    container.classList.add('ping-shake', 'screen-flash');
    setTimeout(() => container.classList.remove('ping-shake', 'screen-flash'), 600);
  }
  document.body.classList.add('screen-flash-active');
  setTimeout(() => document.body.classList.remove('screen-flash-active'), 500);
});

// ── COMPACT CHAT UI & 3-DOT MENU BINDINGS ───────────────────
function setupCompactChatUI() {
  const threeDotsBtn = $('threeDotsBtn');
  const threeDotsMenu = $('threeDotsMenu');

  if (threeDotsMenu) {
    if (threeDotsBtn) {
      // Prevent keyboard from closing when tapping three dots button
      threeDotsBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
      });

      threeDotsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        threeDotsMenu.classList.toggle('hidden');
      });
    }

    // Prevent non-destructive items in three dots menu from collapsing keyboard
    threeDotsMenu.addEventListener('pointerdown', (e) => {
      const targetBtn = e.target.closest('button');
      if (targetBtn && targetBtn.id !== 'endChatBtn' && targetBtn.id !== 'reportSkipBtn') {
        e.preventDefault();
      }
    });

    threeDotsMenu.addEventListener('click', (e) => {
      const targetBtn = e.target.closest('button');
      if (!targetBtn) return;

      // If button requires 2-step confirmation and is currently in confirming state, keep menu open!
      if (targetBtn.dataset.confirming === 'true') {
        e.stopPropagation();
      } else {
        threeDotsMenu.classList.add('hidden');
      }

      // Re-focus message input to ensure keyboard stays open
      if (targetBtn.id !== 'endChatBtn' && targetBtn.id !== 'reportSkipBtn') {
        const activeInput = currentChatType === 'friend' ? friendMessageInput : messageInput;
        activeInput?.focus({ preventScroll: true });
      }
    });

    document.addEventListener('click', (e) => {
      if (threeDotsMenu && !threeDotsMenu.contains(e.target) && e.target !== threeDotsBtn && !threeDotsBtn?.contains(e.target)) {
        threeDotsMenu.classList.add('hidden');
      }
    });
  }
}

// Clean compact chat UI setup
setupCompactChatUI();

// ═══════════════════════════════════════════════════════════════
// PWA INSTALLATION & DOWNLOAD PROMPT MANAGER
// ═══════════════════════════════════════════════════════════════
let deferredPWAInstallPrompt = null;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator && window.navigator.standalone === true);
const isIOS = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());

// Register Service Worker for offline capability & fast precaching
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      console.log('[PWA] ServiceWorker registered with scope:', registration.scope);
    }).catch((err) => {
      console.warn('[PWA] ServiceWorker registration failed:', err?.message);
    });
  });
}

// Listen for browser native install prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPWAInstallPrompt = e;
  console.log('[PWA] captured beforeinstallprompt event');
  updatePWAInstallUI();
});

window.addEventListener('appinstalled', () => {
  deferredPWAInstallPrompt = null;
  console.log('[PWA] Ping app installed successfully!');
  showToast('🎉 Ping installed successfully! Launch it anytime from your home screen.', 'success', 5000);
  hidePWAInstallModal();
  updatePWAInstallUI();
});

function updatePWAInstallUI() {
  const downloadLandingBtn = $('downloadLandingBtn');
  const headerDownloadBtn = $('headerDownloadBtn');

  if (isStandalone) {
    if (downloadLandingBtn) downloadLandingBtn.style.display = 'none';
    if (headerDownloadBtn) headerDownloadBtn.style.display = 'none';
  } else {
    if (downloadLandingBtn) downloadLandingBtn.style.display = 'inline-flex';
    if (headerDownloadBtn) headerDownloadBtn.style.display = 'inline-flex';
  }
}

function openPWAInstallModal() {
  const installModal = $('installModal');
  const confirmInstallBtn = $('confirmInstallBtn');
  const iosInstallGuide = $('iosInstallGuide');
  const iosInAppWarning = $('iosInAppWarning');
  const desktopInstallGuide = $('desktopInstallGuide');
  const isInApp = document.documentElement.classList.contains('is-inapp-browser');
  const isIOSPlatform = isIOS || document.documentElement.classList.contains('is-ios');

  if (!installModal) return;

  if (isIOSPlatform) {
    if (confirmInstallBtn) confirmInstallBtn.style.display = 'none';
    if (iosInstallGuide) iosInstallGuide.style.display = 'block';
    if (iosInAppWarning) iosInAppWarning.style.display = isInApp ? 'block' : 'none';
    if (desktopInstallGuide) desktopInstallGuide.style.display = 'none';
  } else if (deferredPWAInstallPrompt) {
    if (confirmInstallBtn) confirmInstallBtn.style.display = 'flex';
    if (iosInstallGuide) iosInstallGuide.style.display = 'none';
    if (desktopInstallGuide) desktopInstallGuide.style.display = 'none';
  } else {
    // Desktop Chrome / Edge or manual browser install
    if (confirmInstallBtn) confirmInstallBtn.style.display = 'none';
    if (iosInstallGuide) iosInstallGuide.style.display = 'none';
    if (desktopInstallGuide) desktopInstallGuide.style.display = 'block';
  }

  installModal.style.display = 'flex';
}

function hidePWAInstallModal() {
  const installModal = $('installModal');
  if (installModal) installModal.style.display = 'none';
}

async function triggerPWAInstall() {
  const isIOSPlatform = isIOS || document.documentElement.classList.contains('is-ios');
  if (deferredPWAInstallPrompt) {
    deferredPWAInstallPrompt.prompt();
    const { outcome } = await deferredPWAInstallPrompt.userChoice;
    console.log('[PWA] Install prompt outcome:', outcome);
    if (outcome === 'accepted') {
      showToast('⚡ Installing Ping to your device...', 'info', 3000);
    }
    deferredPWAInstallPrompt = null;
    hidePWAInstallModal();
  } else if (isIOSPlatform) {
    openPWAInstallModal();
  } else {
    openPWAInstallModal();
  }
}

// Bind PWA buttons
$('downloadLandingBtn')?.addEventListener('click', () => {
  if (deferredPWAInstallPrompt) {
    triggerPWAInstall();
  } else {
    openPWAInstallModal();
  }
});

$('headerDownloadBtn')?.addEventListener('click', () => {
  if (deferredPWAInstallPrompt) {
    triggerPWAInstall();
  } else {
    openPWAInstallModal();
  }
});

$('confirmInstallBtn')?.addEventListener('click', () => {
  triggerPWAInstall();
});

$('closeInstallModal')?.addEventListener('click', () => {
  hidePWAInstallModal();
});

$('installModal')?.addEventListener('click', (e) => {
  if (e.target === $('installModal')) {
    hidePWAInstallModal();
  }
});

updatePWAInstallUI();

// ═══════════════════════════════════════════════════════════════
// MOBILE VIRTUAL KEYBOARD VIEWPORT RESIZING & OVERLAP CONTROLLER
// Uses window.visualViewport to dynamically shrink the view to
// fit above the keyboard without covering input or screen content
// ═══════════════════════════════════════════════════════════════
function initMobileKeyboardViewportHandler() {
  let isKeyboardCurrentlyOpen = false;

  const getActiveChatScrollContainer = () => {
    if (AppState.activeTab === 'FRIENDS' && friendDMView && friendDMView.style.display !== 'none') {
      return friendChatBox;
    }
    return chatBox;
  };

  const scrollActiveChatToBottom = (instant = false) => {
    const activeBox = getActiveChatScrollContainer();
    if (activeBox) {
      if (instant) {
        activeBox.scrollTop = activeBox.scrollHeight;
      } else {
        requestAnimationFrame(() => {
          activeBox.scrollTop = activeBox.scrollHeight;
        });
      }
    }
  };

  const updateViewportMetrics = () => {
    let visibleHeight = window.innerHeight;
    let keyboardHeight = 0;

    if (window.visualViewport) {
      visibleHeight = Math.round(window.visualViewport.height);
      keyboardHeight = Math.max(0, window.innerHeight - visibleHeight);
    }

    document.documentElement.style.setProperty('--visual-viewport-height', `${visibleHeight}px`);
    document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);

    const openState = keyboardHeight > 100;
    if (openState !== isKeyboardCurrentlyOpen) {
      isKeyboardCurrentlyOpen = openState;
      if (openState) {
        document.documentElement.classList.add('keyboard-open');
        document.body.classList.add('keyboard-open');
        scrollActiveChatToBottom();
      } else {
        document.documentElement.classList.remove('keyboard-open');
        document.body.classList.remove('keyboard-open');
      }
    }

    // On iOS Safari, pin document scroll to top 0 to avoid container displacement
    if (window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
    if (document.body.scrollTop !== 0) {
      document.body.scrollTop = 0;
    }
  };

  // Immediate sync
  updateViewportMetrics();

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      updateViewportMetrics();
      scrollActiveChatToBottom();
    });

    window.visualViewport.addEventListener('scroll', () => {
      if (window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    });
  }

  window.addEventListener('resize', updateViewportMetrics);
  window.addEventListener('orientationchange', () => {
    setTimeout(updateViewportMetrics, 150);
  });

  // Attach focus & blur listeners to all chat textareas/inputs
  const inputElements = [messageInput, friendMessageInput];
  inputElements.forEach(inp => {
    if (!inp) return;

    inp.addEventListener('focus', () => {
      // Delay slightly so mobile OS keyboard slide animation begins
      setTimeout(() => {
        updateViewportMetrics();
        inp.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        scrollActiveChatToBottom(true);
        window.scrollTo(0, 0);
      }, 60);

      setTimeout(() => {
        updateViewportMetrics();
        scrollActiveChatToBottom(true);
        window.scrollTo(0, 0);
      }, 250);
    });

    inp.addEventListener('blur', () => {
      setTimeout(() => {
        updateViewportMetrics();
        window.scrollTo(0, 0);
      }, 100);
    });
  });
}

initMobileKeyboardViewportHandler();

// ── IN-APP BROWSER (IAB) PROMPT BANNER HANDLER ────────────────
function initIabBanner() {
  const isInApp = document.documentElement.classList.contains('is-inapp-browser');
  const banner = document.getElementById('iabBanner');
  const closeBtn = document.getElementById('closeIabBannerBtn');

  if (isInApp && banner) {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem('ping_iab_dismissed') === 'true';
    } catch (_) {}

    if (!dismissed) {
      banner.style.display = 'flex';
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        banner.style.display = 'none';
        try {
          sessionStorage.setItem('ping_iab_dismissed', 'true');
        } catch (_) {}
      });
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initIabBanner);
} else {
  initIabBanner();
}




