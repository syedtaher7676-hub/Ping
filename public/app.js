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
// We no longer fetch location on frontend to avoid rate-limits.
// The backend uses geoip-lite + headers to resolve this.
const socket = io(backendUrl, {
  transports: ['polling', 'websocket'],
  timeout: 7000,
  reconnection: true,
  reconnectionAttempts: 12,
  reconnectionDelay: 1200,
  reconnectionDelayMax: 5000,
  auth: { userId: persistentUserId },
});
window.socket = socket;

// ── DOM REFS ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const startBtn = $('startBtn');
const nextBtn = $('nextBtn');
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
const partnerCountryLabel = $('partnerCountryLabel'); // Ensure this is also present
let selfUserId = null;
let currentChatType = 'stranger'; // 'stranger' or 'friend'
let inChat = false;
let isConnected = false;
let isReconnecting = false;  // Track reconnection state
let isWaiting = false;
let activeRoomId = null;
let currentFriendId = null;        // ID of friend if in friend DM
let friendRoomId = null;        // Store friend room ID separately
let typingTimeout = null;
let confirmCb = null;
let hasErrShown = false;
let pendingStart = false;
let lastKnownRoomId = null;    // Store room ID during disconnect

let isFlashMode = false;
let isFriendFlashMode = false;

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

socket.on('message_deleted', ({ msgId }) => {
  const el = chatBox.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  el.classList.add('deleted');
  const textNode = el.querySelector('.msg-text');
  if (textNode) textNode.textContent = 'Message deleted 🗑️';
});

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

function formatTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
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
function showConfirm(title, message, onYes, onNo) {
  if (!confirmModal) { onYes?.(); return; }
  if (confirmTitle) confirmTitle.textContent = title;
  if (confirmMessage) confirmMessage.textContent = message;
  confirmCb = onYes;
  confirmModal.dataset.onNo = typeof onNo === 'function' ? true : false;
  confirmModal.confirmNoFn = onNo;
  confirmModal.style.display = 'flex';
}
function closeModal() {
  if (confirmModal) confirmModal.style.display = 'none';
}

// ── CONNECTION BADGE ──────────────────────────────────────────
function setConnStatus(state) {
  if (!connectionStatus) return;
  connectionStatus.className = `conn-badge ${state}`;
  const lbl = connectionStatus.querySelector('.conn-label');
  if (lbl) lbl.textContent =
    state === 'connected' ? '●' :
      state === 'disconnected' ? '✗' : '…';
}

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

// ── MESSAGES ─────────────────────────────────────────────────
let lastSystemMsgText = '';
let lastSystemMsgTime = 0;

function appendMsg(text, opts = {}) {
  const { isSelf = false, isPartner = false, isSystem = false, isHTML = false, variant = '', status = 'sending', msgId = '' } = opts;
  if (!chatBox) return;

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
  time.textContent = formatTimestamp();
  footer.appendChild(time);

  if (isSelf && !isSystem) {
    const statusEl = document.createElement('div');
    statusEl.className = `msg-status msg-status--${status}`;
    statusEl.innerHTML = `<svg class="status-icon" viewBox="0 0 20 12" fill="none"><path d="M1 6l4 4 8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10l8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/></svg>`;
    footer.appendChild(statusEl);
  }

  contentWrap.appendChild(footer);
  el.appendChild(contentWrap);

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
        // Instant emoji reply
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

  if (isSelf && !isSystem) {
    const optsTrig = document.createElement('div');
    optsTrig.className = 'msg-options-trigger';
    optsTrig.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
    optsTrig.onclick = (e) => {
      e.stopPropagation();
      const currentText = textNode.firstChild.textContent; // Get latest text (excluding edited tag)
      showMsgOptions(e, msgId, currentText, false);
    };
    el.appendChild(optsTrig);
  }

  chatBox.appendChild(el);
  scrollToBottom(chatBox);

  if (isPartner) {
    // If window is focused and we aren't invisible, send read receipt
    if (document.hasFocus() && !invisibleToggle?.checked) {
      socket.emit('message_read', { roomId: activeRoomId, msgId });
    }
  }

  if (!isSystem) checkKeywordEffects(text);
}

