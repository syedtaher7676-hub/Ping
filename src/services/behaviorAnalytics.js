// ═══════════════════════════════════════════════════════════════
// BEHAVIORAL INTELLIGENCE & VIOLATION ANALYTICS SERVICE
// ═══════════════════════════════════════════════════════════════
// Tracks how users are messaging, conversational health, slur usage,
// contact exchange attempts (asking numbers, sharing numbers, social IDs),
// repeat offenders, message length, and provides rich time-series and categorical intelligence.

const crypto = require('crypto');

// Global Counters
let totalMessagesProcessed = 0;
let totalMessagesDelivered = 0;
let totalMessagesBlocked = 0;
let totalDeliveredChars = 0;

// Specific Violation Counters
let phoneNumbersSharedCount = 0;
let phoneNumbersAskedCount = 0;
let socialHandlesCount = 0;
let slursInterceptedCount = 0;
let threatsInterceptedCount = 0;
let linksBlockedCount = 0;
let symbolsBlockedCount = 0;

// Categorized Slur Distribution
const slurCategories = {
  racialAndEthnic: 0,
  predatoryAndGrooming: 0,
  homophobicTransphobic: 0,
  misogynisticAbuse: 0,
  cyberbullyingAndSelfHarm: 0,
  regionalHinglish: 0,
  otherProfanity: 0,
};

// Contact Extraction Breakdown
const contactExtractionStats = {
  numbersShared: 0,
  numbersAsked: 0,
  instagramHandles: 0,
  snapchatHandles: 0,
  telegramDiscord: 0,
};

// Session Duration & Engagement Tracking
let completedSessionsCount = 0;
let totalDurationSecondsSum = 0;
const sessionDurationBuckets = {
  quickSkips: 0, // < 15s
  shortChats: 0, // 15s - 60s
  mediumChats: 0, // 1m - 3m
  deepConversations: 0, // > 3m
};

const messagesPerChatBuckets = {
  oneToFive: 0,
  sixToTwenty: 0,
  twentyOneToFifty: 0,
  fiftyPlus: 0,
};

// Conversational Vibe & Tone Distribution
const conversationVibes = {
  friendlyGreetings: 0,
  curiousQuestions: 0,
  casualChat: 0,
  playfulHumor: 0,
  hostileAbuse: 0,
};

// Real-Time Interception Wire Log (Sliding window of last 150 events)
const MAX_WIRE_EVENTS = 150;
const interceptionWire = [];

// Top Flagged Patterns & Trigger Words Frequency Leaderboard
const triggerFrequencyMap = new Map();

// Repeat Policy & Slur Offenders Map
const repeatOffendersMap = new Map();

// Live Real-Time User Actions Stream (User activity feed across the fleet)
const MAX_LIVE_ACTIONS = 120;
const liveUserActions = [];

function recordUserAction({ type, userId, country = 'Global', detail = '', icon = '⚡' }) {
  const item = {
    id: 'act_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
    timestamp: Date.now(),
    type,
    userId: userId || 'Anonymous',
    country,
    detail: String(detail).slice(0, 100),
    icon,
  };
  liveUserActions.unshift(item);
  if (liveUserActions.length > MAX_LIVE_ACTIONS) {
    liveUserActions.pop();
  }
  if (typeof global.broadcastUserAction === 'function') {
    global.broadcastUserAction(item);
  }
  return item;
}

// Minute-by-Minute Rolling Time Series (up to 30 1-minute window snapshots)
const minuteBuckets = [];

function getOrCreateCurrentBucket() {
  const now = Date.now();
  const minuteKey = Math.floor(now / 60000) * 60000;
  let bucket = minuteBuckets[minuteBuckets.length - 1];
  if (!bucket || bucket.timestamp !== minuteKey) {
    bucket = {
      timestamp: minuteKey,
      timeLabel: new Date(minuteKey).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      cleanMsgs: 0,
      slurs: 0,
      askedNumbers: 0,
      sharedNumbers: 0,
      socials: 0,
      otherBlocked: 0,
    };
    minuteBuckets.push(bucket);
    if (minuteBuckets.length > 30) {
      minuteBuckets.shift();
    }
  }
  return bucket;
}

