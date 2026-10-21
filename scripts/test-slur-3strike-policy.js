// Comprehensive test for Slur & Inappropriate Communication Filter (3-Strike Policy)
const assert = require('assert');
const { slurFilter } = require('../src/data');

console.log('🧪 Testing Slur & Inappropriate Communication Filter (3-Strike Policy)...');

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

  // 2. Test 1st Offense
  const offense1 = slurFilter.moderateSlurMessage(testUserId, 'You are a bitch', testIp);
  assert.strictEqual(offense1.allowed, false, 'Message with slur must be blocked on 1st offense');
  assert.strictEqual(offense1.action, 'warning_1', 'Action should be warning_1');
  assert.strictEqual(offense1.violationCount, 1, 'Violation count should be 1');
  assert.strictEqual(
    offense1.message,
    '⚠️ Warning (1/3): Inappropriate language detected. Message was not sent. Please keep conversations respectful!',
    'Warning message on 1st offense must match exact specification'
  );
  assert.strictEqual(offense1.duration, 0, 'Duration on 1st offense should be 0 (no ban/cooldown)');
  console.log('✅ 1st Offense test passed:', offense1.message);

  // 3. Test 2nd Offense
  const offense2 = slurFilter.moderateSlurMessage(testUserId, 'Shut up slut', testIp);
  assert.strictEqual(offense2.allowed, false, 'Message with slur must be blocked on 2nd offense');
  assert.strictEqual(offense2.action, 'warning_2', 'Action should be warning_2');
  assert.strictEqual(offense2.violationCount, 2, 'Violation count should be 2');
  assert.strictEqual(
    offense2.message,
    '⚠️ Warning (2/3): Inappropriate language detected again. Message was not sent. One more violation will result in a 15-minute ban!',
    'Warning message on 2nd offense must match exact specification'
  );
  assert.strictEqual(offense2.duration, 0, 'Duration on 2nd offense should be 0 (chat continues, no text cooldown)');
  console.log('✅ 2nd Offense test passed:', offense2.message);

  // 4. Test 3rd Offense
  const offense3 = slurFilter.moderateSlurMessage(testUserId, 'fuck off gandu', testIp);
  assert.strictEqual(offense3.allowed, false, 'Message with slur must be blocked on 3rd offense');
  assert.strictEqual(offense3.action, 'ban_15min', 'Action should be ban_15min on 3rd offense');
  assert.strictEqual(offense3.violationCount, 3, 'Violation count should be 3');
  assert.strictEqual(offense3.duration, 900000, 'Ban duration must be 15 minutes (900,000 ms)');
  assert.strictEqual(
    offense3.message,
    '⚠️ You have been banned for 15 minutes due to repeated inappropriate language or slurs.',
    'Ban message must match specification'
  );
  console.log('✅ 3rd Offense test passed (15-min ban triggered):', offense3.message);

  // 5. Test Active Penalty Retrieval for user ID and IP
  const activeUserPenalty = slurFilter.getActivePenalty(testUserId);
  assert.ok(activeUserPenalty, 'Active penalty should be present for user ID');
  assert.strictEqual(activeUserPenalty.type, 'ban_15min', 'Penalty type should be ban_15min');
  assert.strictEqual(activeUserPenalty.duration, 900000, 'Duration should be 900000 ms');

  const activeIpPenalty = slurFilter.getActivePenalty(testIp);
  assert.ok(activeIpPenalty, 'Active penalty should be present for IP');
  assert.strictEqual(activeIpPenalty.type, 'ban_15min', 'IP penalty type should be ban_15min');
  console.log('✅ Ban enforced across both User ID & IP');

  // 6. Test Obfuscation / Leetspeak detection
  const leetTest = slurFilter.detectSlurWithContext('b!tch');
  assert.strictEqual(leetTest.hasSlur, true, 'Leetspeak slur should be detected');
  const spaceTest = slurFilter.detectSlurWithContext('s.l.u.t');
  assert.strictEqual(spaceTest.hasSlur, true, 'Stripped spacers slur should be detected');
  console.log('✅ Obfuscation and leetspeak bypasses correctly blocked');

  // Cleanup test identifiers
  slurFilter.clearUserSlurViolations(testUserId);
  slurFilter.clearPenalty(testUserId);
  slurFilter.clearUserSlurViolations(testIp);
  slurFilter.clearPenalty(testIp);

  console.log('🎉 ALL 3-STRIKE FILTER TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
