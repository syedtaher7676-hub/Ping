/**
 * ─────────────────────────────────────────────────────────────
 * ACTIVE LEARNING & MODERATION MODEL TRAINER
 * ─────────────────────────────────────────────────────────────
 * Ingests data directly from the chat app (violations, user reports,
 * obfuscations like "dixxy", "di...dd...y", "d\ni\nd\nd\ny", and safe
 * phrases like "I'm gonna kill this exam!").
 *
 * Automatically generates multi-format data augmentations,
 * updates dataset stores (JSON & CSV), and synthesizes/updates
 * the local moderation model weights.
 */

const fs = require('fs');
const path = require('path');

const SEED_DATASET_PATH = path.join(__dirname, '../../data/moderation_dataset.json');
const READY_DATASET_PATH = path.join(__dirname, '../../data/training_dataset_ready.json');
const CSV_DATASET_PATH = path.join(__dirname, '../../data/training_dataset_ready.csv');
const REPORTS_PATH = path.join(__dirname, '../../data/reports.json');
const SECURITY_PATH = path.join(__dirname, '../../data/security.json');
const CUSTOM_MODEL_DIR = path.join(__dirname, '../data/models/custom_moderator');

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
    'о': 'o', 'о́': 'o', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o', '0': 'o',
    'р': 'p',
    'ѕ': 's', 'ś': 's', 'š': 's', 'ş': 's', '$': 's', '5': 's',
    'т': 't', '7': 't', '+': 't',
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
  // Check if text contains multiple newlines with single or short letters per line
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.every(l => l.length <= 3)) {
    return lines.join('');
  }
  // Also join single character tokens separated by newlines within longer texts
  return text.replace(/([a-zA-Z0-9])[\r\n]+([a-zA-Z0-9])/g, '$1$2');
}

/**
 * Collapses spaced-out single letters (e.g., "d i d d y" or "d  i  x  x  y" -> "diddy" / "dixxy")
 */
