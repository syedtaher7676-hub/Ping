/**
 * ─────────────────────────────────────────────────────────────
 * PRODUCTION MULTI-LAYER MODERATION ENGINE ($0 LOCAL AI & ONNX)
 * ─────────────────────────────────────────────────────────────
 * Layer 0: Conversational Text-Line & Bad Behavior Analyzer ($0, 0ms)
 *   - Semantic understanding of threats, doxxing, stalking, blackmail,
 *     extortion, harassment, and predatory slang.
 *   - Guaranteed zero false positives on idioms like "I'm gonna kill this exam!".
 *
 * Layer 1: Advanced Multi-Format Obfuscation & Leetspeak De-anonymizer ($0, 0ms)
 *   - Normalizes vertical multi-line text ("d\ni\nd\nd\ny").
 *   - Strips separators and dots ("di...dd...y", "d-i-d-d-y", "d.i.d.d.y", "d*i*x*x*y").
 *   - Resolves phonetic slang substitutions ("dixxy" -> "diddy").
 *   - Normalizes homoglyphs (Cyrillic/Greek -> Latin) and leetspeak (@, 1, 0, 3, $, 7, etc.).
 *   - Catches racial, homophobic, predatory, and violent slurs.
 *
 * Layer 2: Local Neural ONNX Model & Custom Model Classifier ($0, ~10ms)
 *   - Evaluates custom model weights in `src/data/models/custom_moderator`
 *     or Hugging Face ONNX models (`Xenova/toxic-bert`).
 *
 * Layer 3 (Optional Fallback): Gemini 2.5 Flash
 *   - Used only as a fallback if local inference is unavailable and GEMINI_API_KEY exists.
 */

const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const { analyzeConversationLine, isInnocentColloquialism } = require('./conversationModerator');
const {
  normalizeHomoglyphs,
  collapseVerticalText,
  collapseSpacedLetters,
  sanitizeMaskedText,
  stripAllSymbols,
  collapseRepeatedChars,
  normalizePhoneticSubstitutions,
  normalizeLeetspeak
} = require('../data/slurFilter');

function escapeRegExp(string) {
  return String(string || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let pipeline = null;
let classifier = null;
let modelLoadingPromise = null;
let modelLoadError = null;
let activeModelName = 'none';

// Custom model weights directory
const CUSTOM_MODEL_PATHS = [
  path.join(__dirname, '../data/models/custom_moderator'),
  path.join(__dirname, '../../data/models/custom_moderator'),
];

let customModelWeights = null;
let lastModelWeightsMtime = 0;

function loadCustomModelWeights(force = false) {
  for (const p of CUSTOM_MODEL_PATHS) {
    const weightsFile = path.join(p, 'model_weights.json');
    if (fs.existsSync(weightsFile)) {
      try {
        const stats = fs.statSync(weightsFile);
        if (force || !customModelWeights || stats.mtimeMs > lastModelWeightsMtime) {
          lastModelWeightsMtime = stats.mtimeMs;
          const raw = fs.readFileSync(weightsFile, 'utf8');
          customModelWeights = JSON.parse(raw);
        }
        return customModelWeights;
      } catch (_) {}
    }
  }
  return null;
}

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
  loadCustomModelWeights();
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
      console.warn('[Moderation] Local ONNX model failed to load (will use fast pattern & custom weights):', err.message);
      modelLoadError = err.message;
      return null;
    } finally {
      modelLoadingPromise = null;
    }
  })();

  return modelLoadingPromise;
}

// Background warm-up
initOnnxClassifier().catch(() => {});

