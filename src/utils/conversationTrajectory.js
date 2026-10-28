/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PING ADVANCED 2028-30 CONVERSATION TRAJECTORY & RECIPIENT PROTECTION ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 * Monitors the real-time conversational flow in each chat room to determine:
 * 1. Whether the conversation is progressing healthily ("going good") or
 *    deteriorating into harassment, hostility, or annoyance ("making it bad").
 * 2. Unprompted spamming and flood pestering (e.g. 4+ unanswered pings, nagging).
 * 3. Boundary violations (e.g. persisting after the partner says "no", "stop",
 *    "not interested", "leave me alone", "creep").
 * 4. Ensures the receiver NEVER gets offended or loses interest by intercepting
 *    degrading/spammy messages pre-send and politely guiding the sender.
 */

// In-memory active room trajectory map: roomId -> RoomTrajectoryState
const roomTrajectories = new Map();
const MAX_HISTORY_PER_ROOM = 25;
const TRAJECTORY_EXPIRY_MS = 3600000; // 1 hour

// Positive conversational engagement markers
const POSITIVE_MARKERS = [
  /\b(hello|hey|hi|good\s*morning|good\s*evening|how\s*are\s*you|what's\s*up|sup)\b/i,
  /\b(haha|lmao|lol|rofl|😂|🤣|😊|✨|cool|awesome|nice|great|interesting|fun|love|like)\b/i,
  /\b(what\s*do\s*you\s*think|tell\s*me\s*more|that's\s*cool|where\s*are\s*you\s*from|i\s*agree)\b/i,
  /\b(favorite|hobby|music|movie|games?|food|travel|study|college|work|friends?)\b/i
];

// Discomfort / Deflection markers sent by the partner
const DEFLECTION_MARKERS = [
  /\b(no|nope|stop|stop\s*it|don't|dont|leave\s*me\s*alone|not\s*interested|creep|weirdo|uncomfortable)\b/i,
  /\b(please\s*stop|change\s*topic|i\s*don't\s*want\s*to|can\s*we\s*not|back\s*off)\b/i,
  /\b(bye|cya|g2g|leaving|gtg|whatever)\b/i
];

// Nagging / Pestering Spam patterns
const PESTERING_SPAM_PATTERNS = [
  /^\s*(reply|answer)(\s*me)?(\s*fast|\s*plz|\s*please|\s*now|\s*asap)?\s*$/i,
  /^\s*(text\s*back|hello\?+|hey\?+|u\s*there\??|are\s*you\s*there\??)\s*$/i,
  /^\s*(why\s*aren't\s*you\s*answering|why\s*ignoring\s*me|talk\s*to\s*me|say\s*something)\s*$/i,
  /\b(reply|answer)(\s*me)?\s*(fast|now|plz|please|asap)\b/i,
  /^\s*(\?{3,}|\.{3,}|!{3,})\s*$/
];

// Hostile / Derailing conversational insults
const HOSTILE_DERAILING_PATTERNS = [
  /\b(you('re|\s*are)\s*(so\s*)?(boring|dry|lame|dumb|stupid|annoying|ugly|trash|waste\s*of\s*time))\b/i,
  /\b(shut\s*(the\s*fuck\s*)?up|stfu|gtfo|get\s*lost|leave\s*then|nobody\s*cares)\b/i,
  /\b(bye\s*loser|such\s*a\s*loser|fuck\s*off|fck\s*off|fk\s*off)\b/i
];

// Persistent pressuring patterns after deflection
const PRESSURING_PATTERNS = [
  /\b(come\s*on|don't\s*be\s*(shy|like\s*that|boring)|just\s*(one|send|show|tell\s*me))\b/i,
  /\b(send\s*(pic|pics|photo|snap)|show\s*me|what\s*are\s*you\s*wearing)\b/i,
  /\b(why\s*not|give\s*me\s*your\s*number|give\s*me\s*your\s*snap)\b/i
];

/**
 * Gets or initializes the trajectory state for a given room
 */
function getRoomTrajectory(roomId) {
  if (!roomId) return null;
  let state = roomTrajectories.get(roomId);
  if (!state) {
    state = {
      roomId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      messages: [],
      userConsecutiveCounts: new Map(), // userId -> count
      partnerDeflections: new Map(),    // userId -> Array of deflection timestamps
      healthScore: 1.0                  // 1.0 = healthy, drops towards 0 on bad behavior
    };
    roomTrajectories.set(roomId, state);
  }
  return state;
}

/**
 * Evaluates whether an incoming message is safe for the receiver and healthy for the conversation
 * @param {string} roomId
 * @param {string} senderId
 * @param {string} text
 * @param {string} partnerId
 * @returns {{allowed: boolean, reason?: string, category?: string, message?: string, label?: string, healthScore?: number}}
 */
function evaluateConversationTrajectory(roomId, senderId, text, partnerId) {
  if (!roomId || !senderId || !text) {
    return { allowed: true, healthScore: 1.0 };
  }

  const state = getRoomTrajectory(roomId);
  if (!state) return { allowed: true, healthScore: 1.0 };

  const now = Date.now();
  state.lastActivityAt = now;
  const clean = text.trim();

  // 1. Check for Hostile / Derailing Conversational Lines
  for (const pattern of HOSTILE_DERAILING_PATTERNS) {
    if (pattern.test(clean)) {
      state.healthScore = Math.max(0.1, state.healthScore - 0.4);
      return {
        allowed: false,
        reason: 'hostile_derailing_conversation',
        category: 'conversation_health',
        message: "⚠️ Please keep the conversation friendly and respectful 🙏",
        label: "Please don't use bad words here",
        healthScore: state.healthScore
      };
    }
  }

  // 2. Check for Rapid Nagging / Pestering Spam
  const consecutiveCount = (state.userConsecutiveCounts.get(senderId) || 0) + 1;
  state.userConsecutiveCounts.set(senderId, consecutiveCount);

  // If partner spoke last, reset consecutive count
  if (partnerId && state.userConsecutiveCounts.has(partnerId)) {
    state.userConsecutiveCounts.set(partnerId, 0);
  }

  // If sender has sent 4+ consecutive messages without response and is pestering
  const isPestering = PESTERING_SPAM_PATTERNS.some(p => p.test(clean));
  if (consecutiveCount >= 4 && isPestering) {
    state.healthScore = Math.max(0.2, state.healthScore - 0.3);
    return {
      allowed: false,
      reason: 'pestering_spam_blocked',
      category: 'anti_spam_protection',
      message: "⚠️ Please give your partner a moment to reply before sending more messages 🙏",
      label: "Please don't use bad words here",
      healthScore: state.healthScore
    };
  }

  // If sending identical repetitive spam
  const recentUserMsgs = state.messages.filter(m => m.senderId === senderId && (now - m.timestamp < 15000));
  const identicalCount = recentUserMsgs.filter(m => m.text.toLowerCase() === clean.toLowerCase()).length;
  if (identicalCount >= 2) {
    state.healthScore = Math.max(0.2, state.healthScore - 0.25);
    return {
      allowed: false,
      reason: 'repetitive_message_spam',
      category: 'anti_spam_protection',
      message: "⚠️ Please avoid repeating the exact same message 🙏",
      label: "Please don't use bad words here",
      healthScore: state.healthScore
    };
  }

  // 3. Boundary Violation & Persistent Creeping Detection
  if (partnerId) {
    const partnerDeflections = state.partnerDeflections.get(partnerId) || [];
    const recentDeflection = partnerDeflections.some(t => now - t < 60000); // within last 60s

    if (recentDeflection) {
      const isPressuring = PRESSURING_PATTERNS.some(p => p.test(clean));
      if (isPressuring) {
        state.healthScore = Math.max(0.1, state.healthScore - 0.5);
        return {
          allowed: false,
          reason: 'boundary_violation_pressure',
          category: 'harassment_boundary_protection',
          message: "⚠️ Your partner expressed discomfort. Please respect their boundaries and keep the chat polite 🙏",
          label: "Please don't use bad words here",
          healthScore: state.healthScore
        };
      }
    }
  }

  // Record deflection if partner said no/stop
  if (DEFLECTION_MARKERS.some(m => m.test(clean))) {
    const deflections = state.partnerDeflections.get(senderId) || [];
    deflections.push(now);
    state.partnerDeflections.set(senderId, deflections.slice(-5));
  }

  // Healthy message: update trajectory
  const isPositive = POSITIVE_MARKERS.some(m => m.test(clean));
  if (isPositive) {
    state.healthScore = Math.min(1.0, state.healthScore + 0.1);
  }

  state.messages.push({
    senderId,
    text: clean,
    timestamp: now
  });

  if (state.messages.length > MAX_HISTORY_PER_ROOM) {
    state.messages.shift();
  }

  return {
    allowed: true,
    healthScore: state.healthScore
  };
}

/**
 * Retrieves the recent messages of a room (useful for reporting and self-training)
 */
function getRoomRecentMessages(roomId) {
  const state = roomTrajectories.get(roomId);
  return state?.messages ? [...state.messages] : [];
}

/**
 * Cleans up trajectory state when a room session ends
 */
function cleanupRoomTrajectory(roomId) {
  if (roomId) {
    const state = roomTrajectories.get(roomId);
    if (state && state.messages && state.messages.length >= 4 && state.healthScore >= 0.85) {
      try {
        const { ingestHealthyTurnTakingConversation } = require('../services/modelTrainer');
        ingestHealthyTurnTakingConversation(state.messages);
      } catch (_) {}
    }
    roomTrajectories.delete(roomId);
  }
}

// Periodic cleanup of stale trajectories
setInterval(() => {
  const now = Date.now();
  for (const [roomId, state] of roomTrajectories.entries()) {
    if (now - state.lastActivityAt > TRAJECTORY_EXPIRY_MS) {
      roomTrajectories.delete(roomId);
    }
  }
}, 300000).unref();

module.exports = {
  evaluateConversationTrajectory,
  getRoomRecentMessages,
  cleanupRoomTrajectory,
  getRoomTrajectory
};
