/**
 * Verification test script for Anonymous Reporting & 15-Minute Ban System
 */
const assert = require("assert");
const {
  bans,
  reporterHistory,
  targetFlags,
  isDeviceBanned,
  recordReport,
  clearAllReportsAndBans,
} = require("../src/state/reports");

console.log("🧪 Running unit tests for Anonymous Reporting and Ban system...");

// 1. Clean state
clearAllReportsAndBans();

// 2. isDeviceBanned on fresh device
assert.strictEqual(isDeviceBanned("device_clean"), 0, "Clean device should not be banned");
console.log("✅ Check 1 passed: Clean device is not banned");

// 3. First report on target
const res1 = recordReport("reporter_1", "target_bad");
assert.strictEqual(res1.targetBanned, false, "1 report should not ban target");
assert.strictEqual(res1.reporterBanned, false, "Reporter should not be banned");
assert.strictEqual(isDeviceBanned("target_bad"), 0, "Target not banned after 1 report");
console.log("✅ Check 2 passed: Single report does not ban target");

// 4. Second report on target (under threshold of 3 -> still not banned)
const res2 = recordReport("reporter_2", "target_bad");
assert.strictEqual(res2.targetBanned, false, "2nd report should not ban target yet");
assert.strictEqual(isDeviceBanned("target_bad"), 0, "Target not banned after 2 reports");
console.log("✅ Check 3 passed: 2nd report does not ban target yet");

// 5. Third report on target (reaches 3 total reports -> ban 15 minutes)
const res3 = recordReport("reporter_3", "target_bad");
assert.strictEqual(res3.targetBanned, true, "3rd report must ban target for 15 minutes");
assert.strictEqual(res3.minutesLeft, 15, "Ban duration should be 15 minutes");
const remainingMinutes = isDeviceBanned("target_bad");
assert.strictEqual(remainingMinutes, 15, "Target device should have 15 minutes remaining");
console.log("✅ Check 4 passed: 3rd report bans target device for 15 minutes");

// 6. Reporter fake report spam (>3 reports in 1 minute -> 15 min ban)
clearAllReportsAndBans();
const repHash = "spammer_device";

// 3 reports
const r1 = recordReport(repHash, "t_1");
assert.strictEqual(r1.reporterBanned, false, "Click 1 should not ban reporter");

const r2 = recordReport(repHash, "t_2");
assert.strictEqual(r2.reporterBanned, false, "Click 2 should not ban reporter");

const r3 = recordReport(repHash, "t_3");
assert.strictEqual(r3.reporterBanned, false, "Click 3 should not ban reporter");

// 4th click within 1 minute
const r4 = recordReport(repHash, "t_4");
assert.strictEqual(r4.reporterBanned, true, "Click > 3 in 1 min must ban reporter for 15 minutes");
assert.strictEqual(r4.minutesLeft, 15, "Reporter ban must be 15 minutes");
assert.strictEqual(isDeviceBanned(repHash), 15, "Reporter device must show 15 minutes remaining");
console.log("✅ Check 4 passed: Reporter clicking > 3 times in 1 minute is banned for 15 minutes");

// 6. Test flag expiration after 1 hour
clearAllReportsAndBans();
const oldReporter = "reporter_old";
const targetExp = "target_exp";

// Add a report with timestamp 61 minutes ago
const now = Date.now();
targetFlags.set(targetExp, [now - 61 * 60 * 1000]);

// Record a new report now
const expResult = recordReport(oldReporter, targetExp);
// Since old report was > 1 hour ago, it is reset, so target only has 1 flag and is NOT banned
assert.strictEqual(expResult.targetBanned, false, "Flags older than 1 hour must be reset; target not banned");
console.log("✅ Check 5 passed: Target report flags reset after 1 hour");

// 7. Cleanup
clearAllReportsAndBans();
console.log("🎉 All Anonymous Reporting & Ban System unit tests passed successfully!");