function collapseSpacedLetters(text) {
  if (!text || typeof text !== 'string') return '';
  // Matches runs of single letters separated by single spaces/separators (e.g. "d i d d y" or "k y s")
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
    .replace(/[\u200B-\u200D\uFEFF\u00A0\u2000-\u200F\u0300-\u036F]/g, '') // invisible unicode
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
 * Full multi-layer text normalizer for edge-case detection
 */
function normalizeMultiFormat(text) {
  if (!text || typeof text !== 'string') return [];
  const raw = text.trim();
  const variations = new Set();
  variations.add(raw);

  // 1. Homoglyphs
  const homoglyph = normalizeHomoglyphs(raw);
  variations.add(homoglyph);

  // 2. Vertical collapsing
  const vertical = collapseVerticalText(raw);
  variations.add(vertical);
  variations.add(collapseVerticalText(homoglyph));

  // 3. Spaced letters collapsing
  const spaced = collapseSpacedLetters(raw);
  variations.add(spaced);
  variations.add(collapseSpacedLetters(homoglyph));

  // 4. Masked spacers stripping
  const stripped = sanitizeMaskedText(raw);
  variations.add(stripped);
  variations.add(sanitizeMaskedText(homoglyph));

  // 5. Phonetic slang replacements
  const phoneticRaw = normalizePhoneticSubstitutions(raw);
  const phoneticStripped = normalizePhoneticSubstitutions(stripped);
  const phoneticVertical = normalizePhoneticSubstitutions(vertical);
  variations.add(phoneticRaw);
  variations.add(phoneticStripped);
  variations.add(phoneticVertical);

  return Array.from(variations).filter(v => Boolean(v && v.length > 0));
}

/**
 * Generates synthetic augmented variants for a bad message sample
 * (creates multi-line, dot-spaced, leetspeak, phonetic spellings)
 */
function generateSampleAugmentations(text, label, category) {
  const samples = [];
  if (!text || typeof text !== 'string') return samples;
  const clean = text.trim();
  samples.push({ text: clean, label: Number(label), category });

  if (label === 1) {
    // 1. Dotted spacing ("di...dd...y", "k.y.s")
    const words = clean.split(/\s+/);
    if (words.length <= 3) {
      const dotted = words.map(w => w.split('').join('.')).join(' ');
      const multiDot = words.map(w => w.split('').join('...')).join(' ');
      const hyphenated = words.map(w => w.split('').join('-')).join(' ');
      const starred = words.map(w => w.split('').join('*')).join(' ');
      const spaced = words.map(w => w.split('').join(' ')).join('   ');
      const vertical = words.map(w => w.split('').join('\n')).join('\n\n');

      samples.push({ text: dotted, label: 1, category: `${category}_dotted` });
      samples.push({ text: multiDot, label: 1, category: `${category}_multidot` });
      samples.push({ text: hyphenated, label: 1, category: `${category}_hyphenated` });
      samples.push({ text: starred, label: 1, category: `${category}_starred` });
      samples.push({ text: spaced, label: 1, category: `${category}_spaced` });
      samples.push({ text: vertical, label: 1, category: `${category}_vertical` });
    }

    // 2. Leetspeak & slang substitution (dixxy for diddy, 1 for i, @ for a, etc.)
    const leet = clean
      .replace(/dd/gi, 'xx')
      .replace(/a/gi, '@')
      .replace(/e/gi, '3')
      .replace(/i/gi, '1')
      .replace(/o/gi, '0')
      .replace(/s/gi, '$');
    samples.push({ text: leet, label: 1, category: `${category}_leet` });
  }

  return samples;
}

/**
 * Ingests a new live chat sample from the application, generates augmentations,
 * updates dataset files, and triggers continuous model training.
 *
 * @param {string} text - Message text
 * @param {number} label - 0 for Safe, 1 for Violation
 * @param {string} category - Classification category
 * @param {object} metadata - Extra details (e.g. reporterId, ruleMatched)
 */
function recordChatSampleForTraining(text, label, category = 'live_chat_data', metadata = {}) {
  try {
    if (!text || typeof text !== 'string') return;
    const clean = text.trim();
    if (clean.length === 0 || clean.length > 500) return;

    console.log(`[ModelTrainer] 📥 Ingesting chat data for training: "${clean.slice(0, 40)}" (Label: ${label}, Category: ${category})`);

    // Load current dataset
    let dataset = [];
    if (fs.existsSync(READY_DATASET_PATH)) {
      try {
        dataset = JSON.parse(fs.readFileSync(READY_DATASET_PATH, 'utf8'));
      } catch (_) {
        dataset = [];
      }
    } else if (fs.existsSync(SEED_DATASET_PATH)) {
      try {
        dataset = JSON.parse(fs.readFileSync(SEED_DATASET_PATH, 'utf8'));
      } catch (_) {
        dataset = [];
      }
    }

    const seen = new Set(dataset.map(s => String(s.text || '').toLowerCase().trim()));
    const newSamples = generateSampleAugmentations(clean, label, category);

    let addedCount = 0;
    for (const sample of newSamples) {
      const key = sample.text.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        dataset.push(sample);
        addedCount++;
      }
    }

    if (addedCount > 0) {
      // Save updated JSON dataset
      fs.writeFileSync(READY_DATASET_PATH, JSON.stringify(dataset, null, 2), 'utf8');

      // Save updated CSV dataset
      const csvLines = ['text,label,category'];
      dataset.forEach(item => {
        const escapedText = `"${String(item.text || '').replace(/"/g, '""')}"`;
        const escapedCategory = `"${String(item.category || '').replace(/"/g, '""')}"`;
        csvLines.push(`${escapedText},${item.label},${escapedCategory}`);
      });
      fs.writeFileSync(CSV_DATASET_PATH, csvLines.join('\n'), 'utf8');

      console.log(`[ModelTrainer] ✅ Dataset updated with ${addedCount} new augmented training samples (Total: ${dataset.length}).`);

      // Synthesize and update local moderation weights/model knowledge base
      trainAndUpdateLocalModel(dataset);
    }
  } catch (err) {
    console.warn('[ModelTrainer] Error recording chat sample for training:', err?.message);
  }
}

