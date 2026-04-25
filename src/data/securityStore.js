// Security event storage - IN-MEMORY (for ephemeral file systems like Render free tier)
const events = [];
const MAX_EVENTS = 2000;

function addSecurityEvent(event) {
  const newEvent = {
    id: "sec_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
    ...event,
    createdAt: Date.now(),
  };
  events.push(newEvent);
  
  // Keep only last 2000 events
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
  
  return newEvent;
}

function getSecurityEvents(limit = 100) {
  return events.slice(-limit);
}

function getUserSecurityEvents(userId, limit = 50) {
  return events.filter(e => e.userId === userId).slice(-limit);
}

function isUserFlagged(userId) {
  const recentEvents = events.filter(e => 
    e.userId === userId && 
    Date.now() - e.createdAt < 3600000 // Last hour
  );
  return recentEvents.length >= 5;
}

function clearUserFlags(userId) {
  // Not implemented for in-memory - would need to rebuild
}

module.exports = {
  addSecurityEvent,
  getSecurityEvents,
  getUserSecurityEvents,
  isUserFlagged,
  clearUserFlags,
};

function addSecurityLog(type, details) {
  return addSecurityEvent({
    type,
    ...details,
    severity: details.severity || "info",
  });
}

module.exports = {
  addSecurityEvent,
  addSecurityLog,
  getSecurityEvents,
  getUserSecurityEvents,
  isUserFlagged,
  clearUserFlags,
};