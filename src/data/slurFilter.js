// Slur/Profanity filter storage - In-Memory with File Persistence & Unified Gen Z Inbuilt Engine
const fs = require('fs');
const path = require('path');
const { recordChatSampleForTraining } = require('../services/modelTrainer');
const {
  evaluateMessage,
  detectPhoneNumber,
  detectAskingForPhoneNumber,
  detectSocialMediaSharing,
  detectRestrictedSymbols,
  isKeyboardMashOrCharacterFlood,
  isVerticalLetterSpam,
  isInnocentColloquialism,
  normalizeHomoglyphs,
  collapseVerticalText,
  collapseSpacedLetters,
  stripAllSymbols,
  normalizeLeetspeak,
  normalizePhoneticSubstitutions,
  collapseRepeatedChars,
  collapseElongatedVowels,
  detectMaskedBadWords,
  GLOBAL_SLURS_VOCABULARY,
  POLITE_MESSAGES
} = require('../utils/unifiedModerator');

const PENALTIES_FILE = path.join(__dirname, '../../data/penalties.json');
const VIOLATIONS_FILE = path.join(__dirname, '../../data/slur_violations.json');

// Global comprehensive slurs & Gen Z slang list
const DEFAULT_SLURS = [...GLOBAL_SLURS_VOCABULARY];

// === IN-MEMORY & PERSISTENT STORAGE ===
const blockedWords = {
  slurs: DEFAULT_SLURS,
  custom: [],
  updatedAt: Date.now(),
};

let slurViolations = {};
let penalties = {};

// Hydrate violations and penalties from disk if available
try {
  if (fs.existsSync(VIOLATIONS_FILE)) {
    const raw = fs.readFileSync(VIOLATIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.violations === 'object') {
      slurViolations = parsed.violations;
    }
  }
} catch (e) {}

try {
  if (fs.existsSync(PENALTIES_FILE)) {
    const raw = fs.readFileSync(PENALTIES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.penalties === 'object') {
      penalties = parsed.penalties;
    }
  }
} catch (e) {}

let saveViolationsTimeout = null;
let isSavingViolations = false;

function saveViolationsToFile() {
  if (saveViolationsTimeout) return;
  saveViolationsTimeout = setTimeout(async () => {
    saveViolationsTimeout = null;
    if (isSavingViolations) return;
    isSavingViolations = true;
    try {
      await fs.promises.writeFile(VIOLATIONS_FILE, JSON.stringify({ violations: slurViolations }, null, 2), 'utf8');
    } catch (e) {} finally {
      isSavingViolations = false;
    }
  }, 1000);
  if (typeof saveViolationsTimeout.unref === 'function') {
    saveViolationsTimeout.unref();
  }
}

let savePenaltiesTimeout = null;
let isSavingPenalties = false;

function savePenaltiesToFile() {
  if (savePenaltiesTimeout) return;
  savePenaltiesTimeout = setTimeout(async () => {
    savePenaltiesTimeout = null;
    if (isSavingPenalties) return;
    isSavingPenalties = true;
    try {
      await fs.promises.writeFile(PENALTIES_FILE, JSON.stringify({ penalties }, null, 2), 'utf8');
    } catch (e) {} finally {
      isSavingPenalties = false;
    }
  }, 1000);
  if (typeof savePenaltiesTimeout.unref === 'function') {
    savePenaltiesTimeout.unref();
  }
}

// Periodic cleanup of expired violations
setInterval(() => {
  const now = Date.now();
  const windowStart = now - (SLUR_CONFIG?.VIOLATION_WINDOW_MS || 3600000);
  let changedViolations = false;

  for (const id of Object.keys(slurViolations)) {
    const list = slurViolations[id];
    if (!list || list.length === 0) {
      delete slurViolations[id];
      changedViolations = true;
      continue;
    }
    const active = list.filter(v => v.timestamp > windowStart);
    if (active.length === 0) {
      delete slurViolations[id];
      changedViolations = true;
    } else if (active.length !== list.length) {
      slurViolations[id] = active;
      changedViolations = true;
    }
  }

  if (changedViolations) saveViolationsToFile();
}, 60000).unref();