// Initial sliding buffer windows initialized cleanly without Math.random()
const seedNow = Date.now();
for (let i = 15; i >= 0; i--) {
  const t = Math.floor((seedNow - i * 60000) / 60000) * 60000;
  minuteBuckets.push({
    timestamp: t,
    timeLabel: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    cleanMsgs: 0,
    slurs: 0,
    askedNumbers: 0,
    sharedNumbers: 0,
    socials: 0,
    otherBlocked: 0,
  });
}

// Helper to categorize slurs automatically
function classifySlurWord(word = '') {
  const w = String(word).toLowerCase().trim();
  if (['nigger', 'nigga', 'negro', 'chink', 'gook', 'spic', 'kike', 'coon', 'paki', 'raghead', 'cracker'].some(t => w.includes(t))) {
    return 'racialAndEthnic';
  }
  if (['diddy', 'dixxy', 'diddi', 'diddler', 'epstein', 'chomo', 'groomer', 'pedophile', 'pedo', 'jailbait'].some(t => w.includes(t))) {
    return 'predatoryAndGrooming';
  }
  if (['faggot', 'fag', 'dyke', 'homo', 'tranny', 'shemale'].some(t => w.includes(t))) {
    return 'homophobicTransphobic';
  }
  if (['slut', 'whore', 'bitch', 'cunt', 'twat'].some(t => w.includes(t))) {
    return 'misogynisticAbuse';
  }
  if (['kys', 'kill yourself', 'go die', 'commit suicide', 'drink bleach', 'slit your'].some(t => w.includes(t))) {
    return 'cyberbullyingAndSelfHarm';
  }
  if (['bhenchod', 'behenchod', 'madarchod', 'chutiya', 'gandu', 'bhosadike', 'randi', 'harami', 'sule', 'thika', 'lanja'].some(t => w.includes(t))) {
    return 'regionalHinglish';
  }
  return 'otherProfanity';
}

function recordTriggerFrequency(trigger, category) {
  if (!trigger) return;
  const key = String(trigger).toLowerCase().trim().slice(0, 40);
  const existing = triggerFrequencyMap.get(key) || { trigger: key, count: 0, category: category || 'general', lastSeen: Date.now() };
  existing.count++;
  existing.lastSeen = Date.now();
  triggerFrequencyMap.set(key, existing);

  // Keep top 120 triggers
  if (triggerFrequencyMap.size > 140) {
    const sorted = Array.from(triggerFrequencyMap.entries()).sort((a, b) => b[1].count - a[1].count);
    triggerFrequencyMap.clear();
    for (let i = 0; i < 100 && i < sorted.length; i++) {
      triggerFrequencyMap.set(sorted[i][0], sorted[i][1]);
    }
  }
}

// Track Repeat Offenders
function recordOffenderViolation(userId, type, country, deviceHash, snippet) {
  const effectiveId = (userId && userId !== 'Anonymous') ? userId : (deviceHash && deviceHash !== 'None' ? deviceHash : null);
  if (!effectiveId) return;

  const existing = repeatOffendersMap.get(effectiveId) || {
    userId: effectiveId,
    country: country || 'Global',
    deviceHash: deviceHash || 'None',
    violationCount: 0,
    slursCount: 0,
    askedNumbersCount: 0,
    sharedNumbersCount: 0,
    socialsCount: 0,
    otherCount: 0,
    lastViolationTime: Date.now(),
    lastSnippet: '',
    lastType: type,
  };

  existing.violationCount++;
  existing.lastViolationTime = Date.now();
  existing.lastSnippet = (snippet || '').slice(0, 50);
  existing.lastType = type;
  if (country && country !== 'Global') existing.country = country;
  if (deviceHash && deviceHash !== 'None') existing.deviceHash = deviceHash;

  if (type === 'slur_detected') existing.slursCount++;
  else if (type === 'phone_asked') existing.askedNumbersCount++;
  else if (type === 'phone_shared') existing.sharedNumbersCount++;
  else if (type === 'social_handle') existing.socialsCount++;
  else existing.otherCount++;

  repeatOffendersMap.set(effectiveId, existing);

  // Bounds limit to prevent unbounded memory growth
  if (repeatOffendersMap.size > 500) {
    const oldestKey = repeatOffendersMap.keys().next().value;
    repeatOffendersMap.delete(oldestKey);
  }

  // Trigger quick debounced telemetry sync so offender data survives container sleep
  if (typeof global.triggerImmediateTelemetryFlush === 'function') {
    global.triggerImmediateTelemetryFlush();
  }
}

