// Slur/Profanity filter storage - In-Memory with File Persistence & Multi-Format Obfuscation Engine
const fs = require('fs');
const path = require('path');
const { analyzeConversationLine, isInnocentColloquialism } = require('../utils/conversationModerator');
const { recordChatSampleForTraining } = require('../services/modelTrainer');

const PENALTIES_FILE = path.join(__dirname, '../../data/penalties.json');
const VIOLATIONS_FILE = path.join(__dirname, '../../data/slur_violations.json');

// === CONFIGURABLE BLOCKED WORDS LIST ===
// Comprehensive slurs, severe hate speech, homophobic, racial, transphobic, ableist, misogynistic, predatory and abusive terms
const DEFAULT_SLURS = [
  // Predatory, grooming & sexual exploitation terms (including memes & variants)
  "diddy",
  "dixxy",
  "diddi",
  "diddie",
  "diddler",
  "diddling",
  "diddled",
  "epstein",
  "chomo",
  "noncer",
  "groomer",
  "pedophile",
  "pedo",
  "paedo",
  "jailbait",

  // Racial/ethnic slurs (English & Global)
  "nigger",
  "nigga",
  "niggaz",
  "negro",
  "chink",
  "gook",
  "spic",
  "wetback",
  "kike",
  "coon",
  "paki",
  "beaner",
  "raghead",
  "towelhead",
  "gypsy",
  "jap",
  "cracker",
  "zipperhead",
  "tarbaby",

  // Homophobic & transphobic slurs
  "faggot",
  "fagot",
  "fag",
  "fags",
  "dyke",
  "homo",
  "tranny",
  "shemale",
  "transvestite",

  // Ableist slurs (clinical/severe hate speech insults)
  "retard",
  "retarded",
  "tard",
  "spastic",
  "mongoloid",

  // Severe misogynistic abuse & explicit sexual degradation
  "whore",
  "slut",
  "bitch",
  "cunt",
  "dickhead",
  "asshole",
  "twat",
  "motherfucker",
  "bastard",

  // Hindi / Urdu / South Asian slurs
  "bhenchod",
  "behenchod",
  "madarchod",
  "mc",
  "bc",
  "chutiya",
  "chutiye",
  "gandu",
  "bhosadike",
  "bhosdike",
  "bhosadi",
  "bhosdi",
  "randi",
  "haramkhor",
  "harami",
  "kamina",
  "kamine",
  "suar",
  "kutte",
  "kutiya",
  "saale",
  "saala",
  "bhadwe",
  "bhadwa",
  "chudakkad",
  "chod",
  "chodo",
  "jhantu",
  "laude",
  "lauda",
  "lavde",
  "lund",
  "chinal",
  "randwa",

  // Spanish & International slurs
  "maricon",
  "puta",
  "puto",
  "culero",
  "pendejo",
  "cabron",
  "hijo de puta"
];

// Common false-positive substrings to explicitly protect from naive boundary collisions
const SAFE_EXCEPTIONS = [
  "classic",
  "class",
  "password",
  "pass",
  "assistant",
  "assist",
  "grass",
  "bass",
  "glass",
  "mass",
  "butter",
  "butterfly",
  "cocktail",
  "country",
  "countries",
  "spicy",
  "spice",
  "assemble",
  "assembly",
  "analytics",
  "analysis",
  "document",
  "snigger",
  "niger",
  "nigeria",
  "dickens",
  "cucumber",
  "canal",
  "penistone",
  "exam",
  "test",
  "quiz",
  "interview",
  "presentation"
];

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
} catch (e) {
  // Fail-open to in-memory
}

try {
  if (fs.existsSync(PENALTIES_FILE)) {
    const raw = fs.readFileSync(PENALTIES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.penalties === 'object') {
      penalties = parsed.penalties;
    }
  }
} catch (e) {
  // Fail-open to in-memory
}