// Comprehensive pattern filters for Layer 1
const BAD_PATTERNS = [
  // Predatory slang & abusive grooming terms (diddy, dixxy, diddler, groomer, etc.)
  /\b(diddy|dixxy|diddi|diddie|diddler|diddling|diddled|chomo|noncer|groomer|jailbait|paedo|pedophile|pedo)\b/i,

  // Age-sex combinations targeting minors or restricted tags (m18, f15, 18m, m4f, etc.)
  /\b(m|f|male|female|boy|girl|im|i'm|im\s*a|i'm\s*a)\s*([0-1]?[0-8])\b/i,
  /\b([0-1]?[0-8])\s*(m|f|male|female|boy|girl|y\/o|yo)\b/i,
  /\b(m18|f18|18m|18f|m4f|f4m)\b/i,

  // Explicit predatory age questions
  /\b(how old are you|how old u|your age|ur age|u age)\b/i,

  // Social handle leaks / off-platform migration tags (Instagram, Snapchat, etc.)
  /\b(snapchat|snapchat:|snap:|instagram|insta:|telegram|tg:|whatsapp|wa\.me|kik|discord|dsc\.gg|add my snap|add my insta)\b/i,

  // Severe racial/ethnic slurs
  /\b(nigger|nigga|niggaz|niggers|chink|chinks|gook|gooks|kike|kikes|spic|spics|wetback|coon|paki|beaner|raghead|towelhead|zipperhead)\b/i,

  // Homophobic & transphobic slurs
  /\b(faggot|faggots|fagot|fag|fags|dyke|dykes|tranny|shemale)\b/i,

  // Severe ableist, harassment & misogynistic hate terms
  /\b(retard|retarded|tard|cunt|cunts|slut|sluts|whore|whores|motherfucker)\b/i,

  // Hindi / Urdu / South Asian slurs
  /\b(bhenchod|behenchod|madarchod|chutiya|chutiye|gandu|gaandu|gxxndu|bhosadike|bhosdike|bhosadi|randi|haramkhor|kamina|kamine|suar|kutte|kutiya|bhadwe|bhadwa|jhantu|laude|lauda|lavde|chinal)\b/i,

  // Tamil slurs & profanity
  /\b(thevidiya|thevidya|thevdiya|thevadiya|thevidia|thevadiye|thevidiyale|thevidiya\s*paiya|thevidiya\s*mavane|thevidiya\s*munda|thevidiya\s*mundai|otha|othaa|othala|othale|othavane|omala|ommala|ommale|gommale|gommala|otha\s*gommala|punda|pundamavan|pundamavane|pundai|loosu\s*punda|kenapunda|punda\s*munda|koothi|koothee|koothe|koodhi|koothi\s*oombu|poolu|poola|oombu|oombuda|sunni|sunnee|mayiru|mayire|mayir|baadu|naaye|naai|ungamma|ungammale|thevadiyaye|pichaikarane|eruma\s*maadu|lavada|lavadakabaal|soothu)\b/i,

  // Telugu slurs & profanity
  /\b(lanja|lanjakodaka|lanja\s*kodaka|lanjamunda|lanja\s*munda|lanjodka|lanjakompa|lanja\s*kuthura|lanja\s*bathuku|dengu|dhengey|dhengai|dengai|dengi|dengutha|dengudu|dhengichuko|dengichuko|gudha|guda|guddha|gudha\s*balisinda|gudha\s*moosko|gudhalo|gudhadenge|gudha\s*cheeku|munda|mundamopi|munde|mundamopivi|puku|pooku|pukulo|pookulo|erri\s*puku|erripuku|verri\s*puku|verripuku|puku\s*cheeku|erri\s*puka|modda|moddalo|moddada|modda\s*cheeku|modda\s*gudu|erri\s*modda|errimodda|chekka|sulli|sulliga|sulli\s*cheeku|nakodaka|na\s*kodaka|donga\s*na\s*kodaka|chillar\s*na\s*kodaka|nee\s*yavva|nee\s*yamma)\b/i,

  // Kannada slurs & profanity
  /\b(sule|sule\s*maga|sulemaga|sule\s*magane|sulemagane|sulay|sulay\s*maga|sulay\s*magane|sulaymaga|sulaymagane|sooley|soole\s*maga|soole\s*magane|soolemagane|sule\s*munde|sulemunde|soole\s*munde|sulekodaga|sule\s*kodaga|sulemaklu|sule\s*maklu|soole|sule\s*hadaragi|thika|tikka|theeka|theekamuchu|theka|thika\s*muchu|tikka\s*muchu|thika\s*muchkond|tikka\s*muchkond|thika\s*hodithini|tikka\s*hodithini|thika\s*thulko|tikka\s*thulko|theeka\s*muchu|tikka\s*keyyo|boli|boli\s*maga|bolimaga|boli\s*munde|bolimunde|boli\s*maklu|bolimaklu|baddimaga|baddi\s*maga|baddi\s*munde|baddimunde|baddithana|byawarsi|bewarsi|bewarse|bevarsi|bevarsi\s*nan\s*maga|hadaragi|hadaragi\s*maga|hadsko|hadargithi|hadar\s*githi|keythini|keyyo|tunne|thunne|tunne\s*cheepu|thunne\s*cheepu|tullu|thullu|tulu|thulu|tullu\s*muchu|thullu\s*muchu|tullu\s*cheepu|shata|shatta|satha|shata\s*kithko|shatta\s*kithko|shata\s*muchu|shata\s*bolli|kalla\s*nanna\s*maga|nin\s*amman|nin\s*ammanige|nin\s*amman\s*thullu|nin\s*ayyana|nin\s*appan|nin\s*akkan|nim\s*amman|nimmanige|ganchali|huch\s*naayi|huch\s*nayi|loffer)\b/i,

  // Malayalam slurs & profanity
  /\b(myre|maire|myru|mairu|myren|mairen|myran|mairan|myrukale|myro|myroli|thendi|thenndi|thendimon|thendimol|thendikale|thendi\s*naye|patti|pattishow|naaye|naayi|naayinte\s*mone|nayinte\s*mone|pattide\s*mone|pulayadi|pulayadimon|pulayadimonu|pulayadi\s*mone|kunna|kundi|kundimon|kundimone|kundikku|kundi\s*adikkal|pooru|poorimon|poorimone|poottile|pooru\s*mone|poori|poore|andi|visham|thaayoli|thayoli|thayyoli|thayolee|thayoli\s*mone|thayolimon|kallan|chetta|vellathalayan|vedichi)\b/i,

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
 * Validates message safety across all multi-format layers
 * @param {string} text
 * @returns {Promise<{valid: boolean, reason?: string, action?: string, confidence?: number, model?: string, layer?: string, warningMessage?: string}>}
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
  // STEP 0: Colloquial False Positive Shield ("I'm gonna kill this exam!")
  // ─────────────────────────────────────────────────────────────
  if (isInnocentColloquialism(cleaned)) {
    return { valid: true, confidence: 1.0, layer: 'colloquial_shield' };
  }

  // ─────────────────────────────────────────────────────────────
  // LAYER 0: Conversational Text-Line & Threat Analyzer ($0, 0ms)
  // ─────────────────────────────────────────────────────────────
  const convAnalysis = analyzeConversationLine(cleaned);
  if (convAnalysis.isThreat || convAnalysis.isHarassment) {
    return {
      valid: false,
      reason: convAnalysis.reason || 'threat_or_harassment',
      action: 'ban_15min',
      category: convAnalysis.category,
      layer: 'conversation_threat_nlp',
      warningMessage: convAnalysis.warningMessage
    };
  }
  if (convAnalysis.isViolation) {
    return {
      valid: false,
      reason: convAnalysis.reason || 'inappropriate_conversation',
      action: 'warn',
      category: convAnalysis.category,
      layer: 'conversation_violation',
      warningMessage: convAnalysis.warningMessage
    };
  }

  // ─────────────────────────────────────────────────────────────
  // LAYER 1: Multi-Format Obfuscation & Leetspeak Sanitizer ($0, 0ms)
  // Catches "dixxy", "di...dd...y", "d\ni\nd\nd\ny", "d-i-d-d-y", "////nigga", homoglyphs
  // ─────────────────────────────────────────────────────────────
  const homoglyph = normalizeHomoglyphs(cleaned);
  const vertical = collapseVerticalText(homoglyph);
  const spaced = collapseSpacedLetters(homoglyph);
  const leet = normalizeLeetspeak(homoglyph);
  const stripped = sanitizeMaskedText(homoglyph);
  const pureSymbols = stripAllSymbols(homoglyph);
  const pureLeet = normalizeLeetspeak(pureSymbols);
  const pureDeduped = collapseRepeatedChars(pureSymbols);
  const pureDedupedLeet = collapseRepeatedChars(pureLeet);
  const phonetic = normalizePhoneticSubstitutions(homoglyph);
  const strippedPhonetic = normalizePhoneticSubstitutions(stripped);
  const verticalPhonetic = normalizePhoneticSubstitutions(vertical);
  const purePhonetic = normalizePhoneticSubstitutions(pureSymbols);

  const variations = [
    cleaned,
    homoglyph,
    vertical,
    spaced,
    leet,
    stripped,
    pureSymbols,
    pureLeet,
    pureDeduped,
    pureDedupedLeet,
    phonetic,
    strippedPhonetic,
    verticalPhonetic,
    purePhonetic
  ];

  for (const variation of variations) {
    for (const pattern of BAD_PATTERNS) {
      if (pattern.test(variation)) {
        return {
          valid: false,
          reason: 'severe_obfuscation_violation',
          action: 'ban_15min',
          layer: 'multi_format_obfuscation_filter'
        };
      }
    }
  }

  // Check learned custom model knowledge base if available
  loadCustomModelWeights();
  if (customModelWeights?.phrases?.violations) {
    const rawLower = cleaned.toLowerCase();
    for (const vItem of customModelWeights.phrases.violations) {
      if (!vItem.text) continue;
      const vText = vItem.text.toLowerCase().trim();
      
      // Exact full match
      if (rawLower === vText || vertical.toLowerCase() === vText || strippedPhonetic === vText.replace(/\s+/g, '')) {
        return {
          valid: false,
          reason: 'custom_model_violation',
          action: 'ban_15min',
          layer: 'custom_model_knowledge'
        };
      }

      // Word boundary match for multicharacter alphanumeric phrases (>= 3 chars)
      if (vText.length >= 3 && /^[a-zA-Z0-9_\s]+$/.test(vText)) {
        const escaped = escapeRegExp(vText);
        const regex = new RegExp(`\\b${escaped}\\b`, 'i');
        if (regex.test(rawLower) || regex.test(vertical) || regex.test(phonetic)) {
          return {
            valid: false,
            reason: 'custom_model_violation',
            action: 'ban_15min',
            layer: 'custom_model_knowledge'
          };
        }
      }
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

        return { valid: true, confidence: score, model: activeModelName, layer: 'local_onnx' };
      }
    }
  } catch (onnxErr) {
    // Fail-open to next layer
  }

  // ─────────────────────────────────────────────────────────────
  // LAYER 3 (Optional Fallback): Gemini 2.5 Flash if ONNX unavailable
  // ─────────────────────────────────────────────────────────────
  const client = getAiClient();
  if (!classifier && client && cleaned.length > 3) {
    try {
      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Analyze the following chat message for severe profanity, hate speech, explicit sexual solicitation, predatory slang, age solicitation involving minors, or off-platform handle sharing. Respond ONLY with "SAFE" or "VIOLATION". Message: "${cleaned}"`,
      });
      const resultText = response?.text?.trim()?.toUpperCase();
      if (resultText && resultText.includes('VIOLATION')) {
        return { valid: false, reason: 'ai_flagged_violation', action: 'ban_15min', layer: 'gemini_fallback' };
      }
    } catch (err) {
      // Ignore fallback error
    }
  }

  return { valid: true, layer: 'pass_through' };
}

function getModerationStatus() {
  return {
    onnxLoaded: Boolean(classifier),
    isModelLoading: Boolean(modelLoadingPromise),
    activeModelName,
    customModelFound: Boolean(getCustomModelPath() || customModelWeights),
    modelLoadError
  };
}

module.exports = {
  checkMessageSafety,
  normalizeLeetspeak,
  sanitizeMaskedText,
  validateMessage: checkMessageSafety,
  initOnnxClassifier,
  getModerationStatus,
  escapeRegExp,
  loadCustomModelWeights
};