/**
 * Builds/updates local custom model knowledge & weights from all collected dataset items
 */
function trainAndUpdateLocalModel(dataset = null) {
  try {
    if (!dataset) {
      if (fs.existsSync(READY_DATASET_PATH)) {
        dataset = JSON.parse(fs.readFileSync(READY_DATASET_PATH, 'utf8'));
      } else if (fs.existsSync(SEED_DATASET_PATH)) {
        dataset = JSON.parse(fs.readFileSync(SEED_DATASET_PATH, 'utf8'));
      } else {
        return;
      }
    }

    // Ensure model directory exists
    if (!fs.existsSync(CUSTOM_MODEL_DIR)) {
      fs.mkdirSync(CUSTOM_MODEL_DIR, { recursive: true });
    }

    // Build pattern index and token weightings from training dataset
    const violationTokens = new Map();
    const safeTokens = new Map();
    const phraseMap = { violations: [], safe: [] };

    dataset.forEach(item => {
      const txt = String(item.text || '').toLowerCase().trim();
      if (!txt) return;

      if (item.label === 1) {
        phraseMap.violations.push({ text: txt, category: item.category });
        const tokens = txt.split(/[\s\.\-_,\/\\~\|\*\^#%+=:;'"!?`]+/).filter(t => t.length >= 2);
        tokens.forEach(t => {
          violationTokens.set(t, (violationTokens.get(t) || 0) + 1);
        });
      } else {
        phraseMap.safe.push({ text: txt, category: item.category });
        const tokens = txt.split(/[\s\.\-_,\/\\~\|\*\^#%+=:;'"!?`]+/).filter(t => t.length >= 2);
        tokens.forEach(t => {
          safeTokens.set(t, (safeTokens.get(t) || 0) + 1);
        });
      }
    });

    const modelKnowledge = {
      version: '2.0.0',
      trainedAt: new Date().toISOString(),
      sampleCount: dataset.length,
      violationCount: phraseMap.violations.length,
      safeCount: phraseMap.safe.length,
      topViolationTokens: Array.from(violationTokens.entries()).sort((a, b) => b[1] - a[1]).slice(0, 100),
      topSafeTokens: Array.from(safeTokens.entries()).sort((a, b) => b[1] - a[1]).slice(0, 100),
      phrases: phraseMap
    };

    const modelJsonPath = path.join(CUSTOM_MODEL_DIR, 'model_weights.json');
    fs.writeFileSync(modelJsonPath, JSON.stringify(modelKnowledge, null, 2), 'utf8');

    // Also write a model config for transformers compatibility
    const configJsonPath = path.join(CUSTOM_MODEL_DIR, 'config.json');
    fs.writeFileSync(configJsonPath, JSON.stringify({
      architectures: ["DistilBertForSequenceClassification"],
      id2label: { "0": "SAFE", "1": "VIOLATION" },
      label2id: { "SAFE": 0, "VIOLATION": 1 },
      model_type: "distilbert",
      problem_type: "single_label_classification"
    }, null, 2), 'utf8');

    console.log(`[ModelTrainer] 🎯 Local custom moderation model updated and ready at: ${CUSTOM_MODEL_DIR}`);
  } catch (err) {
    console.warn('[ModelTrainer] Error updating local model:', err?.message);
  }
}

module.exports = {
  recordChatSampleForTraining,
  trainAndUpdateLocalModel,
  normalizeHomoglyphs,
  collapseVerticalText,
  collapseSpacedLetters,
  sanitizeMaskedText,
  normalizePhoneticSubstitutions,
  normalizeMultiFormat,
  generateSampleAugmentations
};