function showMsgOptions(e, msgId, text, isFriend) {
  // Remove existing menu
  const old = document.querySelector('.msg-context-menu');
  if (old) old.remove();

  const menu = document.createElement('div');
  menu.className = 'msg-context-menu';
  menu.style.top = `${e.pageY}px`;
  menu.style.left = `${e.pageX}px`;

  const editBtn = document.createElement('div');
  editBtn.className = 'menu-item';
  editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit';
  editBtn.onclick = () => {
    menu.remove();
    const newText = prompt("Edit your message:", text);
    if (newText && newText.trim() !== text) {
      if (isFriend) socket.emit('edit_dm', { roomId: friendRoomId, msgId, newMessage: newText.trim() });
      else socket.emit('edit_message', { roomId: activeRoomId, msgId, newMessage: newText.trim() });
    }
  };

  const deleteBtn = document.createElement('div');
  deleteBtn.className = 'menu-item danger';
  deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Delete';
  deleteBtn.onclick = () => {
    menu.remove();
    if (confirm("Delete this message?")) {
      if (isFriend) socket.emit('delete_dm', { roomId: friendRoomId, msgId });
      else socket.emit('delete_message', { roomId: activeRoomId, msgId });
    }
  };

  menu.appendChild(editBtn);
  menu.appendChild(deleteBtn);
  document.body.appendChild(menu);

  document.addEventListener('click', () => menu.remove(), { once: true });
}