// Public API Functions

function recordMessageDelivered(text = '') {
  totalMessagesProcessed++;
  totalMessagesDelivered++;

  const str = String(text || '').trim();
  totalDeliveredChars += str.length;

  // Classify Vibe
  const lower = str.toLowerCase();
  if (/^(hi|hey|hello|yo|sup|hlo|heyy|namaste|hola)\b/i.test(lower)) {
    conversationVibes.friendlyGreetings++;
    if (typeof global.recordTelemetrySentiment === 'function') global.recordTelemetrySentiment('friendly_greetings');
  } else if (/\?|^(what|where|how|who|why|which|are you|do you)\b/i.test(lower)) {
    conversationVibes.curiousQuestions++;
    if (typeof global.recordTelemetrySentiment === 'function') global.recordTelemetrySentiment('curious_questions');
  } else if (/haha|hehe|lol|lmao|rofl|😂|🤣|xd|😆/i.test(lower)) {
    conversationVibes.playfulHumor++;
    if (typeof global.recordTelemetrySentiment === 'function') global.recordTelemetrySentiment('playful_humor');
  } else {
    conversationVibes.casualChat++;
    if (typeof global.recordTelemetrySentiment === 'function') global.recordTelemetrySentiment('casual_dialogue');
  }

  // Record to current time-series minute bucket
  const bucket = getOrCreateCurrentBucket();
  bucket.cleanMsgs++;
}

