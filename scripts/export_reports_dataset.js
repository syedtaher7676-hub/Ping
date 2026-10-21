/**
 * Dataset Exporter & Active Learning Generator
 * Reads logged violations, user reports, and seed data,
 * generates multi-format augmentations (vertical, dotted, leetspeak, phonetic),
 * and formats them into clean JSON/CSV datasets ready for model training.
 */

const fs = require('fs');
const path = require('path');
const { runDatasetAndModelTraining } = require('./train_and_update_model');

runDatasetAndModelTraining();