function saveViolationsToFile() {
  try {
    fs.writeFileSync(VIOLATIONS_FILE, JSON.stringify({ violations: slurViolations }, null, 2), 'utf8');
  } catch (e) {
    // Non-blocking on ephemeral filesystems
  }
}

function savePenaltiesToFile() {
  try {
    fs.writeFileSync(PENALTIES_FILE, JSON.stringify({ penalties }, null, 2), 'utf8');
  } catch (e) {
    // Non-blocking on ephemeral filesystems
  }
}

// Periodic cleanup of expired violations and penalties
setInterval(() => {
  const now = Date.now();
  const windowStart = now - (SLUR_CONFIG?.VIOLATION_WINDOW_MS || 3600000);
  let changedViolations = false;
  let changedPenalties = false;

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

  for (const id of Object.keys(penalties)) {
    const penalty = penalties[id];
    if (!penalty || now > penalty.expiresAt) {
      delete penalties[id];
      changedPenalties = true;
    }
  }

  if (changedViolations) saveViolationsToFile();
  if (changedPenalties) savePenaltiesToFile();
}, 60000).unref();

// === CONFIGURATION ===
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
  
  WARN_THRESHOLD: 1,
  SECOND_OFFENSE_THRESHOLD: 2,
  BAN_THRESHOLD: 3,

  // Limits for different chat environments
  EXPLORE_LIMIT: 3,
  FRIEND_LIMIT: 5,
  
  VIOLATION_WINDOW_MS: 3600000, // 1 hour tracking window
  BAN_DURATION_MS: 900000,      // 15 minutes
  
  WARNING_1_MESSAGE: "⚠️ Warning (1/3): Inappropriate language detected. Message was not sent. Please keep conversations respectful!",
  WARNING_2_MESSAGE: "⚠️ Warning (2/3): Inappropriate language detected again. Message was not sent. One more violation will result in a 15-minute ban!",
  BAN_MESSAGE: "⚠️ You have been banned for 15 minutes due to repeated inappropriate language or slurs.",
  PARTNER_NOTIFIED_MESSAGE: "🛡️ The abuser has been banned for 15mins for using bad behaviour.",
};

/**
 * Normalizes text homoglyphs (Cyrillic, Greek, Math symbols -> Latin)
 */
function normalizeHomoglyphs(text) {
  if (!text || typeof text !== 'string') return '';
  const homoglyphMap = {
    'а': 'a', 'а́': 'a', 'а̀': 'a', 'ą': 'a', 'ä': 'a', 'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a',
    'в': 'b', 'Ь': 'b', 'Ъ': 'b',
    'с': 'c', 'ć': 'c', 'ç': 'c', 'č': 'c',
    'е': 'e', 'е́': 'e', 'ѐ': 'e', 'ę': 'e', 'ë': 'e', 'è': 'e', 'é': 'e', 'ê': 'e', 'з': 'e',
    'і': 'i', 'ї': 'i', 'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i',
    'ј': 'j',
    'к': 'k',
    'о': 'o', 'о́': 'o', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o',
    'р': 'p',
    'ѕ': 's', 'ś': 's', 'š': 's', 'ş': 's',
    'т': 't',
    'у': 'y', 'ý': 'y', 'ÿ': 'y',
    'х': 'x', 'ҳ': 'x',
    'ѡ': 'w', 'ш': 'w',
    'ѵ': 'v'
  };

  let result = text;
  for (const [nonLatin, latin] of Object.entries(homoglyphMap)) {
    result = result.replace(new RegExp(nonLatin, 'gi'), latin);
  }
  return result;
}

/**
 * Collapses multi-line vertical text (e.g., "d\ni\nd\nd\ny" -> "diddy")
 */
function collapseVerticalText(text) {
  if (!text || typeof text !== 'string') return '';
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.every(l => l.length <= 3)) {
    return lines.join('');
  }
  return text.replace(/([a-zA-Z0-9])[\r\n]+([a-zA-Z0-9])/g, '$1$2');
}