function recordViolationEvent({
  type, // 'phone_shared', 'phone_asked', 'slur_detected', 'social_handle', 'threat_detected', 'link_blocked', 'symbols_blocked'
  userId,
  deviceHash,
  country = 'Global',
  snippet = '',
  action = 'Blocked',
  severity = 'warning',
  matchedWords = [],
  category = null,
}) {
  totalMessagesProcessed++;
  totalMessagesBlocked++;
  conversationVibes.hostileAbuse++;
  if (typeof global.recordTelemetrySentiment === 'function') global.recordTelemetrySentiment('toxic_messages');

  const id = 'evt_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  let categoryName = 'Community Safety';
  const bucket = getOrCreateCurrentBucket();

  // Normalize incoming category / type / reason strings to standardized internal keys
  const rawType = String(type || '').toLowerCase().trim();
  const rawCategory = String(category || '').toLowerCase().trim();
  const combined = `${rawType} ${rawCategory}`;

  let normalizedType = 'other';

  const snipLower = snippet.toLowerCase();
  const isAskingPhrase =
    snipLower.includes('give me') ||
    snipLower.includes('what is ur') ||
    snipLower.includes('what is your') ||
    snipLower.includes('whats ur') ||
    snipLower.includes('whats your') ||
    snipLower.includes('send ur') ||
    snipLower.includes('send your') ||
    snipLower.includes('tell me') ||
    snipLower.includes('can i get') ||
    snipLower.includes('can i have') ||
    snipLower.includes('number pls') ||
    snipLower.includes('num pls') ||
    snipLower.includes('phone num');

  if (
    combined.includes('asking') ||
    combined.includes('asked') ||
    combined.includes('phone_asking') ||
    combined.includes('solicitation') ||
    (combined.includes('phone') && isAskingPhrase)
  ) {
    normalizedType = 'phone_asked';
  } else if (
    combined.includes('privacy_phone_sharing') ||
    combined.includes('phone_number_sharing') ||
    combined.includes('phone_number_detected') ||
    combined.includes('phone_shared') ||
    combined.includes('digits') ||
    combined.includes('phone')
  ) {
    normalizedType = 'phone_shared';
  } else if (
    combined.includes('social') ||
    combined.includes('insta') ||
    combined.includes('snap') ||
    combined.includes('discord') ||
    combined.includes('telegram')
  ) {
    normalizedType = 'social_handle';
  } else if (
    combined.includes('slur') ||
    combined.includes('hate') ||
    combined.includes('profanity') ||
    combined.includes('vulgarity') ||
    combined.includes('bad_word') ||
    combined.includes('learned_violation')
  ) {
    normalizedType = 'slur_detected';
  } else if (
    combined.includes('threat') ||
    combined.includes('coercion') ||
    combined.includes('grooming') ||
    combined.includes('blackmail') ||
    combined.includes('harassment') ||
    combined.includes('cyberbullying') ||
    combined.includes('dox') ||
    combined.includes('stalking')
  ) {
    normalizedType = 'threat_detected';
  } else if (
    combined.includes('link') ||
    combined.includes('url')
  ) {
    normalizedType = 'link_blocked';
  } else if (
    combined.includes('symbol') ||
    combined.includes('punctuation')
  ) {
    normalizedType = 'symbols_blocked';
  }

  switch (normalizedType) {
    case 'phone_shared':
      phoneNumbersSharedCount++;
      contactExtractionStats.numbersShared++;
      categoryName = 'Phone Number Sharing';
      bucket.sharedNumbers++;
      recordTriggerFrequency('phone_number_digits', 'Contact Extraction');
      break;

    case 'phone_asked':
      phoneNumbersAskedCount++;
      contactExtractionStats.numbersAsked++;
      categoryName = 'Asking For Numbers / WhatsApp';
      bucket.askedNumbers++;
      recordTriggerFrequency('asked_for_phone_number', 'Contact Extraction');
      break;

    case 'social_handle':
      socialHandlesCount++;
      categoryName = 'Social Media Handle (IG/Snap)';
      bucket.socials++;
      if (snippet.toLowerCase().includes('insta') || snippet.toLowerCase().includes('ig')) {
        contactExtractionStats.instagramHandles++;
        recordTriggerFrequency('instagram_handle_request', 'Social Handles');
      } else if (snippet.toLowerCase().includes('snap') || snippet.toLowerCase().includes('sc')) {
        contactExtractionStats.snapchatHandles++;
        recordTriggerFrequency('snapchat_handle_request', 'Social Handles');
      } else {
        contactExtractionStats.telegramDiscord++;
        recordTriggerFrequency('messaging_handle_request', 'Social Handles');
      }
      break;

    case 'slur_detected':
      slursInterceptedCount++;
      categoryName = 'Slur / Abusive Speech';
      bucket.slurs++;
      const words = Array.isArray(matchedWords) && matchedWords.length > 0 ? matchedWords : [snippet.slice(0, 20)];
      for (const w of words) {
        const cat = classifySlurWord(w);
        if (typeof slurCategories[cat] !== 'undefined') {
          slurCategories[cat]++;
        } else {
          slurCategories.otherProfanity++;
        }
        recordTriggerFrequency(w, 'Slur Filter');
      }
      break;

    case 'threat_detected':
      threatsInterceptedCount++;
      categoryName = category ? `Threat / ${category}` : 'Threat / Harassment';
      bucket.otherBlocked++;
      recordTriggerFrequency(category || 'threat_pattern', 'Safety Threat');
      break;

    case 'link_blocked':
      linksBlockedCount++;
      categoryName = 'External Link / Invite URL';
      bucket.otherBlocked++;
      recordTriggerFrequency('external_url_link', 'Link Shield');
      break;

    case 'symbols_blocked':
      symbolsBlockedCount++;
      categoryName = 'Excessive Symbols / Punctuation';
      bucket.otherBlocked++;
      break;

    default:
      categoryName = 'Policy Enforcement';
      bucket.otherBlocked++;
      break;
  }

  // Record offender profile
  recordOffenderViolation(userId, normalizedType, country, deviceHash, snippet);

  // Safe sanitized snippet preview (never display full unmasked toxic text in raw logs)
  let safeSnippet = snippet || '';
  if (type === 'phone_shared') {
    safeSnippet = safeSnippet.replace(/\d{4,}/g, '****');
  } else if (type === 'slur_detected') {
    safeSnippet = matchedWords.length > 0 ? `Flagged: [${matchedWords.join(', ')}]` : `Pattern: ${safeSnippet.slice(0, 25)}...`;
  } else {
    safeSnippet = safeSnippet.slice(0, 60);
  }

  const wireItem = {
    id,
    timestamp: Date.now(),
    type,
    categoryName,
    userId: userId || 'Anonymous',
    deviceHash: deviceHash || 'None',
    country: country || 'Unknown',
    snippet: safeSnippet,
    action,
    severity,
  };

  interceptionWire.unshift(wireItem);
  if (interceptionWire.length > MAX_WIRE_EVENTS) {
    interceptionWire.pop();
  }

  return wireItem;
}

