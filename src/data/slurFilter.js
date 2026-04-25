// Slur/Profanity filter storage - IN-MEMORY (for ephemeral file systems like Render free tier)

// === CONFIGURABLE BLOCKED WORDS LIST ===
// Default blocked words - configurable abusive slurs and insults
// These are clear hate speech, severe insults, and harassment terms
const DEFAULT_SLURS = [
  // Racial/ethnic slurs
  "nigger",
  "negro",
  "chink",
  "gook",
  "spic",
  "wetback",
  "kike",
  // Homophobic slurs
  "faggot",
  "fagot",
  "dyke",
  "homo",
  "fag",
  // Extreme insults (only severe, clinical-level hate terms)
  "retard",
  "retarded",
  // Severe abuse
  "whore",
  "slut",
  "bitch",
  "cunt",
  "dickhead",
  "asshole",
  // Hindi slurs
  "bhenchod",
  "madarchod",
  "chutiya",
  "gandu",
  "bhosadike",
  "randi",
  "haramkhor",
  "kamina",
  "suar",
  "kutte",
  "kutiya",
  "saale",
  "bhadwe",
  "bhosadi",
  "chudakkad",
  "chod",
  "jhantu",
  // Add more as needed - this list is configurable
];

// === IN-MEMORY STORAGE ===
const blockedWords = {
  slurs: DEFAULT_SLURS,
  custom: [],
  updatedAt: Date.now(),
};

const slurViolations = {};
const penalties = {};