/**
 * Collapses spaced single letters (e.g. "d i d d y" -> "diddy", "d  i  x  x  y" -> "dixxy")
 */
function collapseSpacedLetters(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/\b([a-zA-Z0-9])(?:\s+([a-zA-Z0-9]))+\b/g, (match) => {
    return match.replace(/\s+/g, '');
  });
}

/**
 * Strips all masked spacer punctuation (dots, hyphens, underscores, slashes, tildes, asterisks)
 * e.g., "di...dd...y" -> "diddy", "d-i-d-d-y" -> "diddy", "d*i*x*x*y" -> "dixxy"
 */
function sanitizeMaskedText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF\u00A0\u2000-\u200F\u0300-\u036F]/g, '') // strip invisible unicode
    .replace(/[\s\.\-_,\/\\~\|\*\^#%+=:;'"!?`]+/g, '');
}

/**
 * Normalizes phonetic and common slang substitutions (e.g., "dixxy" -> "diddy", "puxxy" -> "pussy")
 */
function normalizePhoneticSubstitutions(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/\bdix+y\b/g, 'diddy')
    .replace(/\bdid+i\b/g, 'diddy')
    .replace(/\bdid+ie\b/g, 'diddy')
    .replace(/\bdyd+y\b/g, 'diddy')
    .replace(/\bd1x+y\b/g, 'diddy')
    .replace(/\bpux+y\b/g, 'pussy')
    .replace(/\bnix+a\b/g, 'nigga')
    .replace(/\bbix+ch\b/g, 'bitch');
}

/**
 * Normalizes leetspeak, zero-width chars, and tricky symbol substitutions
 */
