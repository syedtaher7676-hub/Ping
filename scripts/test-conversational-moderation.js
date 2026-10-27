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

    const modRes = moderateMessage('test_user_low_' + le.text, le.text);
    assert.strictEqual(modRes.allowed, false, `moderateMessage should block low-effort line: "${le.text.replace(/\n/g, '\\n')}"`);
    assert.ok(modRes.message.length > 0, `Warning message provided: ${modRes.message}`);

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

  console.log('\n--- 4.1 Testing 2028-30 Fuzzy Vulgarities, Dismissals & Body Parts (fuck off, boobs, etc.) ---');
  const { evaluateFuzzyBadWords } = require('../src/utils/fuzzyModerator');
  const { evaluateConversationTrajectory } = require('../src/utils/conversationTrajectory');
  const { ingestIncomingChatMessage, ingestReportedConversation } = require('../src/services/modelTrainer');

  const fuzzyBadWordsCases = [
    { text: "fuck off", note: "Direct hostile dismissal" },
    { text: "fck off", note: "Leetspeak omission dismissal" },
    { text: "fk off", note: "Consonant abbreviation dismissal" },
    { text: "fuk off", note: "Phonetic misspelling dismissal" },
    { text: "fuck", note: "Direct vulgar root" },
    { text: "fck", note: "Consonant root" },
    { text: "fuk", note: "Phonetic variant" },
    { text: "boobs", note: "Direct sexual request keyword" },
    { text: "bobs", note: "Slang/phonetic variant of boobs" },
    { text: "b00bs", note: "Leetspeak zeros variant of boobs" },
    { text: "b.o.o.b.s", note: "Dotted variant of boobs" },
    { text: "tits", note: "Explicit body part" },
    { text: "pussy", note: "Vulgar body part" },
    { text: "bitch", note: "Gendered slur" },
    { text: "b1tch", note: "Leetspeak bitch" }
  ];

  for (const fbc of fuzzyBadWordsCases) {
    const slurResult = detectSlurWithContext(fbc.text);
    const safety = await checkMessageSafety(fbc.text);
    const isBlocked = slurResult.hasSlur || !safety.valid;

    assert.strictEqual(isBlocked, true, `Should detect and block fuzzy bad word: "${fbc.text}" (${fbc.note})`);
    console.log(`   ✅ BLOCKED [${fbc.note}] "${fbc.text}" -> Reason: ${slurResult.hasSlur ? 'slur_detected' : safety.reason}`);
  }

  console.log('\n--- 4.2 Testing Safe Words & Exceptions (book, boots, focus, cocktail, etc.) ---');
  const safeExceptionWords = [
    "I just finished reading a good book",
    "put on your winter boots before leaving",
    "try to maintain your focus on this problem",
    "we ordered a fruit cocktail at the bar",
    "can you pass the documents to me?",
    "a duck was swimming in the pond",
    "my assistant will follow up tomorrow",
    "let's count the votes carefully",
    "we enjoyed a quiet day at the beach"
  ];

  for (const sew of safeExceptionWords) {
    const slurResult = detectSlurWithContext(sew);
    const safety = await checkMessageSafety(sew);
    assert.strictEqual(slurResult.hasSlur, false, `Safe sentence must not trigger slur filter: "${sew}"`);
    assert.strictEqual(safety.valid, true, `Safe sentence must pass safety checks: "${sew}"`);
    console.log(`   ✅ ALLOWED SAFE WORD EXCEPTION: "${sew}"`);
  }

  console.log('\n--- 4.3 Testing Conversational Trajectory & Recipient Comfort Engine ---');
  const testRoomId = 'room_traj_test_' + Date.now();
  const userA = 'user_sender_' + Date.now();
  const userB = 'user_partner_' + Date.now();

  // Test 1: Friendly starter -> should be allowed and increase health
  const startRes = evaluateConversationTrajectory(testRoomId, userA, "hey how are you doing today?", userB);
  assert.strictEqual(startRes.allowed, true, "Friendly conversational starter must be allowed");
  console.log(`   ✅ ALLOWED Healthy opening message -> Health: ${startRes.healthScore}`);

  // Test 2: Hostile derailing message -> must be blocked pre-send
  const hostileRes = evaluateConversationTrajectory(testRoomId, userA, "you are so boring stfu", userB);
  assert.strictEqual(hostileRes.allowed, false, "Hostile conversational line must be blocked pre-send");
  assert.strictEqual(hostileRes.category, 'conversation_health');
  console.log(`   ✅ BLOCKED Hostile derailing message -> Category: ${hostileRes.category}`);

  // Test 3: Unanswered pestering spam -> 4 unanswered messages with nagging trigger anti-spam block
  const spamRoomId = 'room_spam_test_' + Date.now();
  evaluateConversationTrajectory(spamRoomId, userA, "hello?", userB);
  evaluateConversationTrajectory(spamRoomId, userA, "reply?", userB);
  evaluateConversationTrajectory(spamRoomId, userA, "u there?", userB);
  const pesterRes = evaluateConversationTrajectory(spamRoomId, userA, "answer me fast", userB);
  assert.strictEqual(pesterRes.allowed, false, "4th unanswered nagging message must be blocked to protect recipient");
  assert.strictEqual(pesterRes.category, 'anti_spam_protection');
  console.log(`   ✅ BLOCKED Unanswered pestering spam -> Category: ${pesterRes.category}`);

  // Test 4: Boundary violation after partner deflection -> partner says "stop" then sender pressures
  const boundaryRoomId = 'room_boundary_test_' + Date.now();
  evaluateConversationTrajectory(boundaryRoomId, userB, "please stop i am not interested", userA);
  const pressuringRes = evaluateConversationTrajectory(boundaryRoomId, userA, "come on send pic just one", userB);
  assert.strictEqual(pressuringRes.allowed, false, "Pressuring after partner deflection must be blocked");
  assert.strictEqual(pressuringRes.category, 'harassment_boundary_protection');
  console.log(`   ✅ BLOCKED Boundary violation / pressuring -> Category: ${pressuringRes.category}`);

  console.log('\n--- 5. Testing Active Learning & Continuous Data Model Training ---');
  // Ingest sample from chat app and verify model training updates
  const testSample = "test_violation_sample_" + Date.now();
  recordChatSampleForTraining(testSample, 1, 'active_learning_test');

  const retestSafety = await checkMessageSafety(testSample);
  assert.strictEqual(retestSafety.valid, false, `Model should immediately recognize ingested training sample: "${testSample}"`);
  console.log(`   ✅ Retrained model actively learned and blocked: "${testSample}"`);

  // Test reported conversation ingestion
  ingestReportedConversation(userB, userA, [
    { senderId: userA, text: "hey creepy evasion " + Date.now(), timestamp: Date.now() }
  ]);
  console.log(`   ✅ Ingested reported conversation for active self-training.`);

  console.log('\n--- 6. Testing 2030 Coercion & Off-Platform Grooming Intent Analysis ---');
  const { evaluateMessage, POLITE_MESSAGES } = require('../src/utils/unifiedModerator');
  const coercionGroomingCases = [
    { text: "don't tell anyone about this", note: "Secrecy isolation" },
    { text: "keep this our secret okay", note: "Secret keeping" },
    { text: "delete this chat after reading", note: "Off-record evasion" },
    { text: "switch to secret chat right now", note: "Off-platform secret chat" },
    { text: "sneak out and meet me tonight", note: "Predatory meetup pressure" },
    { text: "are your parents home right now?", note: "Parental absence probing" },
    { text: "are you alone in your room?", note: "Isolation probing" },
    { text: "be a good girl for me and reply", note: "Grooming obedience phrase" },
    { text: "be obedient and do what i say", note: "Coercive command" },
    { text: "if you don't send it you will regret it", note: "Coercive threat" },
    { text: "prove you trust me by sending it", note: "Trust manipulation" },
    { text: "turn on cam or i will leave", note: "Cam pressure coercion" },
    { text: "send pic or i am disconnecting", note: "Disconnection ultimatum" }
  ];

  for (const cgc of coercionGroomingCases) {
    const res = evaluateMessage(cgc.text);
    assert.strictEqual(res.valid, false, `Should detect coercion/grooming: "${cgc.text}" (${cgc.note})`);
    assert.strictEqual(res.label, POLITE_MESSAGES.COERCION_GROOMING, `Clean label must be polite guidance: "${cgc.text}"`);
    console.log(`   ✅ BLOCKED COERCION/GROOMING [${cgc.note}] "${cgc.text}" -> Label: "${res.label}"`);
  }

  console.log('\n--- 7. Testing Category-Specific Polite Chat Labels (Zero Popups) ---');
  const categoryLabelCases = [
    { text: "call me at 9876543210", expectedLabel: POLITE_MESSAGES.PHONE_NUMBER, note: "Phone sharing" },
    { text: "what is your whatsapp number?", expectedLabel: POLITE_MESSAGES.ASKING_PHONE, note: "Asking phone number" },
    { text: "follow my insta: @cool_user", expectedLabel: POLITE_MESSAGES.SOCIAL_MEDIA, note: "Social media handle" },
    { text: "check out https://example.com/free", expectedLabel: POLITE_MESSAGES.LINKS, note: "External link" },
    { text: "keep this a secret don't tell your mom", expectedLabel: POLITE_MESSAGES.COERCION_GROOMING, note: "Coercion/grooming" },
    { text: "fuck off you idiot", expectedLabel: POLITE_MESSAGES.BAD_WORDS_PLAIN, note: "Bad words / hostility" },
    { text: "hello.........", expectedLabel: POLITE_MESSAGES.SYMBOLS_EXCESSIVE, note: "Excessive punctuation" },
    { text: "m or f?", expectedLabel: POLITE_MESSAGES.LOW_EFFORT, note: "Low-effort probe" }
  ];

  for (const clc of categoryLabelCases) {
    const res = evaluateMessage(clc.text);
    assert.strictEqual(res.valid, false, `Message should be blocked: "${clc.text}" (${clc.note})`);
    assert.strictEqual(res.label, clc.expectedLabel, `Expected clean label "${clc.expectedLabel}" but got "${res.label}" for "${clc.text}"`);
    console.log(`   ✅ CLEAN LABEL [${clc.note}]: "${clc.text}" -> Label: "${res.label}"`);
  }

  console.log('\n--- 8. Testing Automated Anomaly Scoring & Local Embeddings Verification ---');
  const { calculateAnomalyScore } = require('../src/services/modelTrainer');

  // Test 8.1: Adversarial attack trying to poison model by claiming safe colloquial phrases are violations
  const falsePositivePoison = "I'm gonna kill this exam today!";
  const anomaly1 = calculateAnomalyScore(falsePositivePoison, 1);
  assert.strictEqual(anomaly1.isAnomalous, true, "Should flag adversarial safe idiom submission as anomalous");
  assert.ok(anomaly1.score >= 0.65, `Anomaly score must be >= 0.65 (was ${anomaly1.score})`);
  console.log(`   ✅ QUARANTINED Poisoning Attempt 1 (Clean idiom labeled toxic) -> Anomaly Score: ${anomaly1.score.toFixed(2)}, Reasons: ${anomaly1.reasons.join(', ')}`);

  // Test 8.2: Adversarial attack trying to poison model by claiming common textbook words are violations
  const falsePositivePoison2 = "computer science study in college";
  const anomaly2 = calculateAnomalyScore(falsePositivePoison2, 1);
  assert.strictEqual(anomaly2.isAnomalous, true, "Should flag benign academic words labeled toxic as anomalous");
  console.log(`   ✅ QUARANTINED Poisoning Attempt 2 (Academic words labeled toxic) -> Anomaly Score: ${anomaly2.score.toFixed(2)}, Reasons: ${anomaly2.reasons.join(', ')}`);

  // Test 8.3: Adversarial attack trying to poison safe class by claiming slurs are safe
  const toxicPoison = "diddy fuk off";
  const anomaly3 = calculateAnomalyScore(toxicPoison, 0);
  assert.strictEqual(anomaly3.isAnomalous, true, "Should flag toxic phrases labeled safe as anomalous");
  console.log(`   ✅ QUARANTINED Poisoning Attempt 3 (Toxic phrase labeled safe) -> Anomaly Score: ${anomaly3.score.toFixed(2)}, Reasons: ${anomaly3.reasons.join(', ')}`);

  // Test 8.4: Legitimate chat sample with correct label has low anomaly score
  const legitimateSample = "fuck off bitch";
  const legitAnomaly = calculateAnomalyScore(legitimateSample, 1);
  assert.strictEqual(legitAnomaly.isAnomalous, false, "Legitimate violation sample must pass anomaly verification");
  console.log(`   ✅ ACCEPTED Legitimate sample for self-training -> Anomaly Score: ${legitAnomaly.score.toFixed(2)} (Below threshold)`);

  console.log('\n🎉 ALL 2030 MODERATION, COERCION, LABELS, EMBEDDINGS & ANOMALY TESTS PASSED 100%!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
