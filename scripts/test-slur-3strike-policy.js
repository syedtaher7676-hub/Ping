// Comprehensive test for Slur & Inappropriate Communication Filter (Polite Warning Policy)
const assert = require('assert');
const { slurFilter } = require('../src/data');
const { POLITE_MESSAGES } = require('../src/utils/unifiedModerator');

console.log('🧪 Testing Slur & Inappropriate Communication Filter (Polite Warning Policy)...');

async function runTests() {
  const testUserId = 'test_user_strike_' + Date.now();
  const testIp = '198.51.100.42'; // RFC 5737 TEST-NET-2

  // Ensure clean state for test identifiers
  slurFilter.clearUserSlurViolations(testUserId);
  slurFilter.clearPenalty(testUserId);
  slurFilter.clearUserSlurViolations(testIp);
  slurFilter.clearPenalty(testIp);

  // 1. Test clean message passes
  const cleanResult = slurFilter.moderateSlurMessage(testUserId, 'Hello friend! Nice to meet you.', testIp);
  assert.strictEqual(cleanResult.allowed, true, 'Clean message should be allowed');
  assert.strictEqual(cleanResult.hasSlur, false, 'Clean message should not detect slur');
  console.log('✅ Clean message passed without detection');

  // 2. Test 1st Offense: Blocked with nice label, zero ban duration
  const offense1 = slurFilter.moderateSlurMessage(testUserId, 'You are a bitch', testIp);
  assert.strictEqual(offense1.allowed, false, 'Message with slur must be blocked on 1st offense');
  assert.strictEqual(offense1.action, 'blocked_label', 'Action should be blocked_label');
  assert.strictEqual(offense1.violationCount, 1, 'Violation count should be 1');
  assert.ok(
    offense1.message.includes("Please don't use bad words here"),
    'Warning message on 1st offense must include nice label'
  );
  assert.strictEqual(offense1.duration, 0, 'Duration on 1st offense should be 0 (no ban/cooldown)');
  console.log('✅ 1st Offense test passed:', offense1.message);

  // 3. Test 2nd Offense: Blocked with nice label, zero ban duration
  const offense2 = slurFilter.moderateSlurMessage(testUserId, 'Shut up slut', testIp);
  assert.strictEqual(offense2.allowed, false, 'Message with slur must be blocked on 2nd offense');
  assert.strictEqual(offense2.action, 'blocked_label', 'Action should be blocked_label');
  assert.strictEqual(offense2.violationCount, 2, 'Violation count should be 2');
  assert.ok(
    offense2.message.includes("Please don't use bad words here"),
    'Warning message on 2nd offense must include nice label'
  );
  assert.strictEqual(offense2.duration, 0, 'Duration on 2nd offense should be 0');
  console.log('✅ 2nd Offense test passed:', offense2.message);

  // 4. Test 3rd Offense: NO 15-min ban, still blocked with nice label, session preserved
  const offense3 = slurFilter.moderateSlurMessage(testUserId, 'fuck off gandu', testIp);
  assert.strictEqual(offense3.allowed, false, 'Message with slur must be blocked on 3rd offense');
  assert.strictEqual(offense3.action, 'blocked_label', 'Action should be blocked_label (no ban_15min)');
  assert.strictEqual(offense3.violationCount, 3, 'Violation count should be 3');
  assert.strictEqual(offense3.duration, 0, 'Ban duration must be 0 (ban removed per user requirement)');
  assert.ok(
    offense3.message.includes("Please don't use bad words here"),
    'Message on 3rd offense must give the offender the nice label'
  );
  console.log('✅ 3rd Offense test passed (no 15-min ban, nice label shown):', offense3.message);

  // 5. Test Active Penalty Retrieval: Bans are disabled, so penalty should be null
  const activeUserPenalty = slurFilter.getActivePenalty(testUserId);
  assert.strictEqual(activeUserPenalty, null, 'Active penalty should be null because bans are disabled');

  const activeIpPenalty = slurFilter.getActivePenalty(testIp);
  assert.strictEqual(activeIpPenalty, null, 'Active IP penalty should be null because bans are disabled');
  console.log('✅ 15-min ban successfully removed across User ID & IP');

  // 6. Test Multi-lingual slurs across all languages
  const multilingualTests = [
    { text: "salope", lang: "French" },
    { text: "hijo de puta", lang: "Spanish" },
    { text: "arschloch", lang: "German" },
    { text: "stronzo", lang: "Italian" },
    { text: "bokachoda", lang: "Bengali" },
    { text: "gashti", lang: "Punjabi" },
    { text: "zhavadya", lang: "Marathi" },
    { text: "sulemaga", lang: "Kannada" },
    { text: "lanjakodaka", lang: "Telugu" },
    { text: "thevidiya", lang: "Tamil" },
    { text: "thaayoli", lang: "Malayalam" },
    { text: "blyad", lang: "Russian" },
    { text: "sharmuta", lang: "Arabic" },
    { text: "putangina", lang: "Tagalog" }
  ];

  for (const mt of multilingualTests) {
    const det = slurFilter.detectSlurWithContext(mt.text);
    assert.strictEqual(det.hasSlur, true, `Slur in ${mt.lang} ("${mt.text}") must be detected`);
    console.log(`✅ [${mt.lang}] detected: "${mt.text}"`);
  }

  // Cleanup test identifiers
  slurFilter.clearUserSlurViolations(testUserId);
  slurFilter.clearPenalty(testUserId);
  slurFilter.clearUserSlurViolations(testIp);
  slurFilter.clearPenalty(testIp);

  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY WITH POLITE MESSAGES & MULTI-LINGUAL SUPPORT!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