function recordSessionCompleted(durationSeconds = 0, messageCount = 0, reason = 'session_ended') {
  completedSessionsCount++;
  totalDurationSecondsSum += durationSeconds;
  if (typeof global.recordTelemetrySession === 'function') {
    global.recordTelemetrySession(durationSeconds);
  }

  // Duration Buckets
  if (durationSeconds < 15) {
    sessionDurationBuckets.quickSkips++;
  } else if (durationSeconds <= 60) {
    sessionDurationBuckets.shortChats++;
  } else if (durationSeconds <= 180) {
    sessionDurationBuckets.mediumChats++;
  } else {
    sessionDurationBuckets.deepConversations++;
  }

  // Messages per chat buckets
  if (messageCount <= 5) {
    messagesPerChatBuckets.oneToFive++;
  } else if (messageCount <= 20) {
    messagesPerChatBuckets.sixToTwenty++;
  } else if (messageCount <= 50) {
    messagesPerChatBuckets.twentyOneToFifty++;
  } else {
    messagesPerChatBuckets.fiftyPlus++;
  }
}



function hydrateBehaviorFromFirestore(saved = {}) {
  if (!saved || typeof saved !== 'object') return;
  if (saved.overview) {
    const o = saved.overview;
    if (typeof o.totalMessagesProcessed === 'number') totalMessagesProcessed = o.totalMessagesProcessed;
    if (typeof o.totalMessagesDelivered === 'number') totalMessagesDelivered = o.totalMessagesDelivered;
    if (typeof o.totalMessagesBlocked === 'number') totalMessagesBlocked = o.totalMessagesBlocked;
    if (typeof o.totalDeliveredChars === 'number') {
      totalDeliveredChars = o.totalDeliveredChars;
    } else if (typeof o.avgMsgLengthChars === 'number' && totalMessagesDelivered > 0) {
      totalDeliveredChars = o.avgMsgLengthChars * totalMessagesDelivered;
    }
    if (typeof o.phoneNumbersSharedCount === 'number') phoneNumbersSharedCount = o.phoneNumbersSharedCount;
    else if (typeof o.sharedNumbers === 'number') phoneNumbersSharedCount = o.sharedNumbers;
    if (typeof o.phoneNumbersAskedCount === 'number') phoneNumbersAskedCount = o.phoneNumbersAskedCount;
    else if (typeof o.askedNumbers === 'number') phoneNumbersAskedCount = o.askedNumbers;
    if (typeof o.socialHandlesCount === 'number') socialHandlesCount = o.socialHandlesCount;
    else if (typeof o.socialHandles === 'number') socialHandlesCount = o.socialHandles;
    if (typeof o.slursInterceptedCount === 'number') slursInterceptedCount = o.slursInterceptedCount;
    else if (typeof o.slursBlocked === 'number') slursInterceptedCount = o.slursBlocked;
    if (typeof o.threatsInterceptedCount === 'number') threatsInterceptedCount = o.threatsInterceptedCount;
    if (typeof o.linksBlockedCount === 'number') linksBlockedCount = o.linksBlockedCount;
    if (typeof o.symbolsBlockedCount === 'number') symbolsBlockedCount = o.symbolsBlockedCount;
    if (typeof o.completedSessionsCount === 'number') completedSessionsCount = o.completedSessionsCount;
    if (typeof o.totalDurationSecondsSum === 'number') {
      totalDurationSecondsSum = o.totalDurationSecondsSum;
    } else if (typeof o.avgChatDurationSeconds === 'number' && completedSessionsCount > 0) {
      totalDurationSecondsSum = o.avgChatDurationSeconds * completedSessionsCount;
    } else if (typeof o.avgDurationSec === 'number' && completedSessionsCount > 0) {
      totalDurationSecondsSum = o.avgDurationSec * completedSessionsCount;
    }
  }
  if (saved.slurDistribution && typeof saved.slurDistribution === 'object') {
    Object.assign(slurCategories, saved.slurDistribution);
  }
  if (saved.contactExtraction && typeof saved.contactExtraction === 'object') {
    Object.assign(contactExtractionStats, saved.contactExtraction);
  }
  if (saved.engagement && typeof saved.engagement === 'object') {
    if (saved.engagement.durationBuckets) Object.assign(sessionDurationBuckets, saved.engagement.durationBuckets);
    if (saved.engagement.messagesPerChatBuckets) Object.assign(messagesPerChatBuckets, saved.engagement.messagesPerChatBuckets);
    if (saved.engagement.vibes) Object.assign(conversationVibes, saved.engagement.vibes);
  }
  if (Array.isArray(saved.timeSeries) && saved.timeSeries.length > 0) {
    minuteBuckets.length = 0;
    minuteBuckets.push(...saved.timeSeries);
  }
  // Restore repeat policy and slur offenders map across container restarts and cold boot sleep
  if (Array.isArray(saved.repeatOffenders) && saved.repeatOffenders.length > 0) {
    repeatOffendersMap.clear();
    for (const item of saved.repeatOffenders) {
      if (Array.isArray(item) && item[0] && item[1]) {
        repeatOffendersMap.set(item[0], item[1]);
      } else if (item && (item.userId || item.deviceHash)) {
        repeatOffendersMap.set(item.userId || item.deviceHash, item);
      }
    }
  } else if (Array.isArray(saved.topOffenders) && saved.topOffenders.length > 0) {
    repeatOffendersMap.clear();
    for (const off of saved.topOffenders) {
      if (off && (off.userId || off.deviceHash)) {
        repeatOffendersMap.set(off.userId || off.deviceHash, off);
      }
    }
  }
}

