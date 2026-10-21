// Spam violation storage - IN-MEMORY (for ephemeral file systems like Render free tier)
const violations = [];
const MAX_VIOLATIONS = 1000;

function addSpamViolation(violation) {
  const newViolation = {
    id: "spm_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
    ...violation,
    createdAt: Date.now(),
  };
  violations.push(newViolation);
  
  // Keep only last 1000 violations
  if (violations.length > MAX_VIOLATIONS) {
    violations.splice(0, violations.length - MAX_VIOLATIONS);
  }
  
  return newViolation;
}

function getUserViolations(userId) {
  return violations.filter(v => v.userId === userId);
}

function getViolationCount(userId) {
  return violations.filter(v => v.userId === userId).length;
}

function shouldRateLimitUser(userId) {
  // Rate limit if user has 5+ violations in last hour
  const oneHourAgo = Date.now() - 3600000;
  const recentViolations = violations.filter(v => v.userId === userId && v.createdAt > oneHourAgo);
  return recentViolations.length >= 5;
}

module.exports = {
  addSpamViolation,
  getUserViolations,
  getViolationCount,
  shouldRateLimitUser,
};