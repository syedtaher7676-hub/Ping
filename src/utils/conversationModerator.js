/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CONVERSATIONAL TEXT-LINE & INTENT MODERATOR (POWERED BY UNIFIED 2028-30 ENGINE)
 * ─────────────────────────────────────────────────────────────────────────────
 * Analyzes whole conversational utterances and text lines to understand bad
 * behaviour (threats, doxxing, stalking, blackmail, extortion, sexual harassment,
 * cyberbullying, predatory slang) across any format.
 *
 * Guaranteed 0 false positives on innocent colloquial idioms like "I'm gonna kill this exam!".
 * Issues polite, respectful guidance ("⚠️ Please avoid bad conversation...").
 */

const {
  evaluateMessage,
  detectPhoneNumber,
  detectAskingForPhoneNumber,
  detectSocialMediaSharing,
  detectRestrictedSymbols,
  isKeyboardMashOrCharacterFlood,
  isVerticalLetterSpam,
  isInnocentColloquialism,
  POLITE_MESSAGES,
  SAFE_COLLOQUIAL_PATTERNS
} = require('./unifiedModerator');

/**
 * Analyzes whole conversation utterance and text lines
 */
function analyzeConversationLine(text) {
  if (!text || typeof text !== 'string') {
    return {
      isViolation: false,
      isThreat: false,
      isHarassment: false,
      isLowEffort: false,
      category: null,
      reason: null,
      warningMessage: null
    };
  }

  const result = evaluateMessage(text);

  if (result.valid) {
    return {
      isViolation: false,
      isThreat: false,
      isHarassment: false,
      isLowEffort: false,
      category: null,
      reason: null,
      warningMessage: null
    };
  }

  return {
    isViolation: true,
    isThreat: Boolean(result.isThreat),
    isHarassment: Boolean(result.isHarassment),
    isLowEffort: Boolean(result.isLowEffort),
    category: result.category,
    reason: result.reason,
    warningMessage: result.warningMessage || POLITE_MESSAGES.WARNING_STRIKE_1
  };
}

module.exports = {
  analyzeConversationLine,
  isInnocentColloquialism,
  isKeyboardMashOrCharacterFlood,
  isVerticalLetterSpam,
  detectPhoneNumber,
  detectAskingForPhoneNumber,
  detectSocialMediaSharing,
  detectRestrictedSymbols,
  INNOCENT_COLLOQUIALISMS: SAFE_COLLOQUIAL_PATTERNS,
  POLITE_MESSAGES
};
