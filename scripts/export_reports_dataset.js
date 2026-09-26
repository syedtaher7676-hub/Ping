/**
 * Dataset Exporter & Active Learning Generator
 * Reads logged violations, user reports, and seed data,
 * generates leetspeak/spacing augmentations,
 * and formats them into clean JSON/CSV datasets ready for model training.
 */

const fs = require('fs');
const path = require('path');
const { normalizeLeetspeak } = require('../src/data/slurFilter');

const SEED_DATASET_PATH = path.join(__dirname, '../data/moderation_dataset.json');
const REPORTS_PATH = path.join(__dirname, '../data/reports.json');
const SECURITY_PATH = path.join(__dirname, '../data/security.json');
const OUTPUT_DATASET_PATH = path.join(__dirname, '../data/training_dataset_ready.json');
const OUTPUT_CSV_PATH = path.join(__dirname, '../data/training_dataset_ready.csv');

function loadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn(`Could not read ${filePath}:`, err.message);
  }
  return [];
}

function generateTrainingDataset() {
  console.log('🔄 Collecting and augmenting training samples from seed data and logs...');

  const combined = [];
  const seenTexts = new Set();

  function addSample(text, label, category) {
    if (!text || typeof text !== 'string') return;
    const clean = text.trim();
    if (clean.length < 2 || clean.length > 300) return;
    const lower = clean.toLowerCase();
    if (seenTexts.has(lower)) return;
    seenTexts.add(lower);
    combined.push({ text: clean, label: Number(label), category: category || (label === 1 ? 'violation' : 'safe') });
  }

  // 1. Load seed dataset
  const seed = loadJson(SEED_DATASET_PATH);
  seed.forEach(item => {
    addSample(item.text, item.label, item.category);

    // Augment slur variations for more robust model training
    if (item.label === 1 && item.category === 'hate_speech_slurs') {
      // Leetspeak variation
      const leet = item.text
        .replace(/a/gi, '@')
        .replace(/e/gi, '3')
        .replace(/i/gi, '1')
        .replace(/o/gi, '0')
        .replace(/s/gi, '$');
      addSample(leet, 1, 'hate_speech_slurs_leet');

      // Dot spaced variation
      const words = item.text.split(' ');
      if (words.length <= 3) {
        const dotted = words.map(w => w.split('').join('.')).join(' ');
        addSample(dotted, 1, 'hate_speech_slurs_obfuscated');
      }
    }
  });

  // 2. Load security violations
  const secLogs = loadJson(SECURITY_PATH);
  secLogs.forEach(entry => {
    const msg = entry.data?.message || entry.data?.originalMessage;
    if (msg) {
      addSample(msg, 1, entry.action || 'auto_flagged_violation');
    }
  });

  console.log(`✅ Collected ${combined.length} unique training samples.`);

  // Write JSON
  fs.writeFileSync(OUTPUT_DATASET_PATH, JSON.stringify(combined, null, 2), 'utf8');
  console.log(`📁 Saved JSON dataset to: ${OUTPUT_DATASET_PATH}`);

  // Write CSV (convenient for pandas/Hugging Face)
  const csvLines = ['text,label,category'];
  combined.forEach(item => {
    const escapedText = `"${item.text.replace(/"/g, '""')}"`;
    const escapedCategory = `"${(item.category || '').replace(/"/g, '""')}"`;
    csvLines.push(`${escapedText},${item.label},${escapedCategory}`);
  });
  fs.writeFileSync(OUTPUT_CSV_PATH, csvLines.join('\n'), 'utf8');
  console.log(`📁 Saved CSV dataset to: ${OUTPUT_CSV_PATH}`);
}

generateTrainingDataset();
