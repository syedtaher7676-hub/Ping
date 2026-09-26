/**
 * ─────────────────────────────────────────────────────────────
 * PRODUCTION MULTI-LAYER MODERATION ENGINE ($0 LOCAL AI & ONNX)
 * ─────────────────────────────────────────────────────────────
 * Layer 1: Advanced Regex, Leetspeak & Obfuscation De-anonymizer ($0, 0ms)
 *   - Normalizes leetspeak symbols (@, !, 1, 0, 3, 5, $, 7, +, etc.).
 *   - Strips separators (dots, hyphens, spaces, underscores, zero-width chars).
 *   - Catches immediate racial/homophobic/ethnic/gendered slurs, Hindi/Urdu slurs,
 *     age/gender solicitations (m18, f15, etc.), and contact leaks.
 *
 * Layer 2: Local Neural ONNX Model via @xenova/transformers ($0, ~10-15ms)
 *   - Runs 100% locally on CPU without any cloud API fees or rate limits.
 *   - Automatically detects custom fine-tuned ONNX weights in
 *     `src/data/models/custom_moderator` or `data/models/custom_moderator`.
 *   - If no custom weights are present, defaults to `Xenova/toxic-bert`.
 *
 * Layer 3 (Optional Fallback): Gemini 2.5 Flash
 *   - Used only as a fallback if ONNX is completely unavailable and GEMINI_API_KEY exists.
 */

const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

let pipeline = null;
let classifier = null;
let modelLoadingPromise = null;
let modelLoadError = null;
let activeModelName = 'none';

// Check if user has deployed a custom trained ONNX model
const CUSTOM_MODEL_PATHS = [
  path.join(__dirname, '../data/models/custom_moderator'),
  path.join(__dirname, '../../data/models/custom_moderator'),
];

function getCustomModelPath() {
  for (const p of CUSTOM_MODEL_PATHS) {
    if (fs.existsSync(p) && (fs.existsSync(path.join(p, 'model.onnx')) || fs.existsSync(path.join(p, 'onnx/model.onnx')))) {
      return p;
    }
  }
  return null;
}

/**
 * Initializes the ONNX Transformer pipeline locally ($0 cost)
 */
async function initOnnxClassifier() {
  if (classifier) return classifier;
  if (modelLoadingPromise) return modelLoadingPromise;

  modelLoadingPromise = (async () => {
    try {
      if (!pipeline) {
        const transformers = require('@xenova/transformers');
        pipeline = transformers.pipeline;
      }

      const customPath = getCustomModelPath();
      if (customPath) {
        console.log(`[Moderation] Loading custom fine-tuned ONNX model from: ${customPath}`);
        classifier = await pipeline('text-classification', customPath, { quantized: true });
        activeModelName = 'custom_onnx_model';
      } else {
        console.log('[Moderation] Loading open-source Xenova/toxic-bert ONNX model ($0 local)...');
        classifier = await pipeline('text-classification', 'Xenova/toxic-bert', { quantized: true });
        activeModelName = 'Xenova/toxic-bert';
      }

      console.log(`[Moderation] Local AI moderation ready! Active model: ${activeModelName}`);
      modelLoadError = null;
      return classifier;
    } catch (err) {
      console.warn('[Moderation] Local ONNX model failed to load:', err.message);
      modelLoadError = err.message;
      return null;
    } finally {
      modelLoadingPromise = null;
    }
  })();

  return modelLoadingPromise;
}

// Background warm-up so the first chat message doesn't experience cold-start latency
initOnnxClassifier().catch(() => {});

// Comprehensive pattern filters for Layer 1
const BAD_PATTERNS = [
  // Age-sex combinations targeting minors or restricted tags (m18, f15, 18m, m4f, etc.)
  /\b(m|f|male|female|boy|girl|im|i'm|im\s*a|i'm\s*a)\s*([0-1]?[0-8])\b/i,
  /\b([0-1]?[0-8])\s*(m|f|male|female|boy|girl|y\/o|yo)\b/i,
  /\b(m18|f18|18m|18f|m4f|f4m)\b/i,

  // Explicit predatory age questions
  /\b(how old are you|how old u|your age|ur age|u age)\b/i,

  // Social handle leaks / off-platform migration tags
  /\b(snapchat|snapchat:|snap:|instagram|insta:|telegram|tg:|whatsapp|wa\.me|kik|discord|dsc\.gg|add my snap)\b/i,

  // Severe racial/ethnic slurs
  /\b(nigger|nigga|niggaz|niggers|chink|chinks|gook|gooks|kike|kikes|spic|spics|wetback|coon|paki|beaner|raghead|towelhead|zipperhead)\b/i,

  // Homophobic & transphobic slurs
  /\b(faggot|faggots|fagot|fag|fags|dyke|dykes|tranny|shemale)\b/i,

  // Severe ableist, harassment & misogynistic hate terms
  /\b(retard|retarded|tard|cunt|cunts|slut|sluts|whore|whores|motherfucker)\b/i,

  // Hindi / Urdu / South Asian slurs
  /\b(bhenchod|behenchod|madarchod|chutiya|chutiye|gandu|bhosadike|bhosdike|bhosadi|randi|haramkhor|kamina|kamine|suar|kutte|kutiya|bhadwe|bhadwa|jhantu|laude|lauda|lavde|chinal)\b/i,

  // Spanish slurs
  /\b(maricon|puta|culero|pendejo|cabron)\b/i,

  // Death encouragement / violent threats
  /\b(kys|kill\s*yourself|go\s*die|end\s*your\s*life|commit\s*suicide)\b/i
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
 * Normalizes leetspeak symbols to canonical Latin letters
 */
function normalizeLeetspeak(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width
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
    .replace(/(.)\1{2,}/g, '$1$1'); // collapse runs
}

/**
 * Sanitizes masked text by removing separators (dots, hyphens, spaces, underscores)
 */
function sanitizeMaskedText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[\s\.\-_,\/\\]+/g, '');
}