function updateMsgStatus(msgId, newStatus) {
  if (!msgId || !chatBox) return;
  const el = chatBox.querySelector(`[data-msg-id="${msgId}"]`);
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
  time.textContent = formatTimestamp();
  footer.appendChild(time);

  if (isSelf && !isSystem) {
    const statusEl = document.createElement('div');
    statusEl.className = `msg-status msg-status--${status}`;
    statusEl.innerHTML = `<svg class="status-icon" viewBox="0 0 20 12" fill="none"><path d="M1 6l4 4 8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10l8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/></svg>`;
    footer.appendChild(statusEl);
  }

  contentWrap.appendChild(footer);

  el.appendChild(contentWrap);

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

  if (isSelf && !isSystem) {
    const optsTrig = document.createElement('div');
    optsTrig.className = 'msg-options-trigger';
    optsTrig.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
    optsTrig.onclick = (e) => {
      e.stopPropagation();
      const currentText = textNode.firstChild.textContent;
      showMsgOptions(e, msgId, currentText, true);
    };
    el.appendChild(optsTrig);
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
  function tick() {
    const rem = endMs - Date.now();
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
function syncButtons() {
  if (messageInput) {
    messageInput.disabled = !inChat && !autoSearchInterval;
    messageInput.placeholder = inChat ? 'Type a message…' : (autoSearchInterval ? 'Partner disconnected...' : 'Waiting for a match…');
    if (inChat || autoSearchInterval) setTimeout(() => messageInput.focus(), 80);
  }
  if (sendBtn) sendBtn.disabled = (!inChat && !autoSearchInterval) || !messageInput?.value.trim();
  if (startBtn) startBtn.disabled = inChat || isWaiting || !isConnected;
  if (nextBtn) nextBtn.disabled = !inChat && !isWaiting;
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
    if (emojiPickerPopup.classList.contains('visible')) {
      // Focus the emoji picker search
      setTimeout(() => {
        const picker = emojiPickerPopup.querySelector('emoji-picker');
        if (picker?.shadowRoot) {
          const search = picker.shadowRoot.querySelector('input[type="search"]');
          search?.focus();
        }
      }, 100);
    }
  });
}
if (fullEmojiPicker && messageInput) {
  fullEmojiPicker.addEventListener('emoji-click', event => {
    if (!inChat || messageInput.disabled) return;
    messageInput.value += event.detail.unicode;
    messageInput.dispatchEvent(new Event('input')); // trigger char counter & sync
    emojiPickerPopup.classList.remove('visible');
    messageInput.focus();
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
    if (friendEmojiPickerPopup.classList.contains('visible')) {
      setTimeout(() => {
        if (friendFullEmojiPicker?.shadowRoot) {
          const search = friendFullEmojiPicker.shadowRoot.querySelector('input[type="search"]');
          search?.focus();
        }
      }, 100);
    }
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
    friendEmojiPickerPopup.classList.remove('visible');
    friendMessageInput.focus();
  });
}



// ── REPLIES ──────────────────────────────────────────────────
window.currentReplyTarget = null;
window.startReply = (text, isPartner, msgId) => {
  window.currentReplyTarget = { text: text.slice(0, 100), wasSender: !isPartner, msgId };
  const isFriend = currentChatType === 'friend';
  const rp = $(isFriend ? 'friendReplyPreview' : 'replyPreview');

  if (rp) {
    rp.querySelector('.rp-text').textContent = window.currentReplyTarget.text;
    const label = rp.querySelector('span:first-of-type') || rp.querySelector('.rp-info span');
    if (label) {
      label.textContent = isFriend
        ? (isPartner ? 'Replying to Friend:' : 'Replying to You:')
        : (isPartner ? 'Replying to Stranger:' : 'Replying to You:');
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

// ── VIEWS ────────────────────────────────────────────────────
function showView(which) {
  const views = [
    { key: 'prechat', el: preChatView },
    { key: 'waiting', el: waitingView },
    { key: 'chat', el: activeChatView },
    { key: 'friends', el: friendsView },
    { key: 'friendDM', el: friendDMView },
  ];

  views.forEach(({ key, el }) => {
    if (!el) return;
    const isTarget = key === which;
    const wasVisible = el.style.display === 'flex';
    el.style.display = isTarget ? 'flex' : 'none';
    if (isTarget && !wasVisible) {
      el.classList.remove('view-enter');
      requestAnimationFrame(() => el.classList.add('view-enter'));
    } else if (!isTarget) {
      el.classList.remove('view-enter');
    }
  });

  // Show/hide home tabs — visible on ALL views except waiting? 
  // Actually, tabs should be visible on prechat, friends, friendDM, and chat.
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
  isWaiting = status === 'waiting';
  inChat = status === 'matched';
  activeRoomId = inChat ? roomId : null;
  if (inChat) currentChatType = 'stranger';  // Reset to stranger when starting new chat
  if (!inChat) stopTimer();

  if (isWaiting) startWaitingScreen();
  else stopWaitingScreen();

  syncButtons();

  if (status === 'waiting') showView('waiting');
  else if (status === 'matched') {
    showView('chat');
    if (autoSearchBar) autoSearchBar.style.display = 'none';
    stopAutoSearch();
  }
  else showView('prechat');
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

    return `
      <div class="friend-item ${friend.isTopFriend ? 'top-friend' : ''}" data-friend-id="${friend.friendId}" data-room-id="${friend.dmRoomId}">
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

  // Add event listeners to friend items
  document.querySelectorAll('.friend-item').forEach(item => {
    const friendId = item.dataset.friendId;
    const msgBtn = item.querySelector('.friend-msg-btn');
    const openFriendDM = () => socket.emit('open_friend_dm', { friendId });

    if (msgBtn) {
      msgBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        item.classList.remove('unread');
        openFriendDM();
      });
    }

    item.addEventListener('click', () => {
      item.classList.remove('unread');
      openFriendDM();
    });
  });
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

  // Update tab visual state
  if (tabRandom) tabRandom.classList.toggle('active', tab === 'random');
  if (tabFriends) tabFriends.classList.toggle('active', tab === 'friends');

  if (tab === 'friends') {
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
    // Show random/Explore tab
    if (inChat && currentChatType === 'stranger') {
      showView('chat');
    } else if (isWaiting) {
      showView('waiting');
    } else {
      showView('prechat');
    }
  }
}

tabRandom?.addEventListener('click', () => switchHomeTab('random'));
tabFriends?.addEventListener('click', () => switchHomeTab('friends'));

// ═══════════════════════════════════════════════
//  SOCKET EVENTS
// ═══════════════════════════════════════════════

socket.on('connect', () => {
  isConnected = true;
  hasErrShown = false;
  setConnStatus('connected');
  syncButtons();
  socket.emit('get_status');
  socket.emit('get_stats', s => { if (s) applyState(s.status || 'idle'); });
  startHeartbeat();
});

socket.on('disconnect', (reason) => {
  isConnected = false;
  isReconnecting = true;

  // Store the current room ID in case we reconnect to the same session
  if (inChat && activeRoomId) {
    lastKnownRoomId = activeRoomId;
    console.log('[Ping] Disconnected during chat, preserving session. Room:', lastKnownRoomId);
  }

  setConnStatus('disconnected');
  // Only show error if it's not a normal disconnect
  if (reason !== 'io client namespace disconnect' && reason !== 'io server namespace disconnect') {
    showToast('Connection lost. Reconnecting…', 'error', 5000);
  }
});

// Handle reconnection - restore chat state if we were in a session
socket.on('reconnect', (attemptNumber) => {
  console.log('[Ping] Reconnected after', attemptNumber, 'attempts. Last room:', lastKnownRoomId);
  isReconnecting = false;
  hasErrShown = false;

  // Request current state from server - if we're still matched, restore chat
  socket.emit('get_status', (state) => {
    if (state && state.status === 'matched' && state.roomId) {
      // Still in the same chat session!
      activeRoomId = state.roomId;
      inChat = true;
      console.log('[Ping] Restored chat session:', activeRoomId);
      showView('chat');
      appendMsg('🔄 Connection restored! Keep chatting ✨', { isSystem: true, variant: 'success' });
    } else {
      // Session was terminated during disconnect
      console.log('[Ping] Chat session ended during disconnect');
      if (inChat) {
        endCurrentChat();
        appendMsg('Chat ended due to connection loss ✌️', { isSystem: true });
      }
    }
    lastKnownRoomId = null;
    syncButtons();
  });
});

socket.on('reconnect_attempt', (attemptNumber) => {
  console.log('[Ping] Reconnection attempt:', attemptNumber);
});

socket.on('reconnect_error', (err) => {
  console.log('[Ping] Reconnection error:', err.message);
});

socket.on('reconnect_failed', () => {
  console.log('[Ping] Reconnection failed');
  isReconnecting = false;
  if (inChat) {
    endCurrentChat();
    showToast('Could not reconnect. Chat ended.', 'error');
  }
});

socket.on('connect_error', (error) => {
  isConnected = false;
  setConnStatus('disconnected');
  // Only show error once per session and only if not in chat or already reconnecting
  if (!hasErrShown && !isReconnecting && !inChat && !isWaiting) {
    hasErrShown = true;
    console.log('[Ping] Connection error:', error?.message);
    showToast("Connection issue. Reconnecting...", "warning", 3000);
  }
});

socket.on('self', ({ userId }) => {
  selfUserId = userId;
});

socket.on('state_update', ({ status, roomId }) => applyState(status, roomId));

socket.on('system_metrics', m => {
  const u = Number(m.activeUsers ?? m.liveUsers ?? 0);
  setOnlineCount(u);
});

socket.on('matched', ({ roomId, endAt, expiresInMs, partnerCountry: pc }) => {
  pendingStart = false;
  clearChat();
  applyState('matched', roomId);
  const displayCountry = pc || 'Someone nearby';
  if (partnerNameEl) {
    partnerNameEl.innerHTML = `<span class="location-flag">${displayCountry.split(' ')[0]}</span> ${displayCountry.split(' ').slice(1).join(' ') || 'Stranger'}`;
  }

  appendMsg(`Connected to ${displayCountry}. Say hi! 👋✨`, { isSystem: true, variant: 'success' });

  const resolvedEnd = Number(endAt) || Date.now() + (Number(expiresInMs) || 180000);
  startTimer(resolvedEnd);
  if (window.__pingMatchBurst) window.__pingMatchBurst();
});

socket.on('new_message', (payload) => {
  const { from, message, roomId } = payload;
  const isMe = (from === socket.id || from === persistentUserId || from === selfUserId);
  if (isMe) return; // Optimistically rendered.

  // Note: friend DM traffic uses 'dm_message' event now
  // We keep this handler focused on stranger chats


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

socket.on('message_seen', () => {
  // Checkmarks removed
});

socket.on('dm_message', (payload) => {
  const { from, message, roomId, replyTo } = payload;
  const isMe = (from === socket.id || from === persistentUserId || from === selfUserId);

  // 1. Update friends list preview if visible
  const item = document.querySelector(`.friend-item[data-room-id="${roomId}"]`) ||
    document.querySelector(`.friend-item[data-friend-id="${from}"]`);
  if (item) {
    const meta = item.querySelector('.friend-meta');
    if (meta) meta.textContent = message.slice(0, 44) + (message.length > 44 ? '...' : '');

    // Add unread indicator if not in this room
    if (roomId !== friendRoomId) {
      item.classList.add('unread');
    }
  }

  if (isMe) return;

  // 2. If in active DM view, append message
  if (roomId === friendRoomId) {
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
  } else {
    // 3. Otherwise show a toast notification
    showToast(`Friend: ${message.slice(0, 30)}...`, 'info', 3000);
  }
});

socket.on('dm_partner_typing', ({ roomId, isTyping, fromUserId }) => {
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

socket.on('partner_typing', ({ isTyping }) => {
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

socket.on('chat_end', ({ reason }) => {
  handleChatEnd(reason);
});

socket.on('partner_disconnected', ({ roomId, message, reconnectTimeoutMs }) => {
  console.log('[Ping] Partner disconnected, waiting for reconnect...', { roomId, timeout: reconnectTimeoutMs });

  stopAutoSearch();
  let remaining = Math.round((reconnectTimeoutMs || 30000) / 1000);

  inChat = false;
  if (autoSearchBar) autoSearchBar.style.display = 'flex';
  if (autoSearchStatus) autoSearchStatus.textContent = `Frequency lost. Waiting for reconnection (${remaining}s)...`;

  syncButtons();

  autoSearchInterval = setInterval(() => {
    remaining--;
    if (autoSearchStatus) autoSearchStatus.textContent = `Frequency lost. Waiting for reconnection (${remaining}s)...`;

    if (remaining <= 0) {
      stopAutoSearch();
      if (inChat && activeRoomId === roomId) {
        appendMsg('Neural link failed. Finding a new frequency... 🔍', { isSystem: true });
        socket.emit('next_chat', { autoStart: true });
      }
    }
  }, 1000);
});

socket.on('partner_reconnected', () => {
  stopAutoSearch();
  inChat = true;
  syncButtons();
  if (autoSearchBar) autoSearchBar.style.display = 'none';
  appendMsg('Partner reconnected! Keep chatting ✨', { isSystem: true, variant: 'success' });
});

socket.on('warning_message', ({ message }) => {
  if (!message) return;
  // Backend already formats the message with emoji prefix — display as-is
  appendMsg(message, { isSystem: true, variant: 'warn' });
});

socket.on('error_message', ({ message, action, duration }) => {
  if (!message) return;

  // Backend already formats the message with emoji prefix — display as-is
  appendMsg(message, { isSystem: true, variant: 'error' });
});

// ═══════════════════════════════════════════════
//  TIME EXTENSION EVENTS
// ═══════════════════════════════════════════════

socket.on('time_extension_offer', ({ roomId, fromUserId }) => {
  if (!inChat || activeRoomId !== roomId) return;
  appendMsg('⏳ Partner wants more time! Do you agree?', { isSystem: true, variant: 'success' });
  showConfirm('More Time?', 'Your partner wants to extend the chat time by 2 minutes. Agree?', () => {
    socket.emit('time_extension_response', { accept: true });
  }, () => {
    socket.emit('time_extension_response', { accept: false });
  });
});

socket.on('time_extension_pending', ({ roomId }) => {
  if (!inChat || activeRoomId !== roomId) return;
  appendMsg('⏳ Waiting for your partner to respond...', { isSystem: true });
});

socket.on('time_extended', ({ roomId, addedMs, remainingMs }) => {
  if (!inChat || activeRoomId !== roomId) return;
  const addedMin = Math.round(addedMs / 60000);
  appendMsg(`✅ Time extended by ${addedMin} minutes! Keep chatting 🎉`, { isSystem: true, variant: 'success' });
  showToast(`+${addedMin} min granted!`, 'success', 3000);
  startTimer(Date.now() + remainingMs);
});

socket.on('time_extension_declined', ({ roomId }) => {
  if (!inChat || activeRoomId !== roomId) return;
  appendMsg('❌ Partner declined to extend time', { isSystem: true });
});

// ═══════════════════════════════════════════════
//  FRIEND SYSTEM EVENTS
// ═══════════════════════════════════════════════

socket.on('friend_request_sent', ({ requestId, toUserId }) => {
  showToast('👫 Friend request sent!', 'success', 3000);
});

socket.on('friend_request_received', ({ requestId, fromUserId, fromCountry }) => {
  appendMsg(`👋 ${fromCountry} wants to be friends!`, { isSystem: true, variant: 'success' });
  showConfirm('New Friend?', `${fromCountry} wants to add you as a friend!`, () => {
    socket.emit('friend_request_response', { requestId, accept: true });
  }, () => {
    socket.emit('friend_request_response', { requestId, accept: false });
  });
});

socket.on('friend_request_accepted', ({ friendId, friendCountry, dmRoomId }) => {
  appendMsg(`✨ You're now friends with ${friendCountry}!`, { isSystem: true, variant: 'success' });
});

socket.on('friend_request_declined', ({ fromUserId }) => {
});

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
  if (!isConnected || pendingStart) return;
  stopAutoSearch();
  pendingStart = true;
  socket.emit('start_chat');
});

let skipConfirmTimer = null;
nextBtn?.addEventListener('click', () => {
  if (nextBtn.dataset.confirming !== 'true') {
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
  nextBtn.innerHTML = 'Skip <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
  nextBtn.classList.remove('confirming-skip');

  stopAutoSearch();
  socket.emit('next_chat', { autoStart: true });
  if (inChat) appendMsg('Searching...', { isSystem: true });
});

cancelWaitBtn?.addEventListener('click', () => {
  socket.emit('cancel_search');
  applyState('idle');
});

let msgIdGen = 0;

function sendMessage(overrideText = null) {
  const text = (overrideText || messageInput?.value || "").trim();
  if (!text || (!inChat && !autoSearchInterval)) return;

  if (sendBtn) sendBtn.disabled = true;

  const msgId = 'm_' + (++msgIdGen);
  const isFlash = isFlashMode;
  const replyTarget = window.currentReplyTarget;

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
  }
  syncButtons();
  const cc = document.getElementById('charCounter');
  if (cc) { cc.textContent = ''; cc.className = 'char-counter'; }
  window.cancelReply();

  socket.emit('send_message', { message: text, replyTo: replyTarget, msgId, isFlash }, (ack) => {
    if (ack && ack.ok) {
      updateMsgStatus(msgId, 'sent');
    } else {
      if (sendBtn) syncButtons();
    }
  });
}

function sendFriendMessage(overrideText = null) {
  const text = (overrideText || friendMessageInput?.value || "").trim();
  if (!text || !inChat || currentChatType !== 'friend') return;

  if (friendSendBtn && !overrideText) friendSendBtn.disabled = true;

  const msgId = 'f_' + (++msgIdGen);
  const isFlash = isFriendFlashMode;
  const replyTarget = window.currentReplyTarget;

  appendFriendMsg(text, { isSelf: true, replyTo: replyTarget, msgId, isFlash });

  if (!overrideText) {
    friendMessageInput.value = '';
    friendMessageInput.style.height = 'auto';
    if (friendSendBtn) friendSendBtn.disabled = true;
    const fcc = document.getElementById('friendCharCounter');
    if (fcc) { fcc.textContent = ''; fcc.className = 'char-counter'; }
  }

  window.cancelReply();

  socket.emit('send_dm', { roomId: friendRoomId, message: text, replyTo: replyTarget, msgId, isFlash }, (ack) => {
    if (ack && ack.ok) {
      // Use helper to update status to sent
      const el = friendChatBox.querySelector(`[data-msg-id="${msgId}"]`);
      if (el) {
        const statusEl = el.querySelector('.msg-status');
        if (statusEl) {
          statusEl.className = 'msg-status msg-status--sent';
          statusEl.classList.add('status-flash');
          setTimeout(() => statusEl.classList.remove('status-flash'), 600);
        }
      }
    } else {
      showToast('Failed to send message', 'error', 3000);
    }
  });
}

messageForm?.addEventListener('submit', e => {
  e.preventDefault();
  sendMessage();
});

messageInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
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
  sendFriendMessage();
});

friendMessageInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendFriendMessage();
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
  friendRoomId = null;
  currentChatType = 'stranger';
  currentFriendId = null;
  switchHomeTab('friends');
  loadAndShowFriendsView();
});

friendReportBtn?.addEventListener('click', () => {
  showConfirm('Report?', "Block and report this user?", () => {
    socket.emit('report_user', { reason: 'friend_report' });
    showToast('Reported.', 'success', 2000);
    showView('friends');
    loadAndShowFriendsView();
  });
});

endFriendDMBtn?.addEventListener('click', () => {
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

function startHeartbeat() {
  setInterval(() => { if (isConnected) socket.emit('heartbeat'); }, 15000);
}

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
flashToggleBtn?.addEventListener('click', () => {
  isFlashMode = !isFlashMode;
  flashToggleBtn.classList.toggle('active', isFlashMode);
  showToast(isFlashMode ? 'Flash mode ON ⚡' : 'Flash mode OFF', 'info', 1500);
});

friendFlashToggleBtn?.addEventListener('click', () => {
  isFriendFlashMode = !isFriendFlashMode;
  friendFlashToggleBtn.classList.toggle('active', isFriendFlashMode);
  showToast(isFriendFlashMode ? 'Flash mode ON ⚡' : 'Flash mode OFF', 'info', 1500);
});

function triggerPing(isFriend = false) {
  if (!inChat) return;
  const rid = isFriend ? friendRoomId : activeRoomId;
  socket.emit('send_ping', { roomId: rid });
  showToast('Sent a Ping! ⚡', 'info', 1000);
}

pingBtn?.addEventListener('click', () => triggerPing(false));
friendPingBtn?.addEventListener('click', () => triggerPing(true));

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
socket.on('message_read', ({ msgId }) => {
  updateMsgStatus(msgId, 'read');
});

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