// === CONFIGURATION ===
const SLUR_CONFIG = {
  // Minimum word length to check (avoid blocking short common words)
  MIN_WORD_LENGTH: 3,
  
  // Context detection
  TARGETING_PATTERNS: [
    // Direct addressing
    /\byou\s+(are\s+)?(a?\s*)?/i,
    /\byou('re| are)\s+/i,
    /\bto\s+you\b/i,
    /\bfor\s+you\b/i,
    // Second person commands
    /\bshut\s+up\b/i,
    /\bgo\s+away\b/i,
    /\bstop\s+(it|that)\b/i,
    // References to other user
    /\bthey('re| are)\s+/i,
    /\bhim\s+/i,
    /\bher\s+/i,
    // Possessives targeting
    /\byour\s+/i,
    /\bmy\s+(friend|roommate|brother|sister|parent)/i,
  ],
  
  // Escalation thresholds
  WARN_THRESHOLD: 1,
  COOLDOWN_THRESHOLD: 2,
  MUTE_THRESHOLD: 3,
  
  // Time windows (ms)
  VIOLATION_WINDOW_MS: 300000,  // 5 minutes
  COOLDOWN_DURATION_MS: 30000,  // 30 seconds
  MUTE_DURATION_MS: 120000,     // 2 minutes
  
  // Messages
  WARNING_MESSAGE: "⚠️ hey, watch the language please 🙏 keep it chill in here!",
  BLOCKED_MESSAGE: "🚫 that message was blocked — not cool fam. take a breather 😮‍💨",
  MUTE_MESSAGE: "🔇 you've been temp-muted for 2 mins. use that time to reflect bestie 💀",
};

// === BLOCKED WORDS FUNCTIONS ===

function isSlur(word) {
  const allWords = [...blockedWords.slurs, ...blockedWords.custom].map(w => w.toLowerCase());
  return allWords.includes(word.toLowerCase());
}

function containsSlur(text) {
  if (!text || text.length === 0) return false;
  
  const words = text.toLowerCase().split(/\s+/);
  const allBlocked = [...blockedWords.slurs, ...blockedWords.custom].map(w => w.toLowerCase());
  
  if (allBlocked.length === 0) return false;
  
  return words.some(w => w.length > 2 && allBlocked.includes(w));
}

function addCustomWord(word) {
  const lowerWord = word.toLowerCase().trim();
  if (lowerWord && !blockedWords.custom.includes(lowerWord)) {
    blockedWords.custom.push(lowerWord);
    blockedWords.updatedAt = Date.now();
  }
}

function removeCustomWord(word) {
  blockedWords.custom = blockedWords.custom.filter(w => w !== word.toLowerCase());
  blockedWords.updatedAt = Date.now();
}

function getBlockedWords() {
  return [...blockedWords.slurs, ...blockedWords.custom];
}

// === CONTEXT-AWARE DETECTION ===

/**
 * Detect if text contains slurs and analyze context
 * Returns: { hasSlur: boolean, isTargeting: boolean, matchedWords: string[] }
 */
function detectSlurWithContext(text) {
  if (!text || text.length === 0) {
    return { hasSlur: false, isTargeting: false, matchedWords: [] };
  }
  
  const allBlocked = [...blockedWords.slurs, ...blockedWords.custom].map(w => w.toLowerCase());
  
  if (allBlocked.length === 0) {
    return { hasSlur: false, isTargeting: false, matchedWords: [] };
  }
  
  const lowerText = text.toLowerCase();
  const words = lowerText.split(/\s+/);
  const matchedWords = words.filter(w => w.length >= SLUR_CONFIG.MIN_WORD_LENGTH && allBlocked.includes(w));
  
  if (matchedWords.length === 0) {
    return { hasSlur: false, isTargeting: false, matchedWords: [] };
  }
  
  const isTargeting = SLUR_CONFIG.TARGETING_PATTERNS.some(pattern => pattern.test(text));
  
  return {
    hasSlur: true,
    isTargeting,
    matchedWords,
  };
}

// === VIOLATION TRACKING ===

function getUserSlurViolationCount(userId) {
  const userViolations = slurViolations[userId] || [];
  const windowStart = Date.now() - SLUR_CONFIG.VIOLATION_WINDOW_MS;
  
  return userViolations.filter(v => v.timestamp > windowStart).length;
}

function addSlurViolation(userId, message, isTargeting) {
  if (!slurViolations[userId]) {
    slurViolations[userId] = [];
  }
  
  slurViolations[userId].push({
    timestamp: Date.now(),
    message: message.slice(0, 50),
    isTargeting,
  });
  
  const windowStart = Date.now() - SLUR_CONFIG.VIOLATION_WINDOW_MS;
  slurViolations[userId] = slurViolations[userId].filter(v => v.timestamp > windowStart);
  
  if (slurViolations[userId].length > 20) {
    slurViolations[userId] = slurViolations[userId].slice(-20);
  }
  
  return getUserSlurViolationCount(userId);
}

function getSlurPenalty(userId) {
  const violationCount = getUserSlurViolationCount(userId);
  
  if (violationCount >= SLUR_CONFIG.MUTE_THRESHOLD) {
    return {
      type: "mute",
      duration: SLUR_CONFIG.MUTE_DURATION_MS,
      message: SLUR_CONFIG.MUTE_MESSAGE,
    };
  }
  
  if (violationCount >= SLUR_CONFIG.WARN_THRESHOLD) {
    return {
      type: "warning",
      duration: 0,
      message: SLUR_CONFIG.WARNING_MESSAGE,
    };
  }
  
  return null;
}

// === PENALTY TRACKING ===

function applyPenalty(userId, penaltyType, durationMs) {
  penalties[userId] = {
    type: penaltyType,
    startTime: Date.now(),
    duration: durationMs,
    expiresAt: Date.now() + durationMs,
  };
}

function getActivePenalty(userId) {
  const penalty = penalties[userId];
  
  if (!penalty) return null;
  if (Date.now() > penalty.expiresAt) {
    delete penalties[userId];
    return null;
  }
  
  return penalty;
}

function clearPenalty(userId) {
  delete penalties[userId];
}

// === MAIN MODERATION FUNCTION ===

/**
 * Process a message through the slur filter with context-aware enforcement
 * Blocks messages when slurs detected but doesn't disconnect - applies cooldown/mute instead
 * Returns: { allowed: boolean, action: string, message?: string, hasSlur: boolean, isTargeting?: boolean, matchedWords?: string[], violationCount?: number }
 */
function moderateSlurMessage(userId, text) {
  const detection = detectSlurWithContext(text);
  
  if (!detection.hasSlur) {
    return { allowed: true, action: "allowed", hasSlur: false };
  }
  
  // Slur detected - track violations and determine penalty
  const violationCount = addSlurViolation(userId, text, detection.isTargeting);
  const penalty = getSlurPenalty(userId);
  
  // Apply penalty to system and block this message
  if (detection.isTargeting || penalty) {
    const penaltyType = penalty?.type || "cooldown";
    const duration = penalty?.duration || SLUR_CONFIG.COOLDOWN_DURATION_MS;
    applyPenalty(userId, penaltyType, duration);
    
    return {
      allowed: false,
      action: penaltyType,
      message: penalty?.message || SLUR_CONFIG.BLOCKED_MESSAGE,
      duration: duration,
      hasSlur: true,
      isTargeting: detection.isTargeting,
      matchedWords: detection.matchedWords,
      violationCount,
    };
  }
  
  // First offense, not clearly targeting - warn but allow
  return {
    allowed: true,
    action: "flagged",
    hasSlur: true,
    isTargeting: false,
    matchedWords: detection.matchedWords,
    violationCount,
    warning: SLUR_CONFIG.WARNING_MESSAGE,
  };
}

// === UTILITY FUNCTIONS ===

function clearUserSlurViolations(userId) {
  if (slurViolations[userId]) {
    delete slurViolations[userId];
  }
}

function getSlurStats() {
  const totalViolations = Object.values(slurViolations).reduce((sum, arr) => sum + arr.length, 0);
  const uniqueUsers = Object.keys(slurViolations).length;
  
  return {
    totalViolations,
    uniqueUsers,
    activeUsers: Object.keys(slurViolations).filter(u => slurViolations[u].length > 0).length,
  };
}

module.exports = {
  isSlur,
  containsSlur,
  addCustomWord,
  removeCustomWord,
  getBlockedWords,
  detectSlurWithContext,
  moderateSlurMessage,
  getUserSlurViolationCount,
  getSlurPenalty,
  clearUserSlurViolations,
  getSlurStats,
  applyPenalty,
  getActivePenalty,
  clearPenalty,
  SLUR_CONFIG,
};