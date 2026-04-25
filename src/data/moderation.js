// Chat moderation system - IN-MEMORY (for ephemeral file systems like Render free tier)
// === MODERATION PATTERNS ===
// Patterns for detecting gender/age questions - case-insensitive
// Only target specific question patterns, NOT single letters or normal words
const GENDER_PATTERNS = [
  // Direct gender questions with ? or as direct question
  /\bm\?\s*$/i,
  /\bf\?\s*$/i,
  /\bmale\?/i,
  /\bfemale\?/i,
  /\bwoman\?/i,
  /\bman\?/i,
  /\bboy\?/i,
  /\bgirl\?/i,
  // Gender combinations (m/f, f/m, male or female, etc.)
  /\bm\s*[\/\\|]\s*f/i,
  /\bf\s*[\/\\|]\s*m/i,
  /\bm\s*or\s*f\b/i,
  /\bf\s*or\s*m\b/i,
  /\bmale\s+or\s+female/i,
  /\bfemale\s+or\s+male/i,
  /\bboy\s+or\s+girl/i,
  /\bgirl\s+or\s+boy/i,
  // Full question patterns
  /\bwhat\s+is\s+your\s+gender/i,
  /\byour\s+gender\??$/i,
  /\bgender\??\s*$/i,
  /\bare\s+you\s+(male|female|man|woman|boy|girl)/i,
  /\bdo\s+you\s+(like\s+)?(boys?|girls?|men|women)/i,
  // Spacing tricks detection
  /\bm\s{1,3}\?\s*$/i,
  /\bf\s{1,3}\?\s*$/i,
];