/**
 * Validates message safety using Layer 1 (Regex + Obfuscation/Leetspeak) and Layer 2 (Local ONNX AI Model)
 * @param {string} text
 * @returns {Promise<{valid: boolean, reason?: string, action?: string, confidence?: number, model?: string, layer?: string}>}
 */
async function checkMessageSafety(text) {
  if (!text || typeof text !== 'string') {
    return { valid: false, reason: 'empty' };
  }

  const cleaned = text.trim();
  if (cleaned.length > 500) {
    return { valid: false, reason: 'too_long' };
  }

  // ─────────────────────────────────────────────────────────────
  // LAYER 1: Rapid Pattern & Obfuscation Sanitizer ($0, 0ms)
  // ─────────────────────────────────────────────────────────────
  for (const pattern of BAD_PATTERNS) {
    if (pattern.test(cleaned)) {
      return { valid: false, reason: 'severe_violation', action: 'ban_15min', layer: 'regex' };
    }
  }

  // Check leetspeak normalized version (e.g., f@gg0t, n!gg3r, k1k3, r3t@rd)
  const leetNormalized = normalizeLeetspeak(cleaned);
  for (const pattern of BAD_PATTERNS) {
    if (pattern.test(leetNormalized)) {
      return { valid: false, reason: 'leetspeak_violation', action: 'ban_15min', layer: 'leetspeak_normalized' };
    }
  }

  // Check stripped spacer version (e.g., f.u.c.k, n.i.g.g.e.r, b h e n c h o d)
  const sanitized = sanitizeMaskedText(cleaned);
  for (const pattern of BAD_PATTERNS) {
    if (pattern.test(sanitized)) {
      return { valid: false, reason: 'masked_violation', action: 'ban_15min', layer: 'regex_sanitized' };
    }
  }

  // Check sanitized leetspeak version
  const sanitizedLeet = sanitizeMaskedText(leetNormalized);
  for (const pattern of BAD_PATTERNS) {
    if (pattern.test(sanitizedLeet)) {
      return { valid: false, reason: 'masked_leetspeak_violation', action: 'ban_15min', layer: 'leetspeak_sanitized' };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // LAYER 2: Local ONNX Neural Classifier ($0, local CPU, ~10ms)
  // ─────────────────────────────────────────────────────────────
  try {
    const model = classifier || (await initOnnxClassifier());
    if (model) {
      const output = await model(cleaned);
      if (Array.isArray(output) && output.length > 0) {
        const top = output[0];
        const label = String(top.label || '').toLowerCase();
        const score = Number(top.score) || 0;

        // Custom model output (VIOLATION / LABEL_1) or toxic-bert (toxic, insult, etc.)
        const isViolation =
          (label === 'violation' && score > 0.60) ||
          (label === 'label_1' && score > 0.60) ||
          (label === 'toxic' && score > 0.70);

        if (isViolation) {
          return {
            valid: false,
            reason: 'ai_toxic_detected',
            action: score > 0.85 ? 'ban_15min' : 'warn',
            confidence: score,
            model: activeModelName,
            layer: 'local_onnx'
          };
        }

        // Successfully verified as clean by neural model
        return { valid: true, confidence: score, model: activeModelName, layer: 'local_onnx' };
      }
    }
  } catch (onnxErr) {
    console.warn('[Moderation] Local ONNX inference error:', onnxErr?.message);
  }

  // ─────────────────────────────────────────────────────────────
  // LAYER 3 (Optional Fallback): Gemini 2.5 Flash if ONNX unavailable
  // ─────────────────────────────────────────────────────────────
  const client = getAiClient();
  if (!classifier && client && cleaned.length > 3) {
    try {
      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Analyze the following chat message for severe profanity, hate speech, explicit sexual solicitation, age solicitation involving minors, or off-platform handle sharing. Respond ONLY with "SAFE" or "VIOLATION". Message: "${cleaned}"`,
      });
      const resultText = response?.text?.trim()?.toUpperCase();
      if (resultText && resultText.includes('VIOLATION')) {
        return { valid: false, reason: 'ai_flagged_violation', action: 'ban_15min', layer: 'gemini_fallback' };
      }
    } catch (err) {
      console.warn("Gemini moderation check warning:", err?.message);
    }
  }

  return { valid: true, layer: 'pass_through' };
}

function getModerationStatus() {
  return {
    onnxLoaded: Boolean(classifier),
    isModelLoading: Boolean(modelLoadingPromise),
    activeModelName,
    customModelFound: Boolean(getCustomModelPath()),
    modelLoadError
  };
}

module.exports = {
  checkMessageSafety,
  normalizeLeetspeak,
  sanitizeMaskedText,
  validateMessage: checkMessageSafety, // Alias for socket handlers
  initOnnxClassifier,
  getModerationStatus
};
