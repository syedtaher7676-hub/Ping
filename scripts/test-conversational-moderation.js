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
    { text: "n\ni\ng\ng\na", note: "Multi-line vertical nigga" },
    { text: "////nigga", note: "Slash-prefixed nigga" },
    { text: "////n/i/g/g/a", note: "Slashed spaced nigga" },
    { text: "f.a.g.g.o.t", note: "Dotted f-slur" },
    { text: "b h e n c h o d", note: "Spaced Hindi slur" },
    { text: "b.h.e.n.c.h.o.d", note: "Dotted Hindi slur" },
    // Kannada slurs
    { text: "sule", note: "Direct Kannada slur" },
    { text: "sulemaga", note: "Kannada compound slur" },
    { text: "s\nu\nl\ne", note: "Vertical Kannada slur" },
    { text: "t-h-i-k-a", note: "Hyphenated Kannada profanity" },
    { text: "tullu", note: "Kannada tullu" },
    { text: "shata", note: "Kannada shata" },
    { text: "nin amman", note: "Kannada nin amman" },
    { text: "sulay magane", note: "Kannada sulay magane" },
    { text: "sule magane", note: "Kannada sule magane" },
    { text: "tikka", note: "Kannada tikka" },
    { text: "bolimaga", note: "Kannada bolimaga" },
    { text: "baddimaga", note: "Kannada baddimaga" },
    { text: "bevarsi nan maga", note: "Kannada bevarsi nan maga" },
    // Tamil slurs
    { text: "thevidiya", note: "Direct Tamil slur" },
    { text: "punda", note: "Direct Tamil profanity" },
    { text: "otha", note: "Tamil curse" },
    { text: "pundamavane", note: "Tamil pundamavane" },
    { text: "oombu", note: "Tamil oombu" },
    { text: "t.h.e.v.i.d.i.y.a", note: "Dotted Tamil slur" },
    { text: "p\nu\nn\nd\na", note: "Vertical Tamil profanity" },
    // Telugu slurs
    { text: "lanja", note: "Direct Telugu slur" },
    { text: "lanjakodaka", note: "Telugu compound slur" },
    { text: "l/a/n/j/a", note: "Slashed Telugu slur" },
    { text: "s\nu\nl\nl\ni", note: "Vertical Telugu profanity" },
    { text: "dengu", note: "Telugu dengu" },
    { text: "modda gudu", note: "Telugu modda gudu" },
    { text: "gudha cheeku", note: "Telugu gudha cheeku" },
    // Malayalam slurs
    { text: "myre", note: "Malayalam myre" },
    { text: "thaayoli", note: "Malayalam thaayoli" },
    { text: "thendi", note: "Malayalam thendi" },
    { text: "pulayadi", note: "Malayalam pulayadi" },
    { text: "kunna", note: "Malayalam kunna" },
    { text: "kundi", note: "Malayalam kundi" },
    { text: "pooru", note: "Malayalam pooru" },
    { text: "poorimone", note: "Malayalam poorimone" },
    // Elongated and masked words (gaandu / gxxndu format)
    { text: "gaandu", note: "Elongated gaandu" },
    { text: "gxxndu", note: "Masked xx in gandu" },
    { text: "g*ndu", note: "Asterisk masked gandu" },
    { text: "bxxch", note: "Masked bitch" },
    { text: "nxxga", note: "Masked nigga" },
    { text: "pxxda", note: "Masked punda" },
    { text: "txxlu", note: "Masked tullu" },
    { text: "t*llu", note: "Masked asterisk tullu" },
    { text: "sxxle", note: "Masked sule" },
    { text: "sxxle mxgxne", note: "Multi-word masked sule magane" },
    { text: "nxx ammxx", note: "Multi-word masked nin amman" },
    { text: "txkka", note: "Masked tikka" },
    { text: "lxxja", note: "Masked lanja" },
    { text: "shxta", note: "Masked shata" },
    { text: "sh*ta", note: "Masked asterisk shata" },
    { text: "mxxre", note: "Masked myre" }
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

  console.log('\n--- 1.1 Testing Phone Number Sharing (Vertical, Spaced, Words) ---');
  const phoneCases = [
    { text: "9\n5\n6\n3\n6\n9\n3\n2\n5\n7", note: "Vertical multi-line phone number" },
    { text: "9 5 6 3 6 9 3 2 5 7", note: "Spaced digits phone number" },
    { text: "9.5.6.3.6.9.3.2.5.7", note: "Dot separated phone number" },
    { text: "9-5-6-3-6-9-3-2-5-7", note: "Hyphen separated phone number" },
    { text: "9563693257", note: "Direct 10-digit mobile number" },
    { text: "+91 95636 93257", note: "International formatted mobile number" },
    { text: "call me at 9563693257", note: "Phone number with call keyword" },
    { text: "nine five six three six nine three two five seven", note: "Written number words" }
  ];

  for (const pc of phoneCases) {
    const safety = await checkMessageSafety(pc.text);
    assert.strictEqual(safety.valid, false, `Phone number sharing must be blocked: "${pc.text.replace(/\n/g, '\\n')}" (${pc.note})`);
    console.log(`   ✅ BLOCKED [${pc.note}] "${pc.text.replace(/\n/g, '\\n')}" -> Reason: ${safety.reason}`);
  }

  console.log('\n--- 1.2 Testing Instagram & Snapchat Sharing ---');
  const socialCases = [
    { text: "add my snap: coolguy123", note: "Snapchat handle invitation" },
    { text: "snapchat.com/add/coolguy", note: "Snapchat link" },
    { text: "my insta is @cool_vibes", note: "Instagram handle" },
    { text: "instagram.com/cool_vibes", note: "Instagram link" },
    { text: "sc: my_snap_user", note: "SC shortcut tag" },
    { text: "ig: my_insta_user", note: "IG shortcut tag" },
    { text: "dm me on instagram", note: "Instagram DM invitation" }
  ];

  for (const sc of socialCases) {
    const safety = await checkMessageSafety(sc.text);
    assert.strictEqual(safety.valid, false, `Social media sharing must be blocked: "${sc.text}" (${sc.note})`);
    console.log(`   ✅ BLOCKED [${sc.note}] "${sc.text}" -> Reason: ${safety.reason}`);
  }

  console.log('\n--- 1.3 Testing Restricted Symbols vs Allowed Punctuation (, and .) ---');
  const symbolCases = [
    { text: "////hello", note: "Slash prefix spam", shouldBlock: true },
    { text: "@everyone", note: "At sign symbol", shouldBlock: true },
    { text: "$100 dollars", note: "Dollar symbol", shouldBlock: true },
    { text: "*hello world*", note: "Asterisk wrapping", shouldBlock: true },
    { text: "Hello, this is a clean message.", note: "Clean message with comma and period", shouldBlock: false },
    { text: "I enjoy programming, music, and art.", note: "Clean list with commas and period", shouldBlock: false }
  ];

  for (const sc of symbolCases) {
    const safety = await checkMessageSafety(sc.text);
    if (sc.shouldBlock) {
      assert.strictEqual(safety.valid, false, `Message with restricted symbols should be blocked: "${sc.text}" (${sc.note})`);
      console.log(`   ✅ BLOCKED RESTRICTED SYMBOL [${sc.note}] "${sc.text}"`);
    } else {
      assert.strictEqual(safety.valid, true, `Clean message with allowed punctuation should pass: "${sc.text}" (${sc.note})`);
      console.log(`   ✅ ALLOWED CLEAN PUNCTUATION [${sc.note}] "${sc.text}"`);
    }
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
