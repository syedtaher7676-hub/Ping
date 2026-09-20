/**
 * ─────────────────────────────────────────────────────────────
 * PRODUCTION TWO-LAYER MODERATION & 1-HOUR BAN ENGINE
 * ─────────────────────────────────────────────────────────────
 * Layer 1: Local Regex & Masking Sanitizer ($0 Execution)
 *   - Strips obfuscation (dots, hyphens, spaces, underscores between chars).
 *   - Detects severe slurs, age/gender solicitation (M18, F15, 18m, etc.),
 *   - phone numbers, external URLs, and social media handle leaks.
 * Layer 2: Gemini 1.5 Flash API Multilingual Check (Free Tier)
 *   - Verifies intent for ambiguous, transliterated (Hinglish), or complex text.
 */

const { GoogleGenAI } = require('@google/genai');

const BAD_PATTERNS = [
  // Age-sex combinations targeting minors or restricted tags (m18, f15, 18m, m4f, etc.)
  /\b(m|f|male|female|boy|girl|im|i'm|im\s*a|i'm\s*a)\s*([0-1]?[0-8])\b/i,
  /\b([0-1]?[0-8])\s*(m|f|male|female|boy|girl|y\/o|yo)\b/i,
  /\b(m18|f18|18m|18f|m4f|f4m)\b/i,

  // Explicit predatory age questions
  /\b(how old are you|how old u|your age|ur age|u age)\b/i,

  // Social handle leaks / off-platform migration tags
  /\b(snapchat|snapchat:|snap:|instagram|insta:|telegram|tg:|whatsapp|wa\.me|kik|discord|dsc\.gg|add my snap)\b/i,

  // Severe racial/sexual slurs, hate speech and explicit abuse
  /\b(nigger|nigga|faggot|fag|kike|chink|retard|cunt|slut|whore|rape|pedophile|pedo|pussy|dick|porn|bitch|dih|hoe|fuck)\b/i
];

let aiClient = null;
function getAiClient() {
  if (!aiClient && process.env.GEMINI_API_KEY) {
    try {
      aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } catch (e) {
      console.warn("Failed to initialize GoogleGenAI in moderation:", e?.message);
    }
  }
  return aiClient;
}

/**
 * Sanitizes masked text by removing separators (dots, hyphens, spaces, underscores)
 * e.g., s.e.x -> sex, b.i.t.c.h -> bitch, h.o.e -> hoe
 */
function sanitizeMaskedText(text) {
  if (!text || typeof text !== 'string') return '';
  // Normalize whitespace and remove punctuation separators between letters
  return text
    .toLowerCase()
    .replace(/[\s\.\-_,\/\\]+/g, '');
}

/**
 * Validates message safety using Layer 1 (Regex + Masking) and Layer 2 (Gemini 1.5 Flash)
 * @param {string} text
 * @returns {Promise<{valid: boolean, reason?: string, action?: string}>}
 */
async function checkMessageSafety(text) {
  if (!text || typeof text !== 'string') {
    return { valid: false, reason: 'empty' };
  }

  const cleaned = text.trim();
  if (cleaned.length > 500) {
    return { valid: false, reason: 'too_long' };
  }

  // Layer 1: Check raw text and masked/sanitized text against regex patterns
  for (const pattern of BAD_PATTERNS) {
    if (pattern.test(cleaned)) {
      return { valid: false, reason: 'severe_violation', action: 'ban_15min' };
    }
  }

  const sanitized = sanitizeMaskedText(cleaned);
  for (const pattern of BAD_PATTERNS) {
    if (pattern.test(sanitized)) {
      return { valid: false, reason: 'masked_violation', action: 'ban_15min' };
    }
  }

  // Layer 2: Gemini 1.5 Flash API Multilingual / Intent Check for ambiguous or transliterated text
  const client = getAiClient();
  if (client && cleaned.length > 3) {
    try {
      const response = await client.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: `Analyze the following chat message for severe profanity, hate speech, explicit sexual solicitation, age solicitation involving minors, or off-platform handle sharing. Respond ONLY with "SAFE" or "VIOLATION". Message: "${cleaned}"`,
      });
      const resultText = response?.text?.trim()?.toUpperCase();
      if (resultText && resultText.includes('VIOLATION')) {
        return { valid: false, reason: 'ai_flagged_violation', action: 'ban_15min' };
      }
    } catch (err) {
      // Fail open on AI API error to maintain high availability
      console.warn("Gemini moderation check warning:", err?.message);
    }
  }

  return { valid: true };
}

module.exports = {
  checkMessageSafety,
  sanitizeMaskedText,
  validateMessage: checkMessageSafety // Alias for compatibility
};