function getBehaviorAnalyticsForPersistence() {
  const snap = getBehaviorAnalyticsSnapshot();
  return {
    overview: snap.overview,
    slurDistribution: snap.slurDistribution,
    contactExtraction: snap.contactExtraction,
    engagement: snap.engagement,
    timeSeries: minuteBuckets.slice(-30),
    topOffenders: snap.topOffenders || [],
    repeatOffenders: Array.from(repeatOffendersMap.values()).slice(0, 100),
  };
}

function getBehaviorAnalyticsSnapshot() {
  const cleanPassRate = totalMessagesProcessed > 0
    ? Number(((totalMessagesDelivered / totalMessagesProcessed) * 100).toFixed(1))
    : 100;

  const avgChatDurationSeconds = completedSessionsCount > 0
    ? Math.round(totalDurationSecondsSum / completedSessionsCount)
    : 0;

  const avgMsgLengthChars = totalMessagesDelivered > 0
    ? Math.round(totalDeliveredChars / totalMessagesDelivered)
    : 0;

  // Top 20 trigger leaderboard
  const topTriggers = Array.from(triggerFrequencyMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Top 15 Repeat Offenders
  const topOffenders = Array.from(repeatOffendersMap.values())
    .sort((a, b) => b.violationCount - a.violationCount)
    .slice(0, 15);

  const totalContactAttempts = phoneNumbersSharedCount + phoneNumbersAskedCount + socialHandlesCount;
  const offPlatformAttemptRate = totalMessagesProcessed > 0
    ? Number(((totalContactAttempts / totalMessagesProcessed) * 100).toFixed(1))
    : 0;

  return {
    overview: {
      totalMessagesProcessed,
      totalMessagesDelivered,
      totalMessagesBlocked,
      totalDeliveredChars,
      totalDurationSecondsSum,
      cleanPassRate,
      cleanRatePct: cleanPassRate,
      avgMsgLengthChars,
      avgMsgLength: avgMsgLengthChars,
      offPlatformAttemptRate,
      offPlatformRatePct: offPlatformAttemptRate,
      phoneNumbersSharedCount,
      sharedNumbers: phoneNumbersSharedCount,
      phoneNumbersAskedCount,
      askedNumbers: phoneNumbersAskedCount,
      socialHandlesCount,
      socialHandles: socialHandlesCount,
      slursInterceptedCount,
      slursBlocked: slursInterceptedCount,
      threatsInterceptedCount,
      linksBlockedCount,
      symbolsBlockedCount,
      completedSessionsCount,
      avgChatDurationSeconds,
      avgDurationSec: avgChatDurationSeconds,
    },
    slurDistribution: { ...slurCategories },
    contactExtraction: {
      ...contactExtractionStats,
      totalContactAttempts,
    },
    engagement: {
      durationBuckets: { ...sessionDurationBuckets },
      messagesPerChatBuckets: { ...messagesPerChatBuckets },
      vibes: { ...conversationVibes },
    },
    timeSeries: minuteBuckets.slice(-20),
    topTriggers,
    topOffenders,
    recentInterceptions: interceptionWire.slice(0, 100),
    liveActions: liveUserActions.slice(0, 80),
  };
}

function resetBehaviorAnalytics() {
  totalMessagesProcessed = 0;
  totalMessagesDelivered = 0;
  totalMessagesBlocked = 0;
  totalDeliveredChars = 0;

  phoneNumbersSharedCount = 0;
  phoneNumbersAskedCount = 0;
  socialHandlesCount = 0;
  slursInterceptedCount = 0;
  threatsInterceptedCount = 0;
  linksBlockedCount = 0;
  symbolsBlockedCount = 0;

  for (const k of Object.keys(slurCategories)) slurCategories[k] = 0;
  for (const k of Object.keys(contactExtractionStats)) contactExtractionStats[k] = 0;

  completedSessionsCount = 0;
  totalDurationSecondsSum = 0;
  for (const k of Object.keys(sessionDurationBuckets)) sessionDurationBuckets[k] = 0;
  for (const k of Object.keys(messagesPerChatBuckets)) messagesPerChatBuckets[k] = 0;
  for (const k of Object.keys(conversationVibes)) conversationVibes[k] = 0;

  interceptionWire.length = 0;
  triggerFrequencyMap.clear();
  repeatOffendersMap.clear();
  liveUserActions.length = 0;

  minuteBuckets.length = 0;
  const now = Date.now();
  for (let i = 15; i >= 0; i--) {
    const t = Math.floor((now - i * 60000) / 60000) * 60000;
    minuteBuckets.push({
      timestamp: t,
      timeLabel: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      cleanMsgs: 0,
      slurs: 0,
      askedNumbers: 0,
      sharedNumbers: 0,
      socials: 0,
      otherBlocked: 0,
    });
  }

  return getBehaviorAnalyticsSnapshot();
}

module.exports = {
  recordMessageDelivered,
  recordViolationEvent,
  recordSessionCompleted,
  recordUserAction,
  getBehaviorAnalyticsSnapshot,
  getBehaviorAnalyticsForPersistence,
  hydrateBehaviorFromFirestore,
  resetBehaviorAnalytics,
  classifySlurWord,
};
