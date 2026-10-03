// Security event storage - IN-MEMORY with Disk Persistence
const fs = require('fs');
const path = require('path');
const { recordChatSampleForTraining } = require('../services/modelTrainer');

const SECURITY_FILE = path.join(__dirname, '../../data/security.json');

const events = [];
const MAX_EVENTS = 2000;

try {
  if (fs.existsSync(SECURITY_FILE)) {
    const raw = fs.readFileSync(SECURITY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      events.push(...parsed.slice(-MAX_EVENTS));
    }
  }
} catch (_) {}

function saveSecurityEventsToFile() {
  try {
    fs.writeFileSync(SECURITY_FILE, JSON.stringify(events, null, 2), 'utf8');
  } catch (_) {}
}

function addSecurityEvent(event) {
  const newEvent = {
    id: "sec_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
    ...event,
    createdAt: Date.now(),
  };
  events.push(newEvent);
  
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }

  saveSecurityEventsToFile();

  const msg = event.message || event.originalMessage;
  if (msg && typeof msg === 'string' && event.severity !== 'safe') {
    recordChatSampleForTraining(msg, 1, event.type || 'security_event', {
      userId: event.userId,
      severity: event.severity
    });
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
  // Clear flags for specific user if needed
}

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
