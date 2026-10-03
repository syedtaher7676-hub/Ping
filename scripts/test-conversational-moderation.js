/**
 * 🧪 COMPREHENSIVE TEST FOR CONVERSATIONAL TEXT-LINE & OBFUSCATION MODERATION
 *
 * Verifies:
 * 1. Multi-format bad conversations & predatory slang (dixxy, diddy, di...dd...y,
 *    d\ni\nd\nd\ny, d-i-d-d-y, d.i.d.d.y, d i d d y, d*i*x*x*y, k\ny\ns, f\na\ng)
 *    are 100% detected and removed.
 * 2. Low-effort messages (gender/age probing, one-word handle hunting, dead-ends,
 *    vertical spam, gibberish) immediately trigger warnings and are blocked.
 * 3. Safe colloquial English expressions like "I'm gonna kill this exam!",
 *    "that joke killed me", "my feet are killing me" are 100% allowed (0 false positives).
 * 4. Active learning & training pipeline ingests chat app data and updates the model.
 */

const assert = require('assert');
const { analyzeConversationLine } = require('../src/utils/conversationModerator');
const { checkMessageSafety } = require('../src/utils/moderation');
const slurFilter = require('../src/data/slurFilter');
const { detectSlurWithContext, moderateSlurMessage } = slurFilter;
const { moderateMessage, detectLowQualityMessage } = require('../src/data/moderation');
const { recordChatSampleForTraining, trainAndUpdateLocalModel } = require('../src/services/modelTrainer');

console.log('🧪 Testing Multi-Format Obfuscation, Active Learning & Conversational Moderation...');

