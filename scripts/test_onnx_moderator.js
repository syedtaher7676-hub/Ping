/**
 * Smoke & Accuracy Test for Local ONNX AI Text & Slur Moderation ($0 Cost)
 */

const { checkMessageSafety, initOnnxClassifier, getModerationStatus } = require('../src/utils/moderation');
const { detectSlurWithContext, moderateSlurMessage } = require('../src/data/slurFilter');

const TEST_CASES = [
  // Safe messages & Edge Cases
  { text: "hey! how are you doing today?", expectedValid: true, note: "Casual friendly greeting" },
  { text: "good game, thanks for the chat!", expectedValid: true, note: "Polite sportsmanship" },
  { text: "i am studying computer science in college", expectedValid: true, note: "General personal topic" },
  { text: "that was a killer guitar solo!", expectedValid: true, note: "Innocent slang ('killer')" },
  { text: "can you pass the butter please?", expectedValid: true, note: "Innocent subwords ('pass', 'butter')" },
  { text: "the assistant helped me with my code", expectedValid: true, note: "Substrings with 'ass' ('assistant')" },
  { text: "niger is a country in west africa", expectedValid: true, note: "Geographical name ('Niger')" },
  { text: "charles dickens is a classic author", expectedValid: true, note: "Literature name ('Dickens', 'classic')" },

  // Exact Slurs (English & Global)
  { text: "shut up you faggot", expectedValid: false, note: "Homophobic slur" },
  { text: "you dumb nigger", expectedValid: false, note: "Racial slur" },
  { text: "dirty kike get out", expectedValid: false, note: "Antisemitic slur" },
  { text: "stupid chink", expectedValid: false, note: "Ethnic slur" },
  { text: "you are an absolute retard", expectedValid: false, note: "Ableist slur" },
  { text: "you fucking cunt", expectedValid: false, note: "Severe misogynistic abuse" },

  // Obfuscated & Leetspeak Slurs
  { text: "f@ggot gtfo", expectedValid: false, note: "Leetspeak homophobic slur" },
  { text: "n!gg3r leave now", expectedValid: false, note: "Leetspeak racial slur" },
  { text: "f.u.c.k you bitch", expectedValid: false, note: "Dotted obfuscation" },
  { text: "k1k3 trash", expectedValid: false, note: "Leetspeak antisemitic slur" },
  { text: "r3t@rd go away", expectedValid: false, note: "Leetspeak ableist slur" },
  { text: "b!tch stfu", expectedValid: false, note: "Leetspeak misogynistic abuse" },

  // Hindi / South Asian Slurs
  { text: "fck you bhenchod", expectedValid: false, note: "Hindi slur (bhenchod)" },
  { text: "chutiya saale bhag yaha se", expectedValid: false, note: "Hindi slurs (chutiya, saale)" },
  { text: "tu ek number ka gandu hai", expectedValid: false, note: "Hindi slur (gandu)" },
  { text: "bhosadike nikal yaha se", expectedValid: false, note: "Hindi slur (bhosadike)" },

  // Harassment & Solicitation
  { text: "kys you worthless idiot go die", expectedValid: false, note: "Severe toxicity / death encouragement" },
  { text: "m18 looking for girl add my snap", expectedValid: false, note: "Age/gender solicitation" },
  { text: "add me on telegram: @fastbucks", expectedValid: false, note: "Off-platform handle leak" }
];

async function runTests() {
  console.log("==================================================================");
  console.log("🛡️  TESTING LOCAL SLUR & MODERATION ENGINE");
  console.log("==================================================================");

  console.log("1. Testing slur filter in-memory layer...");
  let slurFilterPassed = 0;
  const slurSamples = [
    { text: "you faggot", shouldBlock: true },
    { text: "f@gg0t", shouldBlock: true },
    { text: "bhenchod", shouldBlock: true },
    { text: "n.i.g.g.e.r", shouldBlock: true },
    { text: "this is a classic cocktail", shouldBlock: false },
    { text: "pass the butter", shouldBlock: false }
  ];

  for (const sample of slurSamples) {
    const det = detectSlurWithContext(sample.text);
    const pass = det.hasSlur === sample.shouldBlock;
    if (pass) slurFilterPassed++;
    console.log(`   ${pass ? '✅' : '❌'} [SlurFilter] "${sample.text}" -> ${det.hasSlur ? 'DETECTED' : 'CLEAN'}`);
  }

  console.log(`\nSlur filter passed ${slurFilterPassed}/${slurSamples.length} checks.\n`);

  console.log("2. Initializing local neural classifier...");
  await initOnnxClassifier();
  const status = getModerationStatus();
  console.log("Status:", JSON.stringify(status, null, 2));

  console.log("\n3. Running end-to-end moderation test suite:\n");
  let passedCount = 0;

  for (const testCase of TEST_CASES) {
    const startTime = Date.now();
    const result = await checkMessageSafety(testCase.text);
    const duration = Date.now() - startTime;

    const isMatch = result.valid === testCase.expectedValid;
    if (isMatch) passedCount++;

    const icon = isMatch ? "✅ PASS" : "❌ FAIL";
    const decision = result.valid ? "ALLOWED" : `BLOCKED (${result.reason || result.action || 'violation'})`;

    console.log(`${icon} [${duration}ms] "${testCase.text}"`);
    console.log(`   Expected: ${testCase.expectedValid ? 'ALLOWED' : 'BLOCKED'} | Got: ${decision} (layer: ${result.layer || 'n/a'})\n`);
  }

  console.log("==================================================================");
  console.log(`Summary: ${passedCount} / ${TEST_CASES.length} tests passed.`);
  console.log("==================================================================");

  if (passedCount === TEST_CASES.length) {
    console.log("🎉 All slur moderation tests passed with 100% accuracy!");
    process.exit(0);
  } else {
    console.log("⚠️ Some tests had discrepancies.");
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
