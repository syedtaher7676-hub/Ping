/* ── Ping frontend — app.js ── */

// ── BACKEND URL ──────────────────────────────────────────────
const backendMeta = document.querySelector('meta[name="ping-backend-url"]');
const configuredBackendUrl = backendMeta?.getAttribute('content')?.trim();
const defaultBackendUrl =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : window.location.origin;
const backendUrl = configuredBackendUrl || defaultBackendUrl;

// ── PERSISTENT USER ID ───────────────────────────────────────
let persistentUserId = localStorage.getItem('ping_user_id');
if (!persistentUserId) {
  persistentUserId = 'u_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  localStorage.setItem('ping_user_id', persistentUserId);
}

// ── SOCKET ───────────────────────────────────────────────────
// Configured with prioritized websocket transport for instant low-latency connections
// and fallback polling for proxy and iframe environments.
const socket = io(backendUrl, {
  transports: ['websocket', 'polling'],
  upgrade: true,
  rememberUpgrade: true,
  timeout: 10000,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 2500,
  randomizationFactor: 0.3,
  auth: { userId: persistentUserId },
  autoConnect: true,
});
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
const tabFriends = $('tabFriends');
let activeHomeTab = 'random'; // 'random' or 'friends'

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

async function initFirebaseClient() {
  if (typeof firebase === 'undefined') {
    console.log("Firebase CDN scripts are not loaded, running in Guest Mode only.");
    return;
  }

  // Robust default fallback matching the actual Cloud project credentials
  const firebaseConfig = {
    apiKey: "AIzaSyCoxk4oQMIeLenwtdmjZkW04Xr7XAmMqeY",
    authDomain: "impressive-atlas-4ggh3.firebaseapp.com",
    projectId: "impressive-atlas-4ggh3",
    storageBucket: "impressive-atlas-4ggh3.firebasestorage.app",
    messagingSenderId: "237904937112",
    appId: "1:237904937112:web:42917cae7c903634dc50ed"
  };

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    authInstance = firebase.auth();
    dbInstance = firebase.firestore();

    authInstance.onAuthStateChanged(async (user) => {
      if (user) {
        console.log("Authenticated User:", user.uid);
        AppState.user.id = user.uid;
        AppState.user.isAuthenticated = true;
        AppState.user.profile = user;

        // Manage dynamic UI buttons
        const eAuth = document.getElementById('exploreAuthBtn');
        if (eAuth) eAuth.style.display = 'none';

        const hAuth = document.getElementById('homeAuthBtn');
        if (hAuth) {
          hAuth.innerHTML = `<span>👤 Profile</span>`;
          hAuth.title = `Signed in as ${user.displayName || user.email}`;
        }

        const lAuth = document.getElementById('landingAuthBtn');
        if (lAuth) {
          lAuth.innerHTML = `<span class="cta-label">👤 Profile</span>`;
          lAuth.title = `Signed in as ${user.displayName || user.email}`;
        }
        
        // Asynchronously save user data to Firestore
        try {
          const userRef = dbInstance.collection('users').doc(user.uid);
          await userRef.set({
            userId: user.uid,
            country: AppState.user.country || 'Global',
            displayName: user.displayName || 'Anonymous',
            lastSeenAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          console.log("Successfully synchronized user profile in Firestore directly from client.");
        } catch (dbErr) {
          console.error("Firestore sync error:", dbErr);
        }
        
        // Seamlessly authenticate active socket session & migrate guest friendships
        socket.emit('authenticate', { 
          userId: user.uid,
          oldUserId: persistentUserId,
          activeFriendId: currentFriendId
        }, (ack) => {
          if (ack && ack.success) {
            console.log("Socket authenticated with user:", user.uid);
            showToast(`Logged in as ${user.displayName || 'user'}! ✨`, 'success', 3000);
          }
        });

        // Persist any active friendship directly in Firestore for instant cloud safety
        if (currentFriendId) {
          try {
            const pairId = [user.uid, currentFriendId].sort().join('__');
            await dbInstance.collection('friendships').doc(pairId).set({
              userAId: [user.uid, currentFriendId].sort()[0],
              userBId: [user.uid, currentFriendId].sort()[1],
              users: [user.uid, currentFriendId],
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log("Direct client friendship persistence saved to Firestore:", pairId);
            showToast("✨ Friendship saved to Firebase!", "success", 3000);
          } catch (fErr) {
            console.warn("Client friendship sync warning:", fErr);
          }
        }

        // Intent-driven Friend Request Gate: Send deferred request now!
        if (AppState.deferredFriendRequest) {
          AppState.deferredFriendRequest = false;
          showToast("Signed in! Sending friend request now... 👫", "success", 2000);
          socket.emit('send_friend_request');
        }
        
        // Hide soft auth banner & close modal if open
        const banner = document.getElementById('softAuthBanner');
        if (banner) banner.remove();
        closeModal();
        
      } else {
        AppState.user.isAuthenticated = false;
        AppState.user.id = persistentUserId;
        AppState.user.profile = null;

        // Show "Sign In" during active stranger chat if user is guest
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
      }
    });
  } catch (err) {
    console.warn("Client-side Firebase failed to initialize:", err);
  }
}

async function triggerGoogleLogin() {
  if (typeof firebase === 'undefined' || !firebase.apps.length) {
    showToast("Firebase Auth is not initialized or configured on this project.", "error", 3000);
    return;
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    showToast("Opening Google Sign-in...", "info", 1500);
    await firebase.auth().signInWithPopup(provider);
  } catch (err) {
    console.error("Sign up popup error:", err);
    showToast(`Auth error: ${err.message}`, "error", 4000);
  }
}

function showInChatAuthModal(onDismiss = null) {
  if (AppState.user.isAuthenticated) return;
  showConfirm(
    'Save your connections & chats!',
    '<div style="line-height:1.5; margin-top:4px;"><p style="color:var(--t-med); font-size:0.95rem;">Sign in with Google to save friends, restore chats, and continue conversations seamlessly across all your devices.</p></div>',
    () => {
      triggerGoogleLogin();
    },
    () => {
      if (typeof onDismiss === 'function') onDismiss();
    },
    'Sign In with Google',
    'Keep Chatting',
    '🔐'
  );
}

function showPostFriendAuthModal(friendInfo = {}) {
  if (AppState.user.isAuthenticated || document.getElementById('postFriendAuthModal')) return;

  const friendLabel = friendInfo.friendCountry || 'your new connection';
  const modal = document.createElement('div');
  modal.id = 'postFriendAuthModal';
  modal.className = 'glass-modal-overlay';
  modal.innerHTML = `
    <div class="glass-modal-card">
      <div class="gmc-icon">💾</div>
      <div class="gmc-badge">🔥 Friend Connected!</div>
      <h3>Save Friendships in Firebase</h3>
      <p>You've connected with <strong>${friendLabel}</strong>! Sign in with Google now to securely save this friendship and your DM history in Firebase Cloud Firestore so you never lose contact across sessions.</p>
      <div class="gmc-actions">
        <button id="pfGoogleBtn" class="btn-primary" type="button">
          <svg width="18" height="18" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:8px;"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.8s.2-2.1.4-2.8L1.9 6.3C.7 8.7 0 10.3 0 12s.7 3.3 1.9 5.7l3.7-2.9z"/><path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16c1.8 3.7 5.6 7 10.1 7z"/></svg>
          Sign In & Save to Firebase
        </button>
        <button id="pfDismissBtn" class="btn-ghost" type="button">Keep Chatting as Guest</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('pfDismissBtn').onclick = () => {
    if (navigator.vibrate) navigator.vibrate(10);
    modal.remove();
  };
  document.getElementById('pfGoogleBtn').onclick = async () => {
    if (navigator.vibrate) navigator.vibrate(20);
    modal.remove();
    triggerGoogleLogin();
  };
}

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
  if (AppState.user.isAuthenticated || document.getElementById('softAuthBanner')) return;

  const banner = document.createElement('div');
  banner.id = 'softAuthBanner';
  banner.className = 'soft-auth-banner glass-card';
  banner.innerHTML = `
    <div class="sab-content">
      <span class="sab-icon">⚡</span>
      <div class="sab-text">
        <strong>Save your connections!</strong>
        <p>Sign up now to persist your friends list across devices and sessions.</p>
      </div>
      <div class="sab-buttons">
        <button id="sabCloseBtn" class="btn-ghost btn-xs" type="button">Dismiss</button>
        <button id="sabSignUpBtn" class="btn-primary btn-xs" type="button">Sign Up</button>
      </div>
    </div>
  `;

  document.body.appendChild(banner);

  document.getElementById('sabCloseBtn')?.addEventListener('click', () => {
    banner.style.animation = 'bannerSlideOut 0.2s ease forwards';
    setTimeout(() => banner.remove(), 200);
  });
  document.getElementById('sabSignUpBtn')?.addEventListener('click', () => triggerGoogleLogin());
}

// Start Firebase client initialization and set a 2-minute soft auth banner trigger
initFirebaseClient();
setTimeout(() => {
  triggerSoftAuthBanner();
}, 120000);

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#start-chat-btn, #startBtn, #startLandingBtn, #findChatBtn').forEach(btn => {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('disabled');
      }
    });
    if (confirmModal) confirmModal.style.display = 'none';
  });
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

// ── TIME EXTENSION EVENTS ─────────────────────────────────────────────
const waitingTexts = [
  'Searching the globe 🌎', 'Tuning frequencies 📶',
  'Aligning stars ✨', 'Finding a match 🤝', 'Hold tight bestie 💖',
  'Scanning vibes... 📶', 'Locating strangers 👣'
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
function showToast(msg, type = 'info', duration = 3800) {
  if (!toastContainer) return;
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
  if (!confirmModal) { onYes?.(); return; }
  if (confirmTitle) confirmTitle.textContent = title;
  if (confirmMessage) confirmMessage.innerHTML = message;
  const modalIcon = $('modalIcon');
  if (modalIcon) modalIcon.textContent = icon;
  if (confirmYes) confirmYes.textContent = yesText;
  if (confirmNo) confirmNo.textContent = noText;
  confirmCb = onYes;
  confirmModal.dataset.onNo = typeof onNo === 'function' ? true : false;
  confirmModal.confirmNoFn = onNo;
  confirmModal.style.display = 'flex';
}
function closeModal() {
  if (confirmModal) confirmModal.style.display = 'none';
  if (confirmYes) confirmYes.textContent = 'Confirm';
  if (confirmNo) confirmNo.textContent = 'Cancel';
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
  const display = n > 0 ? n.toLocaleString() : '—';
  if (liveUsersEl && window.__pingCountUp) window.__pingCountUp(liveUsersEl, n);
  else if (liveUsersEl) liveUsersEl.textContent = display;
  if (headerActiveUsers) headerActiveUsers.textContent = display;
  if (headerOnlineCount) headerOnlineCount.textContent = display;
  if (actionBarOnline) actionBarOnline.textContent = display;
  const ws = $('wsCount'); if (ws) ws.textContent = display;
}

// ── REUSABLE OPTIMIZED LONG-PRESS & CONTEXT MENU HANDLER ────
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

    // Snappy 320ms press timing with immediate haptic touch
    pressTimer = setTimeout(() => {
      hasTriggered = true;
      el.classList.remove('msg-pressing');
      if (navigator.vibrate) navigator.vibrate(28);
      showAdvancedMsgOptions(e, msgId, getCleanText(), isPartner, isFriend, isSelf, sentAt, startX, startY);
      pressTimer = null;
    }, 320);
  };

  const handleMove = (e) => {
    if (pressTimer) {
      const touch = e.touches ? e.touches[0] : e;
      const dx = Math.abs(touch.clientX - startX);
      const dy = Math.abs(touch.clientY - startY);
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

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    el.classList.remove('msg-pressing');
    if (navigator.vibrate) navigator.vibrate(25);
    showAdvancedMsgOptions(e, msgId, getCleanText(), isPartner, isFriend, isSelf, sentAt, e.clientX, e.clientY);
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
    window.currentReplyTarget = { text: text.slice(0, 100), wasSender: !isPartner, isPartner };
    if (currentChatType === 'friend') sendFriendMessage('❤️');
    else sendMessage('❤️');
    if (window.__pingMatchBurst) window.__pingMatchBurst();
  };

  if ((isSelf || isPartner) && !isSystem) {
    const rxns = document.createElement('div');
    rxns.className = 'msg-reactions';
    const emojis = ['😂', '❤️', '🔥', '💀', '🥺', '✨'];
    emojis.forEach(emo => {
      const b = document.createElement('button');
      b.className = 'rxn-btn';
      b.textContent = emo;
      b.onclick = (e) => {
        e.stopPropagation();
        window.currentReplyTarget = { text: text.slice(0, 100), wasSender: !isPartner, isPartner };
        if (currentChatType === 'friend') {
          sendFriendMessage(emo);
        } else {
          sendMessage(emo);
        }
      };
      rxns.appendChild(b);
    });
    el.appendChild(rxns);

    const rTrig = document.createElement('div');
    rTrig.className = 'msg-reply-trigger';
    rTrig.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 11l5-5-5-5M21 11H3"/></svg>';
    rTrig.onclick = () => window.startReply(text, isPartner, msgId);
    rTrig.title = "Reply";
    rTrig.setAttribute('aria-label', "Reply");
    el.appendChild(rTrig);
  }

  chatBox.appendChild(el);
  scrollToBottom(chatBox);

  if (isPartner) {
    if (document.hasFocus() && !invisibleToggle?.checked) {
      socket.emit('message_read', { roomId: activeRoomId, msgId });
    }
  }

  if (!isSystem) checkKeywordEffects(text);
}

function showAdvancedMsgOptions(e, msgId, text, isPartner, isFriend, isSelf, sentAt, touchX, touchY) {
  const old = document.querySelector('.msg-context-menu');
  if (old) old.remove();

  const targetBubble = e?.currentTarget || e?.target?.closest('.msg');
  const bubbleRect = targetBubble ? targetBubble.getBoundingClientRect() : null;

  const menu = document.createElement('div');
  menu.className = 'msg-context-menu';

  // 1. Quick Emoji Reactions
  const rxnRow = document.createElement('div');
  rxnRow.className = 'menu-rxn-row';
  const emojis = ['😂', '❤️', '🔥', '💀', '🥺', '✨', '👍', '⚡'];
  emojis.forEach(emo => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-rxn-btn';
    btn.textContent = emo;
    btn.onclick = (evt) => {
      evt.stopPropagation();
      if (navigator.vibrate) navigator.vibrate(15);
      menu.remove();
      window.currentReplyTarget = { text: text.slice(0, 100), wasSender: !isPartner, isPartner };
      if (isFriend) sendFriendMessage(emo);
      else sendMessage(emo);
      showToast(`Reacted ${emo}`, 'info', 1200);
    };
    rxnRow.appendChild(btn);
  });
  menu.appendChild(rxnRow);

  const divider = document.createElement('div');
  divider.className = 'menu-divider';
  menu.appendChild(divider);

  // 2. Reply
  const replyBtn = document.createElement('button');
  replyBtn.type = 'button';
  replyBtn.className = 'menu-item';
  replyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l5-5-5-5M21 11H3"/></svg><span>Reply</span>';
  replyBtn.onclick = (evt) => {
    evt.stopPropagation();
    if (navigator.vibrate) navigator.vibrate(20);
    menu.remove();
    if (typeof window.startReply === 'function') {
      window.startReply(text, isPartner, msgId);
    }
    const targetInput = isFriend ? $('friendMessageInput') : $('messageInput');
    if (targetInput) {
      targetInput.focus();
      targetInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };
  menu.appendChild(replyBtn);

  // 3. Copy Text
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'menu-item';
  copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Copy Text</span>';
  copyBtn.onclick = async (evt) => {
    evt.stopPropagation();
    if (navigator.vibrate) navigator.vibrate(25);
    menu.remove();
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
  };
  menu.appendChild(copyBtn);

  // 4. Edit / Delete (for own messages)
  if (isSelf && msgId) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'menu-item';
    editBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>Edit Message</span>';
    editBtn.onclick = (evt) => {
      evt.stopPropagation();
      menu.remove();
      openEditModal(msgId, text, isFriend);
    };
    menu.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'menu-item danger';
    deleteBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>Delete Message</span>';
    deleteBtn.onclick = (evt) => {
      evt.stopPropagation();
      menu.remove();
      openDeleteModal(msgId, isFriend);
    };
    menu.appendChild(deleteBtn);
  }

  // Append to body first to compute exact rendered dimensions via getBoundingClientRect()
  document.body.appendChild(menu);

  const menuRect = menu.getBoundingClientRect();
  const menuWidth = menuRect.width || 240;
  const menuHeight = menuRect.height || 220;
  const padding = 12;
  const bottomBarHeight = 75; // Clearance for bottom input bar

  let clickX = (e && e.touches && e.touches.length > 0)
    ? e.touches[0].clientX
    : (e?.clientX ?? (typeof touchX === 'number' ? touchX : (bubbleRect ? (isSelf ? bubbleRect.right - menuWidth : bubbleRect.left) : 100)));
  let clickY = (e && e.touches && e.touches.length > 0)
    ? e.touches[0].clientY
    : (e?.clientY ?? (typeof touchY === 'number' ? touchY : (bubbleRect ? bubbleRect.top : 100)));

  // STRICT HORIZONTAL CLAMPING: Prevents clipping off the right or left edge of the screen
  let left = Math.min(Math.max(padding, clickX - (isSelf ? menuWidth - 40 : 20)), window.innerWidth - menuWidth - padding);

  // STRICT VERTICAL CLAMPING: Prevents overlapping the bottom input bar
  let top = clickY - menuHeight - 8;
  if (top < padding || (clickY + menuHeight + bottomBarHeight < window.innerHeight)) {
    top = Math.min(clickY + 8, window.innerHeight - menuHeight - bottomBarHeight - padding);
  }
  top = Math.max(padding, top);

  menu.style.position = 'fixed';
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.zIndex = '9999';

  setTimeout(() => {
    const closeMenu = (evt) => {
      if (evt && menu.contains(evt.target)) return;
      menu.remove();
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('touchstart', closeMenu);
      document.removeEventListener('pointerdown', closeMenu);
    };
    document.addEventListener('click', closeMenu, { once: true });
    document.addEventListener('touchstart', closeMenu, { once: true });
    document.addEventListener('pointerdown', closeMenu, { once: true });
  }, 50);
}

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
    window.currentReplyTarget = { text: text.slice(0, 100), wasSender: !isPartner, isPartner };
    sendFriendMessage('❤️');
  };

  if ((isSelf || isPartner) && !isSystem) {
    const rxns = document.createElement('div');
    rxns.className = 'msg-reactions';
    const emojis = ['😂', '❤️', '🔥', '💀', '🥺', '✨'];
    emojis.forEach(emo => {
      const b = document.createElement('button');
      b.className = 'rxn-btn';
      b.textContent = emo;
      b.onclick = (e) => {
        e.stopPropagation();
        window.currentReplyTarget = { text: text.slice(0, 100), wasSender: !isPartner, isPartner };
        sendFriendMessage(emo);
      };
      rxns.appendChild(b);
    });
    el.appendChild(rxns);

    const rTrig = document.createElement('div');
    rTrig.className = 'msg-reply-trigger';
    rTrig.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 11l5-5-5-5M21 11H3"/></svg>';
    rTrig.onclick = () => window.startReply(text, isPartner, msgId);
    rTrig.title = "Reply";
    rTrig.setAttribute('aria-label', "Reply");
    el.appendChild(rTrig);
  }

  friendChatBox.appendChild(el);
  scrollToBottom(friendChatBox);

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
    if (rem <= 0) stopTimer();
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
  if (input) input.focus();
};

window.cancelReply = () => {
  window.currentReplyTarget = null;
  const rp = $('replyPreview');
  const frp = $('friendReplyPreview');
  if (rp) rp.style.display = 'none';
  if (frp) frp.style.display = 'none';
};

if ($('cancelReplyBtn')) $('cancelReplyBtn').addEventListener('click', window.cancelReply);
if ($('cancelFriendReplyBtn')) $('cancelFriendReplyBtn').addEventListener('click', window.cancelReply);

// ── VIEWS (ZERO-FLICKER HARDWARE ACCELERATED) ─────────────────
let currentActiveView = 'prechat';

function showView(which) {
  const views = [
    { key: 'prechat', el: preChatView },
    { key: 'waiting', el: waitingView },
    { key: 'chat', el: activeChatView },
    { key: 'friends', el: friendsView },
    { key: 'friendDM', el: friendDMView },
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
        void el.offsetWidth; // single hardware-accelerated reflow
        el.classList.add('view-enter');
      }
    } else {
      el.style.display = 'none';
      el.classList.remove('view-enter');
    }
  });

  // Show/hide home tabs — visible on ALL views except waiting
  const showTabs = (which === 'prechat' || which === 'friends' || which === 'friendDM' || which === 'chat');
  if (homeTabs) homeTabs.style.display = showTabs ? 'flex' : 'none';

  // Sync active tab highlight
  if (which === 'friendDM' || which === 'friends') {
    activeHomeTab = 'friends';
    if (tabFriends) tabFriends.classList.add('active');
    if (tabRandom) tabRandom.classList.remove('active');
  } else if (which === 'prechat' || which === 'waiting' || which === 'chat') {
    activeHomeTab = 'random';
    if (tabRandom) tabRandom.classList.add('active');
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
  pendingStart = false;
  isWaiting = false;
  inChat = false;
  activeRoomId = null;
  stopAutoSearch(); // Always kill the auto-search timer when ending any chat
  if (currentChatType === 'stranger') {
    currentChatType = 'stranger';
  }
  stopTimer();
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
  if (chatApp) chatApp.style.display = 'flex';
  showView('prechat');
  const ac = $('appCanvas');
  if (ac) { ac.width = ac.offsetWidth || innerWidth; ac.height = ac.offsetHeight || innerHeight; }
}
function goToLanding() {
  if (chatApp) chatApp.style.display = 'none';
  if (landingPage) landingPage.style.display = 'flex';
}

// ── HOME TAB SWITCHING ────────────────────────────────────────
function switchHomeTab(tab) {
  // Update active tab state
  activeHomeTab = tab;
  AppState.activeTab = tab === 'random' ? 'EXPLORE' : 'FRIENDS';

  // Update tab visual state
  if (tabRandom) tabRandom.classList.toggle('active', tab === 'random');
  if (tabFriends) tabFriends.classList.toggle('active', tab === 'friends');

  if (tab === 'friends') {
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
    } else {
      showView('prechat');
      syncButtons();
    }
  }
}

tabRandom?.addEventListener('click', () => switchHomeTab('random'));
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

socket.off('system_metrics');
socket.on('system_metrics', m => {
  const u = Number(m.activeUsers ?? m.liveUsers ?? 0);
  setOnlineCount(u);
});

socket.off('matched');
socket.on('matched', ({ roomId, endAt, expiresInMs, partnerCountry: pc }) => {
  pendingStart = false;
  clearChat();
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

  startTimer(AppState.explore.timerEndMs);
  if (window.__pingMatchBurst) window.__pingMatchBurst();
});

socket.off('new_message');
socket.on('new_message', (payload) => {
  if (AppState.activeTab !== 'EXPLORE') return;
  const { from, message, roomId } = payload;
  const isMe = (from === socket.id || from === persistentUserId || from === selfUserId || (AppState.user.id && from === AppState.user.id));
  if (isMe) return; // Optimistically rendered.

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

function stopAutoSearch() {
  if (autoSearchInterval) {
    clearInterval(autoSearchInterval);
    autoSearchInterval = null;
  }
}

function handleChatEnd(reason) {
  if (isReconnecting) return;
  stopTimer();
  stopAutoSearch();

  // Reset some UI states
  if (friendBtn) friendBtn.disabled = true;
  if (reportBtn) reportBtn.disabled = true;
  if (extendTimeBtn) extendTimeBtn.disabled = true;

  inChat = false;
  activeRoomId = null;
  syncButtons();

  if (currentChatType !== 'stranger') return;

  let remaining = 30;
  if (autoSearchBar) autoSearchBar.style.display = 'flex';
  if (autoSearchStatus) autoSearchStatus.textContent = `Stranger left. Auto-searching in ${remaining}s...`;

  autoSearchInterval = setInterval(() => {
    remaining--;
    if (autoSearchStatus) autoSearchStatus.textContent = `Stranger left. Auto-searching in ${remaining}s...`;

    if (remaining <= 0) {
      stopAutoSearch();
      socket.emit('next_chat', { autoStart: true });
      appendMsg('Neural search initiated... 🔍', { isSystem: true });
    }
  }, 1000);
}

socket.off('chat_end');
socket.on('chat_end', ({ reason }) => {
  if (AppState.activeTab !== 'EXPLORE') return;
  handleChatEnd(reason);
});

socket.off('partner_disconnected');
socket.on('partner_disconnected', ({ roomId, message, reconnectTimeoutMs }) => {
  if (AppState.activeTab !== 'EXPLORE') return;
  console.log('[Ping] Partner disconnected, waiting for reconnect...', { roomId, timeout: reconnectTimeoutMs });

  stopAutoSearch();
  let remaining = Math.round((reconnectTimeoutMs || 30000) / 1000);
  const targetRoomId = roomId || activeRoomId;

  if (autoSearchBar) autoSearchBar.style.display = 'flex';
  if (autoSearchStatus) autoSearchStatus.textContent = `Partner disconnected. Waiting for recovery (${remaining}s)...`;

  if (messageInput) {
    messageInput.disabled = true;
    messageInput.placeholder = `Partner disconnected (${remaining}s)...`;
  }
  if (sendBtn) sendBtn.disabled = true;

  autoSearchInterval = setInterval(() => {
    remaining--;
    if (autoSearchStatus) autoSearchStatus.textContent = `Partner disconnected. Waiting for recovery (${remaining}s)...`;
    if (messageInput && messageInput.disabled) messageInput.placeholder = `Partner disconnected (${remaining}s)...`;

    if (remaining <= 0) {
      stopAutoSearch();
      if (activeRoomId === targetRoomId || lastKnownRoomId === targetRoomId) {
        appendMsg('Partner did not reconnect. Finding someone new... 🔍', { isSystem: true });
        socket.emit('next_chat', { autoStart: true });
      }
    }
  }, 1000);
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
});

socket.off('error_message');
socket.on('error_message', ({ message, action, duration }) => {
  if (!message) return;

  // Backend already formats the message with emoji prefix — display as-is
  appendMsg(message, { isSystem: true, variant: 'error' });
});

socket.off('message_rejected');
socket.on('message_rejected', ({ message, reason }) => {
  if (!message) return;
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
  appendMsg('⏳ Partner wants more time! Do you agree?', { isSystem: true, variant: 'success' });
  showConfirm('More Time?', 'Your partner wants to extend the chat time by 2 minutes. Agree?', () => {
    socket.emit('time_extension_response', { accept: true });
  }, () => {
    socket.emit('time_extension_response', { accept: false });
  });
});

socket.off('time_extension_pending');
socket.on('time_extension_pending', ({ roomId }) => {
  if (!inChat || activeRoomId !== roomId) return;
  appendMsg('⏳ Waiting for your partner to respond...', { isSystem: true });
});

socket.off('time_extended');
socket.on('time_extended', ({ roomId, addedMs, remainingMs }) => {
  if (!inChat || activeRoomId !== roomId) return;
  const addedMin = Math.round(addedMs / 60000);
  appendMsg(`✅ Time extended by ${addedMin} minutes! Keep chatting 🎉`, { isSystem: true, variant: 'success' });
  showToast(`+${addedMin} min granted!`, 'success', 3000);
  startTimer(Date.now() + remainingMs);
});

socket.off('time_extension_declined');
socket.on('time_extension_declined', ({ roomId }) => {
  if (!inChat || activeRoomId !== roomId) return;
  appendMsg('❌ Partner declined to extend time', { isSystem: true });
});

// ═══════════════════════════════════════════════
//  FRIEND SYSTEM EVENTS
// ═══════════════════════════════════════════════

socket.off('friend_request_sent');
socket.on('friend_request_sent', ({ requestId, toUserId } = {}) => {
  showToast('👫 Friend request sent!', 'success', 3000);
  if (!AppState.user.isAuthenticated) {
    showPostFriendAuthModal();
  }
});

socket.off('friend_request_received');
socket.on('friend_request_received', ({ requestId, fromUserId, fromCountry }) => {
  appendMsg(`👋 ${fromCountry} wants to be friends!`, { isSystem: true, variant: 'success' });
  showConfirm('New Friend?', `${fromCountry} wants to add you as a friend!`, () => {
    socket.emit('friend_request_response', { requestId, accept: true });
    if (!AppState.user.isAuthenticated) {
      showPostFriendAuthModal();
    }
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
      showPostFriendAuthModal({ friendCountry });
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
  if (autoSearchBar) autoSearchBar.style.display = 'none';
  socket.emit('next_chat', { autoStart: true });
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
  switchHomeTab('random');
  socket.emit('start_chat');
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

startBtn?.addEventListener('click', () => {
  if (banExpiryTimestamp && Date.now() < Number(banExpiryTimestamp)) {
    const remainingMs = Number(banExpiryTimestamp) - Date.now();
    const mins = Math.floor(remainingMs / 60000);
    const secs = Math.floor((remainingMs % 60000) / 1000);
    showToast(`⚠️ You are banned for bad behavior. Please wait ${mins} minute${mins !== 1 ? 's' : ''} and ${secs} second${secs !== 1 ? 's' : ''} before chatting again.`, 'error', 4000);
    return;
  }

  if (!isConnected || pendingStart) return;
  stopAutoSearch();
  pendingStart = true;
  socket.emit('start_chat');
});

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

  stopAutoSearch();
  socket.emit('next_chat', { autoStart: true });
  if (inChat) appendMsg('Searching...', { isSystem: true });
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
  socket.emit('report_user', { roomId: AppState.explore.roomId, reason: 'inappropriate' });
  if (inChat) appendMsg('Reporting & Skipping...', { isSystem: true });
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
        updateMsgStatus(msgId, 'failed');
        if (ack?.reason) showToast(ack.reason, 'error', 3000);
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
        updateMsgStatus(msgId, 'failed');
        if (ack?.reason) showToast(ack.reason, 'error', 3000);
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
}

messageForm?.addEventListener('submit', e => {
  e.preventDefault();
});

sendBtn?.addEventListener('click', e => {
  e.preventDefault();
  sendMessage();
  messageInput?.focus();
});

messageInput?.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    // Prevent Enter key from submitting form or sending message
    // Pressing Enter inserts a newline (\n) in the message input
    e.stopPropagation();
  }
});

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

friendSendBtn?.addEventListener('click', e => {
  e.preventDefault();
  sendFriendMessage();
  friendMessageInput?.focus();
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

reportBtn?.addEventListener('click', () => {
  showConfirm('Report?', "This will end the chat.", () => {
    socket.emit('report_user', { roomId: activeRoomId });
    endCurrentChat();
    showToast('Reported.', 'success');
  });
});

extendTimeBtn?.addEventListener('click', () => {
  socket.emit('request_time_extension');
});

friendBtn?.addEventListener('click', () => {
  socket.emit('send_friend_request');
  if (!AppState.user.isAuthenticated) {
    AppState.deferredFriendRequest = true;
    showPostFriendAuthModal();
  }
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
  showToast(`${name.charAt(0).toUpperCase() + name.slice(1)} theme applied`, 'success', 1000);
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
  showToast('Sent a Ping! ⚡', 'info', 1000);
}

pingBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  triggerPing(false);
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
  // Optional: Play subtle sound if allowed
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
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
  showToast(isInvisible ? 'Invisible Mode ON 👻' : 'Visible Mode ON', 'info', 2000);
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
      threeDotsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        threeDotsMenu.classList.toggle('hidden');
      });
    }

    threeDotsMenu.addEventListener('click', (e) => {
      const targetBtn = e.target.closest('button');
      if (!targetBtn) return;

      // If button requires 2-step confirmation and is currently in confirming state, keep menu open!
      if (targetBtn.dataset.confirming === 'true') {
        e.stopPropagation();
      } else {
        threeDotsMenu.classList.add('hidden');
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

// 2-minute Soft-Auth Banner Trigger for Guest Users
setTimeout(() => {
  if (!AppState.user.isAuthenticated && inChat) {
    triggerSoftAuthBanner();
  }
}, 120000);