async function runTests() {
  console.log('\n--- 1. Testing Multi-Format Bad Conversations & Obfuscations (dixxy, diddy, di...dd...y, vertical, etc.) ---');
  const obfuscationCases = [
    { text: "dixxy", note: "Phonetic slang for diddy" },
    { text: "diddy", note: "Direct predatory keyword" },
    { text: "di...dd...y", note: "Dotted spacer format" },
    { text: "d-i-d-d-y", note: "Hyphenated format" },
    { text: "d.i.d.d.y", note: "Dot-delimited format" },
    { text: "d*i*x*x*y", note: "Asterisk-masked phonetic format" },
    { text: "d\ni\nd\nd\ny", note: "Multi-line vertical diddy" },
    { text: "d\ni\nx\nx\ny", note: "Multi-line vertical dixxy" },
    { text: "d i d d y", note: "Spaced letters" },
    { text: "d   i   x   x   y", note: "Widely spaced phonetic" },
    { text: "d1ddy", note: "Leetspeak 1 for i" },
    { text: "d1xxy", note: "Leetspeak 1 for i + xx" },
    { text: "k\ny\ns", note: "Multi-line vertical kys" },
    { text: "k.y.s", note: "Dotted kys" },
    { text: "f\na\ng", note: "Multi-line vertical slur" },
    { text: "n\ni\ng\ng\ne\nr", note: "Multi-line vertical n-slur" },
    { text: "f.a.g.g.o.t", note: "Dotted f-slur" },
    { text: "b h e n c h o d", note: "Spaced Hindi slur" },
    { text: "b.h.e.n.c.h.o.d", note: "Dotted Hindi slur" }
  ];

  for (const tc of obfuscationCases) {
    const slurResult = detectSlurWithContext(tc.text);
    const safety = await checkMessageSafety(tc.text);
    const isBlocked = slurResult.hasSlur || !safety.valid;

    assert.strictEqual(isBlocked, true, `Should detect and block bad conversation: "${tc.text.replace(/\n/g, '\\n')}" (${tc.note})`);

    const modResult = moderateSlurMessage('test_user_obf', tc.text);
    assert.strictEqual(modResult.allowed, false, `Message must never be sent to recipient for: "${tc.text.replace(/\n/g, '\\n')}"`);

    console.log(`   ✅ BLOCKED [${tc.note}] "${tc.text.replace(/\n/g, '\\n')}" -> Action: ${modResult.action}`);
  }

  console.log('\n--- 2. Testing Threatening & Bad Behaviour Conversational Lines ---');
  const threatCases = [
    { text: "i know where you live and i will kill you", note: "Physical harm + Doxxing" },
    { text: "i am going to track your ip and beat you up", note: "IP tracking + Assault threat" },
    { text: "drop your address right now or you will regret it", note: "Address extortion" },
    { text: "send nudes or i will leak your photos", note: "Extortion / Blackmail" },
    { text: "i will hurt you", note: "Direct harm intent" },
    { text: "i am coming to your house", note: "Doorstep stalking" },
    { text: "you are going to die tonight", note: "Death threat" },
    { text: "i will hunt you down and find you", note: "Hunting/Stalking" },
    { text: "i will slit your throat", note: "Severe violent threat" },
    { text: "go kill yourself nobody loves you", note: "Suicide encouragement / Cyberbullying" },
    { text: "send naked pictures or else i leak everything", note: "Sexual coercion / Extortion" },
    { text: "take off your clothes and strip for me", note: "Sexual harassment demand" }
  ];

  for (const tc of threatCases) {
    const analysis = analyzeConversationLine(tc.text);
    assert.strictEqual(analysis.isViolation, true, `Should flag violation for: "${tc.text}" (${tc.note})`);
    assert.strictEqual(analysis.isThreat || analysis.isHarassment, true, `Should flag as threat/harassment: "${tc.text}"`);

    const slurResult = detectSlurWithContext(tc.text);
    assert.strictEqual(slurResult.hasSlur, true, `SlurFilter should intercept threat line: "${tc.text}"`);

    const safety = await checkMessageSafety(tc.text);
    assert.strictEqual(safety.valid, false, `checkMessageSafety should block threat: "${tc.text}"`);

    console.log(`   ✅ BLOCKED [${analysis.category}] "${tc.text}"`);
  }

  console.log('\n--- 3. Testing Low-Effort Lines (English Focus) ---');
  const lowEffortCases = [
    { text: "m", note: "Single letter gender" },
    { text: "f", note: "Single letter gender" },
    { text: "m?", note: "Gender query" },
    { text: "18m", note: "Age-sex tag" },
    { text: "f19", note: "Age-sex tag" },
    { text: "asl", note: "ASL query" },
    { text: "m or f", note: "Gender inquiry" },
    { text: "snap?", note: "One-word handle hunt" },
    { text: "insta?", note: "One-word handle hunt" },
    { text: "send pic", note: "Lazy media demand" },
    { text: "asdfghjkl", note: "Keyboard mash" },
    { text: "............", note: "Punctuation spam" },
    { text: "????????", note: "Question mark spam" },
    { text: "hhhhhhh", note: "Character run flood" },
    { text: "k", note: "Single letter dead-end" },
    { text: "wbu?", note: "Low-effort dead-end" },
    { text: "a\nb\nc\nd", note: "Vertical single letter spam" }
  ];

  for (const le of lowEffortCases) {
    const analysis = analyzeConversationLine(le.text);
    const lowQ = detectLowQualityMessage(le.text);
    const isLow = analysis.isLowEffort || (lowQ && lowQ.detected);

    assert.strictEqual(isLow, true, `Should detect low effort for: "${le.text.replace(/\n/g, '\\n')}" (${le.note})`);

    const modRes = moderateMessage('test_user_low_' + le.text, le.text);
    assert.strictEqual(modRes.allowed, false, `moderateMessage should block low-effort line: "${le.text.replace(/\n/g, '\\n')}"`);
    assert.ok(modRes.message.includes('Low-effort') || modRes.message.includes('Warning'), `Warning message provided: ${modRes.message}`);

    console.log(`   ✅ WARNED [${le.note}] "${le.text.replace(/\n/g, '\\n')}" -> ${modRes.message}`);
  }

  console.log('\n--- 4. Testing Safe English Expressions (Guaranteed 0 False Positives) ---');
  const safeCases = [
    "I'm gonna kill this exam!",
    "i am going to kill this exam",
    "gonna kill this exam today!",
    "i killed that test yesterday",
    "i killed it in my exam today",
    "you killed that guitar solo",
    "that was a killer workout session!",
    "that joke killed me",
    "i am dying of laughter",
    "my phone died earlier",
    "my feet are killing me",
    "can you pass the butter please?",
    "where are you from? i live in canada",
    "hello there, how are you doing today?",
    "what kind of movies do you like?",
    "i am studying computer science in college",
    "the assistant helped me with my code",
    "niger is a country in west africa",
    "charles dickens is a classic author"
  ];

  for (const sc of safeCases) {
    const analysis = analyzeConversationLine(sc);
    assert.strictEqual(analysis.isViolation, false, `Safe phrase should not violate: "${sc}"`);
    assert.strictEqual(analysis.isThreat, false, `Safe phrase should not be threat: "${sc}"`);
    assert.strictEqual(analysis.isLowEffort, false, `Safe phrase should not be low effort: "${sc}"`);

    const slurResult = detectSlurWithContext(sc);
    assert.strictEqual(slurResult.hasSlur, false, `SlurFilter should NOT flag safe phrase: "${sc}"`);

    const safety = await checkMessageSafety(sc);
    assert.strictEqual(safety.valid, true, `checkMessageSafety should allow safe phrase: "${sc}"`);

    console.log(`   ✅ ALLOWED "${sc}"`);
  }

  console.log('\n--- 5. Testing Active Learning & Live Data Model Training ---');
  // Ingest sample from chat app and verify model training updates
  const testSample = "test_violation_sample_" + Date.now();
  recordChatSampleForTraining(testSample, 1, 'active_learning_test');

  const retestSafety = await checkMessageSafety(testSample);
  assert.strictEqual(retestSafety.valid, false, `Model should immediately recognize ingested training sample: "${testSample}"`);
  console.log(`   ✅ Retrained model actively learned and blocked: "${testSample}"`);

  console.log('\n🎉 ALL MULTI-FORMAT OBFUSCATION, ACTIVE LEARNING & MODERATION TESTS PASSED 100%!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