const AGE_PATTERNS = [
  // Direct age questions
  /\bage\??\s*$/i,
  /\bhow\s+old\b/i,
  /\bwhat\s+age\b/i,
  /\byour\s+age\b/i,
  /\bold\s+are\s+you/i,
  /\bare\s+you\s+\d+/i,
  /\b\d+\s+years?\s+old/i,
  /\b\d+\s+yo\b/i,
  /\bteen\??\s*$/i,
  /\bunder\s+\d+/i,
  /\bover\s+\d+/i,
  // ASL - age, sex, location
  /\basl\b/i,
  /\ba\.s\.l\b/i,
  /\bage\s*,\s*sex/i,
  /\bsex\s*,\s*location/i,
  // Age + location combinations
  /\bwhere\s+.*\bage\b/i,
  /\bage\s+.*\bwhere\b/i,
  // How old exactly patterns
  /\bhow\s+old\s+(are\s+you|is\s+your)/i,
  /\bwhat('s| is)\s+your\s+age/i,
];

// Combined patterns for any gender/age question
const LOW_QUALITY_PATTERNS = [...GENDER_PATTERNS, ...AGE_PATTERNS];

// === CONFIGURATION ===
const MODERATION_CONFIG = {
  // Warning messages
  WARNING_MESSAGE: "Please avoid asking about gender or age. Try starting a real conversation!",
  REPLACEMENT_MESSAGE: "Try starting a real conversation",
  
  // Escalation thresholds
  WARN_THRESHOLD: 1,        // First violation = warning
  COOLDOWN_THRESHOLD: 3,    // 3 violations = cooldown
  MUTE_THRESHOLD: 5,        // 5 violations = temporary mute
  
  // Time windows (in ms)
  VIOLATION_WINDOW_MS: 60000,    // 1 minute window for counting violations
  COOLDOWN_DURATION_MS: 30000,   // 30 second cooldown
  MUTE_DURATION_MS: 120000,      // 2 minute mute
  
  // Pattern matching
  MIN_PATTERN_LENGTH: 2,         // Minimum pattern length to check
};

// === IN-MEMORY VIOLATION STORAGE ===
const violations = {};

// === CORE DETECTION FUNCTIONS ===

/**
 * Check if message contains low-quality patterns (gender/age questions)
 * Returns null if message is clean, or the matched pattern info if blocked
 */
function detectLowQualityMessage(text) {
  if (!text || text.length < MODERATION_CONFIG.MIN_PATTERN_LENGTH) {
    return null;
  }
  
  const lowerText = text.toLowerCase().trim();
  
  // Check against all patterns
  for (const pattern of LOW_QUALITY_PATTERNS) {
    try {
      if (pattern.test(lowerText) || pattern.test(text)) {
        return {
          detected: true,
          pattern: pattern.toString(),
          matchedText: text,
        };
      }
    } catch (e) {
      // Skip invalid patterns
      continue;
    }
  }
  
  return null;
}

/**
 * Check if message is a normal conversation (should never be blocked)
 * This is a safety check to ensure we don't block legitimate messages
 */
function isNormalConversation(text) {
  if (!text) return false;
  
  const lower = text.toLowerCase();
  
  // Common greeting patterns
  const greetings = ['hi', 'hello', 'hey', 'yo', 'sup', 'what\'s up', 'wassup', 'good morning', 'good evening', 'good afternoon'];
  if (greetings.some(g => lower === g || lower.startsWith(g + ' '))) {
    return true;
  }
  
  // Common conversational starters
  const conversationStarters = [
    'how are you', 'how\'s it going', 'how do you', 'what\'s going on',
    'what are you', 'what do you', 'where are you', 'where do you',
    'nice to', 'pleasure to', 'happy to', 'glad to',
    'i am', 'i\'m', 'i am', 'my name is', 'call me',
    'what should we', 'let\'s talk about', 'do you like', 'are you into',
    'tell me about', 'share something', 'what do you think', 'what\'s your',
    'any plans', 'what are you doing', 'how\'s your', 'what brings',
  ];
  
  if (conversationStarters.some(s => lower.includes(s))) {
    return true;
  }
  
  // If message has multiple words and is longer, likely normal
  if (text.split(/\s+/).length >= 3 && text.length > 15) {
    return true;
  }
  
  return false;
}

// === VIOLATION TRACKING ===

function getUserViolationCount(userId) {
  const userViolations = violations[userId] || [];
  const windowStart = Date.now() - MODERATION_CONFIG.VIOLATION_WINDOW_MS;
  
  return userViolations.filter(v => v.timestamp > windowStart).length;
}

function addUserViolation(userId, message) {
  if (!violations[userId]) {
    violations[userId] = [];
  }
  
  violations[userId].push({
    timestamp: Date.now(),
    message: message.slice(0, 50),
  });
  
  // Clean old violations outside the window
  const windowStart = Date.now() - MODERATION_CONFIG.VIOLATION_WINDOW_MS;
  violations[userId] = violations[userId].filter(v => v.timestamp > windowStart);
  
  // Keep only last 20 violations per user
  if (violations[userId].length > 20) {
    violations[userId] = violations[userId].slice(-20);
  }
  
  return getUserViolationCount(userId);
}

function getUserPenalty(userId) {
  const violationCount = getUserViolationCount(userId);
  
  if (violationCount >= MODERATION_CONFIG.MUTE_THRESHOLD) {
    return {
      type: 'mute',
      duration: MODERATION_CONFIG.MUTE_DURATION_MS,
      message: "You've been temporarily muted for repeated low-quality messages.",
    };
  }
  
  if (violationCount >= MODERATION_CONFIG.COOLDOWN_THRESHOLD) {
    return {
      type: 'cooldown',
      duration: MODERATION_CONFIG.COOLDOWN_DURATION_MS,
      message: "Please stop asking repetitive questions. Take a moment before sending again.",
    };
  }
  
  if (violationCount >= MODERATION_CONFIG.WARN_THRESHOLD) {
    return {
      type: 'warning',
      duration: 0,
      message: MODERATION_CONFIG.WARNING_MESSAGE,
    };
  }
  
  return null;
}

// === MAIN MODERATION FUNCTION ===

/**
 * Process a message through the moderation system
 * Returns violations that can be applied as penalties but allows checking first
 * Returns: { allowed: boolean, action: string, message?: string, replacement?: string, duration?: number }
 */
function moderateMessage(userId, text) {
  // First, check if this is a normal conversation - never block these
  if (isNormalConversation(text)) {
    return { allowed: true, action: 'allowed' };
  }
  
  // Check for low-quality patterns
  const detection = detectLowQualityMessage(text);
  
  if (!detection) {
    // No problematic patterns found - allow message
    return { allowed: true, action: 'allowed' };
  }
  
  // Problematic pattern detected - apply moderation
  const violationCount = addUserViolation(userId, text);
  const penalty = getUserPenalty(userId);
  
  if (penalty) {
    return {
      allowed: false,
      action: penalty.type,
      message: penalty.message,
      duration: penalty.duration,
      violationCount,
      detectedPattern: detection.pattern,
    };
  }
  
  // First violation - soft moderation (replace message)
  return {
    allowed: true,
    action: 'replaced',
    replacement: MODERATION_CONFIG.REPLACEMENT_MESSAGE,
    violationCount,
    detectedPattern: detection.pattern,
  };
}

// === UTILITY FUNCTIONS ===

function clearUserViolations(userId) {
  if (violations[userId]) {
    delete violations[userId];
  }
}

function getModerationStats() {
  const totalViolations = Object.values(violations).reduce((sum, arr) => sum + arr.length, 0);
  const uniqueUsers = Object.keys(violations).length;
  
  return {
    totalViolations,
    uniqueUsers,
    activeUsers: Object.keys(violations).filter(u => violations[u].length > 0).length,
  };
}

module.exports = {
  moderateMessage,
  detectLowQualityMessage,
  isNormalConversation,
  getUserViolationCount,
  clearUserViolations,
  getModerationStats,
  MODERATION_CONFIG,
};