#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────
 * ACTIVE LEARNING TRAINER & DATASET SYNCHRONIZER
 * ─────────────────────────────────────────────────────────────
 * Reads collected user reports, security logs, slur violations,
 * and seed dataset.
 *
 * Generates comprehensive multi-format augmentations:
 * - Multi-line vertical variations ("d\ni\nd\nd\ny", "k\ny\ns")
 * - Dotted & spacer variations ("di...dd...y", "d-i-d-d-y")
 * - Leetspeak & slang variations ("dixxy", "d1xxy", "f@gg0t")
 * - Safe colloquial expressions ("I'm gonna kill this exam!", "killed it")
 *
 * Exports datasets (JSON/CSV) and trains/updates the local custom moderation model.
 */

const fs = require('fs');
const path = require('path');
const {
  trainAndUpdateLocalModel,
  generateSampleAugmentations,
  normalizeMultiFormat
} = require('../src/services/modelTrainer');

const SEED_DATASET_PATH = path.join(__dirname, '../data/moderation_dataset.json');
const REPORTS_PATH = path.join(__dirname, '../data/reports.json');
const SECURITY_PATH = path.join(__dirname, '../data/security.json');
const VIOLATIONS_PATH = path.join(__dirname, '../data/slur_violations.json');
const READY_DATASET_PATH = path.join(__dirname, '../data/training_dataset_ready.json');
const READY_CSV_PATH = path.join(__dirname, '../data/training_dataset_ready.csv');

function loadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (_) {}
  return [];
}

function runDatasetAndModelTraining() {
  console.log('='.repeat(65));
  console.log('🚀 ACTIVE LEARNING: Ingesting Chat Data & Retraining Moderation Model');
  console.log('='.repeat(65));

  const combined = [];
  const seenTexts = new Set();

  function addSample(text, label, category) {
    if (!text || typeof text !== 'string') return;
    const clean = text.trim();
    if (clean.length < 1 || clean.length > 500) return;
    const lower = clean.toLowerCase();
    if (seenTexts.has(lower)) return;
    seenTexts.add(lower);
    combined.push({ text: clean, label: Number(label), category: category || (label === 1 ? 'violation' : 'safe') });

    // Generate augmentations for violations
    if (label === 1) {
      const augs = generateSampleAugmentations(clean, 1, category);
      for (const aug of augs) {
        const augKey = aug.text.toLowerCase().trim();
        if (!seenTexts.has(augKey)) {
          seenTexts.add(augKey);
          combined.push(aug);
        }
      }
    }
  }

  // 1. Seed dataset
  const seed = loadJson(SEED_DATASET_PATH);
  seed.forEach(item => addSample(item.text, item.label, item.category));

  // Add edge cases explicitly into training dataset
  const edgeCases = [
    // Multi-format obfuscations
    { text: "dixxy", label: 1, category: "predatory_slang_diddy" },
    { text: "diddy", label: 1, category: "predatory_slang_diddy" },
    { text: "di...dd...y", label: 1, category: "predatory_slang_diddy" },
    { text: "d-i-d-d-y", label: 1, category: "predatory_slang_diddy" },
    { text: "d.i.d.d.y", label: 1, category: "predatory_slang_diddy" },
    { text: "d*i*x*x*y", label: 1, category: "predatory_slang_diddy" },
    { text: "d\ni\nd\nd\ny", label: 1, category: "predatory_slang_diddy" },
    { text: "d\ni\nx\nx\ny", label: 1, category: "predatory_slang_diddy" },
    { text: "diddi", label: 1, category: "predatory_slang_diddy" },
    { text: "diddler", label: 1, category: "predatory_slang_diddy" },
    { text: "diddling", label: 1, category: "predatory_slang_diddy" },
    { text: "k\ny\ns", label: 1, category: "harassment_vertical" },
    { text: "f\na\ng", label: 1, category: "hate_speech_vertical" },
    { text: "n\ni\ng\ng\ne\nr", label: 1, category: "hate_speech_vertical" },
    { text: "f.a.g.g.o.t", label: 1, category: "hate_speech_obfuscated" },
    { text: "b.h.e.n.c.h.o.d", label: 1, category: "hate_speech_obfuscated" },

    // Low effort probes
    { text: "m", label: 1, category: "low_effort_probe" },
    { text: "f", label: 1, category: "low_effort_probe" },
    { text: "m?", label: 1, category: "low_effort_probe" },
    { text: "asl", label: 1, category: "low_effort_probe" },
    { text: "18m", label: 1, category: "low_effort_probe" },
    { text: "f15", label: 1, category: "low_effort_probe" },
    { text: "snap?", label: 1, category: "low_effort_probe" },
    { text: "insta?", label: 1, category: "low_effort_probe" },

    // Safe colloquial idioms
    { text: "I'm gonna kill this exam!", label: 0, category: "safe_idiom_exam" },
    { text: "i am going to kill this exam", label: 0, category: "safe_idiom_exam" },
    { text: "gonna kill this exam today", label: 0, category: "safe_idiom_exam" },
    { text: "i killed that test yesterday!", label: 0, category: "safe_idiom_exam" },
    { text: "you killed that guitar solo", label: 0, category: "safe_idiom_performance" },
    { text: "that joke killed me lol", label: 0, category: "safe_idiom_humor" },
    { text: "my phone died earlier", label: 0, category: "safe_idiom_battery" },
    { text: "my feet are killing me after running", label: 0, category: "safe_idiom_fatigue" },
    { text: "can you pass the butter please?", label: 0, category: "safe_conversation" },
    { text: "where are you from? i am from canada", label: 0, category: "safe_conversation" },
    { text: "good luck with your finals and exams!", label: 0, category: "safe_conversation" }
  ];

  edgeCases.forEach(ec => addSample(ec.text, ec.label, ec.category));

  // 2. Load live reports from chat app
  const reports = loadJson(REPORTS_PATH);
  reports.forEach(r => {
    const text = r.message || r.text;
    if (text) addSample(text, 1, 'reported_chat_data');
  });

  // 3. Load security logs
  const secLogs = loadJson(SECURITY_PATH);
  secLogs.forEach(entry => {
    const text = entry.data?.message || entry.message || entry.data?.originalMessage;
    if (text && entry.severity !== 'safe') {
      addSample(text, 1, entry.action || 'security_log_violation');
    }
  });

  console.log(`📊 Ingested and synthesized ${combined.length} unique samples from chat app.`);

  // Write JSON
  fs.writeFileSync(READY_DATASET_PATH, JSON.stringify(combined, null, 2), 'utf8');
  console.log(`💾 Saved ready dataset to: ${READY_DATASET_PATH}`);

  // Write CSV
  const csvLines = ['text,label,category'];
  combined.forEach(item => {
    const escapedText = `"${String(item.text).replace(/"/g, '""')}"`;
    const escapedCategory = `"${String(item.category || '').replace(/"/g, '""')}"`;
    csvLines.push(`${escapedText},${item.label},${escapedCategory}`);
  });
  fs.writeFileSync(READY_CSV_PATH, csvLines.join('\n'), 'utf8');
  console.log(`💾 Saved CSV dataset to: ${READY_CSV_PATH}`);

  // Train and update local model knowledge
  trainAndUpdateLocalModel(combined);
  console.log('🎉 Model training & active learning pipeline completed successfully!');
}

if (require.main === module) {
  runDatasetAndModelTraining();
}

module.exports = {
  runDatasetAndModelTraining
};