function normalizeLeetspeak(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF\u00A0\u2000-\u200F\u0300-\u036F]/g, '') // strip zero-width characters
    .replace(/[@4^]/g, 'a')
    .replace(/[8]/g, 'b')
    .replace(/[(\[<]/g, 'c')
    .replace(/[3€]/g, 'e')
    .replace(/[69]/g, 'g')
    .replace(/[#]/g, 'h')
    .replace(/[!1|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/[+7]/g, 't')
    .replace(/[v]/g, 'u')
    .replace(/(.)\1{2,}/g, '$1$1'); // compress 3+ repeating characters e.g. fffffaaag -> faag
}

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

// === CONTEXT-AWARE DETECTION ===

/**
 * Detect if text contains slurs or bad conversation attempts in ANY format:
 * - "dixxy" (phonetic / slang for "diddy")
 * - "di...dd...y", "d-i-d-d-y", "d.i.d.d.y", "d*i*x*x*y"
 * - vertical multi-line: "d\ni\nd\nd\ny"
 * - spaced out: "d i d d y"
 * - homoglyphs & leetspeak
 *
 * Guaranteed 0 false positives for safe colloquial expressions like "I'm gonna kill this exam!".
 *
 * Returns: { hasSlur: boolean, isTargeting: boolean, matchedWords: string[], category?: string, warningMessage?: string }
 */
function detectSlurWithContext(text) {
  if (!text || typeof text !== 'string') {
    return { hasSlur: false, isTargeting: false, matchedWords: [] };
  }

  const rawTrimmed = text.trim();
  if (!rawTrimmed) {
    return { hasSlur: false, isTargeting: false, matchedWords: [] };
  }

  // 1. Check if string is an innocent colloquialism (e.g., "I'm gonna kill this exam!")
  if (isInnocentColloquialism(rawTrimmed)) {
    return { hasSlur: false, isTargeting: false, matchedWords: [] };
  }

  const rawLower = rawTrimmed.toLowerCase();

  // Check if string is simply an innocent safe word
  for (const safeWord of SAFE_EXCEPTIONS) {
    if (rawLower === safeWord) {
      return { hasSlur: false, isTargeting: false, matchedWords: [] };
    }
  }

  // Conversational text-line understanding: threats, stalking, extortion, sexual harassment, cyberbullying, predatory slang
  const conv = analyzeConversationLine(rawTrimmed);
  if (conv.isThreat || conv.isHarassment) {
    return {
      hasSlur: true,
      isTargeting: true,
      matchedWords: [conv.reason || 'threat_or_harassment'],
      category: conv.category,
      warningMessage: conv.warningMessage
    };
  }

  const allBlocked = [...blockedWords.slurs, ...blockedWords.custom].map(w => w.toLowerCase());
  if (allBlocked.length === 0) {
    return { hasSlur: false, isTargeting: false, matchedWords: [] };
  }

  // Build all normalized variations of the message for multi-format inspection
  const homoglyphNormalized = normalizeHomoglyphs(rawLower);
  const verticalCollapsed = collapseVerticalText(homoglyphNormalized);
  const spacedCollapsed = collapseSpacedLetters(homoglyphNormalized);
  const leetNormalized = normalizeLeetspeak(homoglyphNormalized);
  const strippedSpacers = sanitizeMaskedText(homoglyphNormalized);
  const phoneticNormalized = normalizePhoneticSubstitutions(homoglyphNormalized);
  const strippedPhonetic = normalizePhoneticSubstitutions(strippedSpacers);
  const verticalPhonetic = normalizePhoneticSubstitutions(verticalCollapsed);

  const candidateRepresentations = [
    rawLower,
    homoglyphNormalized,
    verticalCollapsed,
    spacedCollapsed,
    leetNormalized,
    strippedSpacers,
    phoneticNormalized,
    strippedPhonetic,
    verticalPhonetic
  ];

  const matched = new Set();

  // 1. Direct and normalized token matching
  for (const rep of candidateRepresentations) {
    const tokens = rep.split(/[\s,\.!?_\\/~|\*\^#%+=:;'"`]+/).filter(Boolean);
    for (const t of tokens) {
      if (t.length >= SLUR_CONFIG.MIN_WORD_LENGTH && allBlocked.includes(t)) {
        matched.add(t);
      }
    }
  }

  // 2. Substring & masked spacer matching for severe slurs & bad conversation keywords
  for (const slur of allBlocked) {
    if (slur.length < 3) continue;

    const regex = new RegExp(`\\b${slur}\\b`, 'i');

    for (const rep of candidateRepresentations) {
      if (regex.test(rep)) {
        matched.add(slur);
      }
    }

    // Stripped spacers check (e.g. "di...dd...y", "n.i.g.g.e.r", "d-i-d-d-y", "b h e n c h o d")
    if (strippedSpacers.includes(slur) || strippedPhonetic.includes(slur)) {
      // Ensure it's not a benign subword false positive
      const isBenignSubword = SAFE_EXCEPTIONS.some(safe => strippedSpacers.includes(safe));
      if (!isBenignSubword) {
        matched.add(slur);
      }
    }
  }

  const matchedWords = Array.from(matched);
  if (matchedWords.length === 0) {
    return { hasSlur: false, isTargeting: false, matchedWords: [] };
  }

  const isTargeting = SLUR_CONFIG.TARGETING_PATTERNS.some(pattern => pattern.test(rawTrimmed) || pattern.test(leetNormalized));

  return {
    hasSlur: true,
    isTargeting,
    matchedWords,
    category: 'inappropriate_bad_conversation'
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
  const isFriendChat = scope === 'friend';
  const banLimit = isFriendChat ? SLUR_CONFIG.FRIEND_LIMIT : SLUR_CONFIG.EXPLORE_LIMIT;
  
  if (violationCount >= banLimit) {
    return {
      type: "ban_15min",
      duration: SLUR_CONFIG.BAN_DURATION_MS,
      message: SLUR_CONFIG.BAN_MESSAGE,
      violationCount,
      maxStrikes: banLimit,
    };
  }
  
  if (!isFriendChat) {
    // Explore chat (3-strike policy)
    if (violationCount === 2) {
      return {
        type: "warning_2",
        duration: 0,
        message: "⚠️ Warning (2/3): Inappropriate language detected again. Message was not sent. One more violation will result in a 15-minute ban!",
        violationCount,
        maxStrikes: 3,
      };
    }
    return {
      type: "warning_1",
      duration: 0,
      message: "⚠️ Warning (1/3): Inappropriate language detected. Message was not sent. Please keep conversations respectful!",
      violationCount,
      maxStrikes: 3,
    };
  } else {
    // Friends chat (5-strike policy)
    if (violationCount === 4) {
      return {
        type: "warning_4",
        duration: 0,
        message: "⚠️ Warning (4/5): Final warning! One more inappropriate message in friend chat will result in a 15-minute ban!",
        violationCount,
        maxStrikes: 5,
      };
    }
    if (violationCount === 3) {
      return {
        type: "warning_3",
        duration: 0,
        message: "⚠️ Warning (3/5): Inappropriate language detected again. Message was not sent. Continued violations will result in a 15-minute ban!",
        violationCount,
        maxStrikes: 5,
      };
    }
    if (violationCount === 2) {
      return {
        type: "warning_2",
        duration: 0,
        message: "⚠️ Warning (2/5): Inappropriate language detected again in friend chat. Message was not sent.",
        violationCount,
        maxStrikes: 5,
      };
    }
    return {
      type: "warning_1",
      duration: 0,
      message: "⚠️ Warning (1/5): Inappropriate language detected in friend chat. Message was not sent. Please keep conversations respectful!",
      violationCount,
      maxStrikes: 5,
    };
  }
}

// === PENALTY TRACKING ===

function applyPenalty(userId, penaltyType, durationMs) {
  if (!userId) return;
  penalties[userId] = {
    type: penaltyType,
    startTime: Date.now(),
    duration: durationMs,
    expiresAt: Date.now() + durationMs,
  };
  savePenaltiesToFile();
}

function getActivePenalty(userId) {
  if (!userId) return null;
  const penalty = penalties[userId];
  if (!penalty) return null;
  if (Date.now() > penalty.expiresAt) {
    delete penalties[userId];
    savePenaltiesToFile();
    return null;
  }
  return penalty;
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
  
  // Slur / Bad conversation detected - increment violation count
  const userCount = addSlurViolation(userId, text, detection.isTargeting, scope);
  let ipCount = 0;
  if (ip && ip !== userId && ip !== "127.0.0.1" && ip !== "::1") {
    ipCount = addSlurViolation(ip, text, detection.isTargeting, scope);
  }
  const violationCount = Math.max(userCount, ipCount);
  const penalty = getSlurPenalty(userId, ip, scope);

  if (penalty?.type === "ban_15min") {
    applyPenalty(userId, penalty.type, penalty.duration);
    if (ip && ip !== userId && ip !== "127.0.0.1" && ip !== "::1") {
      applyPenalty(ip, penalty.type, penalty.duration);
    }
  }

  // Active learning: Feed the detected bad conversation attempt into the model trainer
  recordChatSampleForTraining(text, 1, detection.category || 'bad_conversation_blocked', {
    userId,
    matchedWords: detection.matchedWords,
    scope
  });
  
  return {
    allowed: false, // NEVER send the message when bad language/slur/bad conversation is detected!
    action: penalty?.type || "warning_1",
    message: penalty?.message || SLUR_CONFIG.WARNING_1_MESSAGE,
    duration: penalty?.duration || 0,
    hasSlur: true,
    isTargeting: detection.isTargeting,
    matchedWords: detection.matchedWords,
    violationCount,
    maxStrikes: penalty?.maxStrikes || (scope === 'friend' ? 5 : 3),
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
  sanitizeMaskedText,
  normalizePhoneticSubstitutions,
  SLUR_CONFIG,
};