// === CONFIGURATION (NICE LABEL: "Please don't use bad words here", NO BAN) ===
const SLUR_CONFIG = {
  MIN_WORD_LENGTH: 3,

  TARGETING_PATTERNS: [
    /\byou\s+(are\s+)?(a?\s*)?/i,
    /\byou('re| are)\s+/i,
    /\bto\s+you\b/i,
    /\bfor\s+you\b/i,
    /\bshut\s+up\b/i,
    /\bgo\s+away\b/i,
    /\bstop\s+(it|that)\b/i,
    /\bthey('re| are)\s+/i,
    /\bhim\s+/i,
    /\bher\s+/i,
    /\byour\s+/i,
    /\bu\s+r\b/i,
    /\bur\s+/i,
    /\bmy\s+(friend|roommate|brother|sister|parent)/i,
  ],

  // 15-minute ban is removed per user instruction. Messages are simply blocked with the nice label.
  BAN_THRESHOLD: Infinity,
  EXPLORE_LIMIT: Infinity,
  FRIEND_LIMIT: Infinity,

  VIOLATION_WINDOW_MS: 3600000, // 1 hour tracking window
  BAN_DURATION_MS: 0,          // No ban duration

  // Nice friendly label
  WARNING_1_MESSAGE: POLITE_MESSAGES.BAD_WORDS_LABEL,
  WARNING_2_MESSAGE: POLITE_MESSAGES.BAD_WORDS_LABEL,
  BAN_MESSAGE: POLITE_MESSAGES.BAD_WORDS_LABEL,
  LABEL: POLITE_MESSAGES.BAD_WORDS_PLAIN,
  PARTNER_NOTIFIED_MESSAGE: POLITE_MESSAGES.PARTNER_NOTIFIED,
};

// === BLOCKED WORDS FUNCTIONS ===

function isSlur(word) {
  if (!word) return false;
  const lower = word.toLowerCase().trim();
  const allWords = [...blockedWords.slurs, ...blockedWords.custom].map(w => w.toLowerCase());
  return allWords.includes(lower);
}

function containsSlur(text) {
  const result = detectSlurWithContext(text);
  return result.hasSlur;
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

function getCustomWords() {
  return [...blockedWords.custom];
}

// === CONTEXT-AWARE DETECTION (POWERED BY UNIFIED INBUILT MODEL) ===

/**
 * Detect if text contains slurs or bad conversation attempts in ANY format, language or Gen Z slang.
 */
function detectSlurWithContext(text) {
  if (!text || typeof text !== 'string') {
    return { hasSlur: false, isTargeting: false, matchedWords: [] };
  }

  const rawTrimmed = text.trim();
  if (!rawTrimmed) {
    return { hasSlur: false, isTargeting: false, matchedWords: [] };
  }

  // Check custom words added at runtime
  if (blockedWords.custom.length > 0) {
    const rawLower = rawTrimmed.toLowerCase();
    for (const cw of blockedWords.custom) {
      if (rawLower.includes(cw)) {
        return {
          hasSlur: true,
          isTargeting: true,
          matchedWords: [cw],
          category: 'custom_slur',
          warningMessage: SLUR_CONFIG.WARNING_1_MESSAGE,
          label: SLUR_CONFIG.LABEL
        };
      }
    }
  }

  // Unified evaluation
  const result = evaluateMessage(rawTrimmed);

  if (result.valid) {
    return { hasSlur: false, isTargeting: false, matchedWords: [] };
  }

  const isTargeting = SLUR_CONFIG.TARGETING_PATTERNS.some(pattern => pattern.test(rawTrimmed));

  return {
    hasSlur: true,
    isTargeting,
    matchedWords: result.matchedWords && result.matchedWords.length > 0 ? result.matchedWords : [result.reason || 'inappropriate_conversation'],
    category: result.category || 'inappropriate_bad_conversation',
    warningMessage: SLUR_CONFIG.WARNING_1_MESSAGE,
    label: SLUR_CONFIG.LABEL
  };
}

// === VIOLATION TRACKING ===

function getScopedId(id, scope = 'explore') {
  if (!id) return '';
  return `${id}:${scope || 'explore'}`;
}

function getUserSlurViolationCount(userId, scope = 'explore') {
  if (!userId) return 0;
  const scopedKey = getScopedId(userId, scope);
  const userViolations = slurViolations[scopedKey] || [];
  const windowStart = Date.now() - SLUR_CONFIG.VIOLATION_WINDOW_MS;
  return userViolations.filter(v => v.timestamp > windowStart).length;
}

function addSlurViolation(userId, message, isTargeting, scope = 'explore') {
  if (!userId) return 0;
  const scopedKey = getScopedId(userId, scope);
  if (!slurViolations[scopedKey]) {
    slurViolations[scopedKey] = [];
  }

  slurViolations[scopedKey].push({
    timestamp: Date.now(),
    message: String(message || '').slice(0, 50),
    isTargeting: Boolean(isTargeting),
    scope: scope || 'explore',
  });

  const windowStart = Date.now() - SLUR_CONFIG.VIOLATION_WINDOW_MS;
  slurViolations[scopedKey] = slurViolations[scopedKey].filter(v => v.timestamp > windowStart);

  if (slurViolations[scopedKey].length > 50) {
    slurViolations[scopedKey] = slurViolations[scopedKey].slice(-50);
  }

  saveViolationsToFile();
  return getUserSlurViolationCount(userId, scope);
}

function getSlurPenalty(userId, ip = null, scope = 'explore') {
  const countUser = getUserSlurViolationCount(userId, scope);
  const countIp = ip && ip !== userId ? getUserSlurViolationCount(ip, scope) : 0;
  const violationCount = Math.max(countUser, countIp);

  // Per user specification: No 15-minute ban! Just return the friendly label notice.
  return {
    type: "label_warning",
    duration: 0,
    message: SLUR_CONFIG.WARNING_1_MESSAGE,
    label: SLUR_CONFIG.LABEL,
    violationCount,
    maxStrikes: Infinity,
  };
}

// === PENALTY TRACKING ===

function applyPenalty(userId, penaltyType, durationMs) {
  // Bans are disabled per user request
}

function getActivePenalty(userId) {
  // Bans are disabled per user request
  return null;
}

function clearPenalty(userId) {
  if (!userId) return;
  if (penalties[userId]) {
    delete penalties[userId];
    savePenaltiesToFile();
  }
}

// === MAIN MODERATION FUNCTION ===

function moderateSlurMessage(userId, text, ip = null, scope = 'explore') {
  const detection = detectSlurWithContext(text);

  if (!detection.hasSlur) {
    return { allowed: true, action: "allowed", hasSlur: false };
  }

  // Slur / Bad conversation detected - increment tracking count without banning
  const userCount = addSlurViolation(userId, text, detection.isTargeting, scope);
  let ipCount = 0;
  if (ip && ip !== userId && ip !== "127.0.0.1" && ip !== "::1") {
    ipCount = addSlurViolation(ip, text, detection.isTargeting, scope);
  }
  const violationCount = Math.max(userCount, ipCount);

  // Active learning: Feed the detected bad conversation attempt into the model trainer
  recordChatSampleForTraining(text, 1, detection.category || 'bad_conversation_blocked', {
    userId,
    matchedWords: detection.matchedWords,
    scope
  });

  // User specification: Do NOT ban! Just don't send the message, and give the offender the nice label.
  return {
    allowed: false, // NEVER send the message
    action: "blocked_label",
    message: SLUR_CONFIG.WARNING_1_MESSAGE,
    label: SLUR_CONFIG.LABEL,
    duration: 0,
    hasSlur: true,
    isTargeting: detection.isTargeting,
    matchedWords: detection.matchedWords,
    violationCount,
    maxStrikes: Infinity,
    scope,
  };
}

// === UTILITY FUNCTIONS ===

function clearUserSlurViolations(userId, scope = null) {
  if (!userId) return;
  if (scope) {
    const scopedKey = getScopedId(userId, scope);
    delete slurViolations[scopedKey];
  } else {
    delete slurViolations[userId];
    delete slurViolations[`${userId}:explore`];
    delete slurViolations[`${userId}:friend`];
  }
  saveViolationsToFile();
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
  getCustomWords,
  detectSlurWithContext,
  moderateSlurMessage,
  addSlurViolation,
  getUserSlurViolationCount,
  getSlurPenalty,
  clearUserSlurViolations,
  getSlurStats,
  applyPenalty,
  getActivePenalty,
  clearPenalty,
  normalizeLeetspeak,
  normalizeHomoglyphs,
  collapseVerticalText,
  collapseSpacedLetters,
  stripAllSymbols,
  collapseRepeatedChars,
  collapseElongatedVowels,
  detectMaskedBadWords,
  normalizePhoneticSubstitutions,
  SLUR_CONFIG,
  POLITE_MESSAGES
};
