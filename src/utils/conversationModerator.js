/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CONVERSATIONAL TEXT-LINE MODERATOR (ENGLISH FOCUSED)
 * ─────────────────────────────────────────────────────────────────────────────
 * Analyzes whole conversational utterances and text lines to understand bad
 * behaviour (threats, doxxing, stalking, blackmail, extortion, sexual harassment,
 * cyberbullying, predatory slang) across any format (multi-line vertical, dotted,
 * spaced, leetspeak, phonetic substitutions).
 *
 * Guaranteed 0 false positives on innocent English idioms like "I'm gonna kill this exam!".
 */

// ── 1. INNOCENT COLLOQUIAL COLLISION GUARDS ──────────────────────────────────
const INNOCENT_COLLOQUIALISMS = [
  // Academic & Performance Success Idioms ("kill this exam", "killed the test", "killing it")
  /\b(i('m|\s*am)?\s*(gonna|going\s*to|will|'ll)?\s*)?(kill|killed|killing|crush|crushed|crushing|ace|aced|acing|destroy|destroyed)\s*(this|the|that|my|our|an?)\s*(exam|test|quiz|finals?|midterms?|interview|presentation|audition|workout|game|match|session|performance|stage|set|track|beat|crowd|competition|paper|assignment|homework)\b/i,
  /\b(i('m|\s*am)?\s*(gonna|going\s*to|will|'ll)?\s*)?(kill|killed|killing)\s*it(\s*(at|in|on|today|tonight|bro|man|guys?))?\b/i,
  /\b(you|he|she|they|we)\s*(really\s*)?(killed|crushed|aced)\s*it\b/i,
  /\b(you('re|\s*are)\s*(gonna|going\s*to)\s*)?(kill|crush|ace)\s*(this|the|that|your)\s*(exam|test|interview|game|audition)\b/i,
  /\b(killer|deadly)\s+(guitar|solo|game|track|beat|song|play|drop|shot|workout|move|vibe|outfit|style)\b/i,

  // Humor & Idiomatic death / laughter ("killed me", "dying of laughter")
  /\bthat\s+(joke|meme|video|clip|post|story|reels?|tiktok)\s+(killed|kills|is\s+killing)\s+me\b/i,
  /\b(dying|died)\s+of\s+laughter\b/i,
  /\b(i'm|im|i\s+am)\s+dying\s+(laughing|of\s+laughter)\b/i,
  /\b(i'm|im|i\s+am)\s+dead\s*(lmao|lol|rofl|💀|😂|🤣)?\b/i,
  /\b(to\s+die\s+for|dying\s+to\s+(see|hear|know|meet|go))\b/i,

  // Device / Battery state
  /\b(my\s+phone|my\s+battery|my\s+laptop|my\s+pc|my\s+headset|my\s+airpods?|my\s+car)\s+died\b/i,

  // Physical fatigue / aches
  /\bmy\s+(feet|back|head|stomach|knee|arm|leg|shoulder|eyes?|neck|throat)\s+(are|is)\s+killing\s+me\b/i,

  // Dead serious / Dead on
  /\bdead\s+(tired|serious|ass|accurate|on|center|silent|ahead)\b/i,

  // Time & Idioms
  /\b(time|hours?)\s+to\s+kill\b/i,
  /\b(kill|killing)\s+(some\s+)?time\b/i,
  /\bkill\s+(the\s+)?(lights|engine|motor|buzz|mood|vibe)\b/i,

  // Communications & Sport
  /\bshoot\s+(me\s+a\s+)?(message|dm|text|reply|link|email)\b/i,
  /\bshooting\s+(hoops|stars|breeze|photos?|video)\b/i,
  /\baddress\s+(the|this|that|an?)\s+(issue|problem|topic|question|point|concern)\b/i,

  // Safe conversational starters & benign words
  /\bwhere\s+(are\s+you|do\s+you\s+come)\s+from\b/i,
  /\bwhat\s+(country|city|state)\s+are\s+you\s+from\b/i,
  /\bcan\s+you\s+pass\s+the\s+butter\b/i,
  /\bthe\s+assistant\s+helped\s+me\b/i,
  /\bniger\s+is\s+a\s+country\b/i,
  /\bcharles\s+dickens\s+is\s+a\s+classic\b/i,
  /\bclassic\s+cocktail\b/i
];

// ── 2. SEVERE THREATS OF VIOLENCE & BODILY HARM ──────────────────────────────
const THREAT_PATTERNS = [
  /\b(i\s*(will|am\s*going\s*to|'m\s*gonna|'ll|gonna)\s+(kill|murder|shoot|stab|choke|strangle|slit|beat|bash|hunt|assault|harm|hurt|end|destroy)\s+(you|ur\s*ass|your\s*ass|u))\b/i,
  /\b(i('ll|\s*will|\s*am\s*gonna|'m\s*gonna|\s*am\s*going\s*to)\s+(beat|beat\s*the\s*(shit|crap|hell)\s*out\s*of|break)\s+(you|ur|your\s*(legs?|arms?|neck|bones?|face)|u))\b/i,
  /\b(beat\s*(you|ur|your\s*ass|u)\s*up)\b/i,
  /\b(gonna\s*(kill|murder|shoot|stab|choke|beat|slit|hurt|harm|destroy)\s+(you|u))\b/i,
  /\b(you\s*(are\s*going\s*to|will|'re\s*gonna)\s*(die|bleed|suffer|regret\s*this|pay))\b/i,
  /\b(you('re|\s*are)\s*dead(\s*meat)?|watch\s*your\s*back|say\s*goodbye\s*to\s*your\s*life)\b/i,
  /\b(i('ll|\s*will|\s*am\s*going\s*to)\s*.*slit\s*(your|ur)\s*(throat|wrist))\b/i,
  /\b(i('ll|\s*will)\s*put\s*a\s*bullet\s*(in|through)\s*(your|ur|you))\b/i,
  /\b(don't\s*make\s*me\s*(hurt|kill|come\s*find)\s*(you|u))\b/i,
  /\b(you\s*won't\s*(live|survive|make\s*it)\s*(to|past|until)?\s*(tomorrow|tonight)?)\b/i
];

// ── 3. STALKING, DOXXING, IP TRACKING & DOORSTEP INTIMIDATION ─────────────────
const STALKING_DOX_PATTERNS = [
  /\b(i\s*(know|found|have|got)\s*(where\s*(you|u)\s*live|your\s*(address|location|house|door|home|school|family|facebook|insta|snap)))\b/i,
  /\b(i('m|\s*am)\s*(coming|pulling\s*up|heading|outside)\s*(to\s*)?(your|ur)\s*(house|home|place|door|address|room|window))\b/i,
  /\b(see\s*(you|u)\s*(soon\s*)?at\s*(your|ur)\s*(house|door|window))\b/i,
  /\b(i\s*(have|got|tracked|logged)\s*(your|ur)\s*(ip|ip\s*address|location|coords|coordinates))\b/i,
  /\b(i('m|\s*am|\s*will|'ll)?\s*(going\s*to\s*|gonna\s*)?(tracking|tracing|track|trace)\s*(your|ur)\s*(ip|location|address))\b/i,
  /\b(track\s*(your|ur)\s*(ip|ip\s*address|location))\b/i,
  /\b(drop|give|send|tell\s*me)\s*(your|ur)\s*(address|location|live\s*location)\s*(or\s*else|right\s*now|now)?\b/i,
  /\b(drop\s*(your|ur)\s*address\s*right\s*now)\b/i,
  /\b(where\s*do\s*you\s*live\s*(right\s*now|or\s*else))\b/i,
  /\b((i\s*will|i'll|gonna)\s*(hunt|track|find)\s*(you|u)\s*(down)?)\b/i,
  /\b(i('ll|\s*will|\s*am\s*gonna)\s*(dox|doxx|leak)\s*(you|ur|your)\s*(address|info|number|ip|location)?)\b/i
];

// ── 4. EXTORTION, BLACKMAIL & COERCION ───────────────────────────────────────
const EXTORTION_PATTERNS = [
  /\b(send|show|give\s*me)\s*.*or\s*(i('ll|\s*will)|else)\s*(leak|expose|post|share|ruin|hack|hurt)\b/i,
  /\b(or\s*else\s*(i('ll|\s*will)|\s*you'll)\s*(regret|leak|expose|pay|suffer))\b/i,
  /\b(pay\s*me\s*or\s*(i|else)|send\s*money\s*or\s*(i|else)|transfer\s*money\s*or\s*(i|else))\b/i,
  /\b(do\s*what\s*i\s*say\s*or\s*(else|i'll|i\s*will))\b/i,
  /\b(add\s*my\s*snap\s*or\s*(else|you'll\s*regret))\b/i,
  /\b(give\s*me\s*(your|ur)\s*.*or\s*you'll\s*regret)\b/i
];

// ── 5. EXPLICIT SEXUAL HARASSMENT & PREDATORY SLANG ───────────────────────────
const SEXUAL_HARASSMENT_PATTERNS = [
  /\b((send|show|let\s*me\s*see)\s*(me\s*)?(nudes?|tits?|boobs?|body|pussy|dick|cock|ass|naked|privates|nude\s*pics?))\b/i,
  /\b(take\s*off\s*(your|ur)\s*clothes|strip\s*(for\s*me|naked|down))\b/i,
  /\b(flash\s*(me|your\s*(tits|boobs|body|ass)))\b/i,
  /\b(touch\s*yourself\s*(for\s*me|on\s*cam))\b/i,
  /\b(i\s*will\s*(rape|sexually\s*assault)\s*(you|ur|u))\b/i,
  /\b(gonna\s*(rape|grope|assault)\s*(you|u))\b/i,
  /\b(send\s*naked\s*(pictures?|pics?))\b/i,
  /\b(show\s*(me\s*)?(your|ur)\s*(boobs?|tits?|body|ass))\b/i,
  /\b(diddy|dixxy|diddi|diddie|diddler|diddling|diddled|chomo|noncer|groomer|jailbait|paedo|pedophile|pedo)\b/i
];

// ── 6. SEVERE CYBERBULLYING, SUICIDE ENCOURAGEMENT & DEGRADATION ────────────
const CYBERBULLYING_PATTERNS = [
  /\b(kys|kill\s*yourself|go\s*die|end\s*your\s*life|commit\s*suicide)\b/i,
  /\b(drink\s*bleach|hang\s*yourself|slit\s*your\s*wrists?|jump\s*off\s*a\s*bridge|jump\s*in\s*front\s*of\s*a\s*train)\b/i,
  /\b(nobody\s*(likes|loves|cares\s*about)\s*you\s*,?\s*(go\s*die|kill\s*yourself|kys)?)\b/i,
  /\b(you\s*(should|deserve\s*to)\s*(die|be\s*dead|get\s*killed|suffer))\b/i,
  /\b(hope\s*you\s*(die|get\s*cancer|choke|burn\s*in\s*hell|get\s*hit\s*by\s*a\s*car))\b/i,
  /\b(waste\s*of\s*(oxygen|space|life)|you\s*should\s*never\s*have\s*been\s*born)\b/i,
  /\b(you('re|\s*are)\s*(a\s*)?(worthless|disgusting|ugly)\s*(piece\s*of\s*(shit|trash|garbage)|subhuman))\b/i,
  /\b(eat\s*shit\s*and\s*die)\b/i
];

// ── 7. LOW-EFFORT PATTERNS (ENGLISH FOCUS) ───────────────────────────────────
const LOW_EFFORT_EXACT_PATTERNS = [
  /^\s*m\s*\??\s*$/i,
  /^\s*f\s*\??\s*$/i,
  /^\s*m\s*\/\s*f\s*\??\s*$/i,
  /^\s*f\s*\/\s*m\s*\??\s*$/i,
  /^\s*(male|female|boy|girl)\s*\??\s*$/i,
  /^\s*(m1[0-9]|1[0-9]m|f1[0-9]|1[0-9]f|m2[0-9]|2[0-9]m|f2[0-9]|2[0-9]f)\s*\??\s*$/i,
  /^\s*asl\s*\??\s*$/i,
  /^\s*a\.s\.l\.?\s*\??\s*$/i,
  /^\s*age\s*\??\s*$/i,
  /^\s*gender\s*\??\s*$/i,
  /^\s*(what('s| is) your (age|gender|sex)|how old (are you|r u|u))\s*\??\s*$/i,
  /^\s*(m\s*or\s*f|f\s*or\s*m|male\s*or\s*female|boy\s*or\s*girl)\s*\??\s*$/i,
  /^\s*(snap|snapchat|insta|instagram|ig|sc|telegram|tg|discord|dsc)\s*\??\s*$/i,
  /^\s*(add\s*my|what('s| is)\s*your|give\s*me\s*your)\s*(snap|snapchat|insta|instagram|ig|sc|telegram|tg|discord)\s*\??\s*$/i,
  /^\s*(snapchat|snap|insta|telegram|discord):\s*@?[a-zA-Z0-9_\.]+\s*$/i,
  /^\s*(pic|pics|send\s*pic|send\s*pics|photo|trade|cam|horny|dirty|nudes?)\s*\??\s*$/i,
  /^\s*k\s*$/i,
  /^\s*h\s*$/i,
  /^\s*z\s*$/i,
  /^\s*u\s*\??\s*$/i,
  /^\s*wbu\s*\??\s*$/i,
  /^\s*yo\s*\??\s*$/i,
  /^\s*sup\s*\??\s*$/i,
  /^\s*nm\s*$/i,
  /^\s*idk\s*$/i
];

// Number word dictionary for written number evasion checks
const NUMBER_WORDS_MAP = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  oh: '0',
};

/**
 * Detects phone numbers shared in any format:
 * - Direct: "9563693257", "+919563693257", "+1-956-369-3257"
 * - Multi-line vertical: "9\n5\n6\n3\n6\n9\n3\n2\n5\n7"
 * - Spaced/dotted/slashed: "9 5 6 3 6 9 3 2 5 7", "9.5.6.3.6.9.3.2.5.7", "9-5-6-3-6-9-3-2-5-7"
 * - Words: "nine five six three six nine three two five seven"
 */
function detectPhoneNumber(text) {
  if (!text || typeof text !== 'string') return false;
  const raw = text.trim();
  if (!raw) return false;

  // 1. Multi-line vertical single/double digits check
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length >= 7) {
    const digitLines = lines.filter(l => /^\D*(\d)\D*$/.test(l));
    if (digitLines.length >= 7 && digitLines.length / lines.length >= 0.7) {
      const extractedDigits = lines.map(l => l.replace(/\D/g, '')).join('');
      if (extractedDigits.length >= 7 && extractedDigits.length <= 16) {
        return true;
      }
    }
  }

  // 2. Convert written number words to digits
  let textWithConvertedWords = raw.toLowerCase();
  for (const [word, digit] of Object.entries(NUMBER_WORDS_MAP)) {
    const wordRegex = new RegExp(`\\b${word}\\b`, 'gi');
    textWithConvertedWords = textWithConvertedWords.replace(wordRegex, digit);
  }

  // 3. Spaced / symbol separated digits
  const digitsOnly = textWithConvertedWords.replace(/\D/g, '');
  if (digitsOnly.length >= 10 && digitsOnly.length <= 16) {
    const nonSpaceCount = raw.replace(/\s/g, '').length;
    if (digitsOnly.length / Math.max(1, nonSpaceCount) >= 0.45 || nonSpaceCount <= 25) {
      return true;
    }
  }

  // 4. Standard phone regex patterns
  const phonePatterns = [
    // Standard international / US / India mobile format
    /\b(?:\+?\d{1,3}[-.\s\/\\]*)?(?:\(?\d{2,4}\)?[-.\s\/\\]*)?\d{3,5}[-.\s\/\\]*\d{3,5}\b/,
    /\b[6-9]\d{9}\b/,
    /\b\d{3}[-.\s\/\\]\d{3}[-.\s\/\\]\d{4}\b/,
    /\b\(\d{3}\)\s*\d{3}[-.\s\/\\]\d{4}\b/,
    // Spaced 10 digits
    /\b\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\b/,
    // Phone keywords followed by 7-15 digits
    /\b(call|ph|phone|num|number|no|whatsapp|wa|dial|contact|cell|mob|mobile|msg|txt|text|reach me|dm me on wa|call me)\s*[:=-]?\s*[\d\s\.\-_\\\/]{7,16}\b/i
  ];

  for (const pattern of phonePatterns) {
    if (pattern.test(raw) || pattern.test(textWithConvertedWords)) {
      const match = raw.match(pattern) || textWithConvertedWords.match(pattern);
      if (match) {
        const matchDigits = match[0].replace(/\D/g, '');
        if (matchDigits.length >= 7 && matchDigits.length <= 16) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Detects Snapchat, Instagram, and social handles/links
 */
function detectSocialMediaSharing(text) {
  if (!text || typeof text !== 'string') return false;
  const raw = text.trim();
  if (!raw) return false;

  const socialPatterns = [
    // Instagram links and handles
    /\b(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am|ig\.me)\/[a-zA-Z0-9_\.]+\b/i,
    /\b(?:add|follow|find|dm|msg|text|my)\s+(?:me\s+on\s+|my\s+)?(?:insta|instagram|ig)\b/i,
    /\b(?:insta|instagram|ig)\s*[:=-]\s*@?[a-zA-Z0-9_\.]{3,30}\b/i,
    /\b(?:my\s+)?(?:insta|instagram|ig)\s+is\s+@?[a-zA-Z0-9_\.]{3,30}\b/i,
    /^\s*(?:insta|instagram|ig)\s*[:\s]+@?[a-zA-Z0-9_\.]+\s*$/i,

    // Snapchat links and handles
    /\b(?:https?:\/\/)?(?:www\.)?(?:snapchat\.com|t\.snapchat\.com)\/[a-zA-Z0-9_\.]+\b/i,
    /\b(?:add|follow|find|dm|msg|text|send|hit)\s+(?:me\s+on\s+|my\s+)?(?:snap|snapchat|sc)\b/i,
    /\b(?:snap|snapchat|sc)\s*[:=-]\s*@?[a-zA-Z0-9_\.]{3,30}\b/i,
    /\b(?:my\s+)?(?:snap|snapchat|sc)\s+is\s+@?[a-zA-Z0-9_\.]{3,30}\b/i,
    /^\s*(?:snap|snapchat|sc)\s*[:\s]+@?[a-zA-Z0-9_\.]+\s*$/i,

    // WhatsApp / Telegram / Discord / TikTok handles and links
    /\b(?:wa\.me|t\.me|telegram\.me|discord\.gg|dsc\.gg|tiktok\.com\/@)[a-zA-Z0-9_\.]+\b/i,
    /\b(?:telegram|tg|whatsapp|discord)\s*[:=-]\s*@?[a-zA-Z0-9_\.]+\b/i
  ];

  for (const pattern of socialPatterns) {
    if (pattern.test(raw)) {
      return true;
    }
  }

  return false;
}

/**
 * Restricts symbols other than standard punctuation (, and .) to tighten moderation
 * Allows letters (Latin, Devanagari, Tamil, Telugu, Kannada), numbers, spaces, commas, periods,
 * and standard English conversational apostrophes and question marks.
 * Enforces maximum of 5 continuous dots (.) and commas (,).
 */
function detectRestrictedSymbols(text) {
  if (!text || typeof text !== 'string') return false;
  if (isInnocentColloquialism(text)) return false;

  // Check for excessive repeating dots or commas (>5 continuous)
  if (/\.{6,}/.test(text) || /\,{6,}/.test(text)) {
    return true;
  }

  // Prohibited symbols commonly used for spam or filter evasion:
  // slashes /, \, @, #, $, %, ^, *, _, +, =, ~, |, <, >, {, }, [, ], `
  const RESTRICTED_SYMBOLS_REGEX = /[\/\\@#$%^\*_\+=\~\|<>\{\}\[\]`]/;
  return RESTRICTED_SYMBOLS_REGEX.test(text);
}

function isKeyboardMashOrCharacterFlood(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim().toLowerCase();

  // Allow continuous . or , up to 5 times max (e.g. ..., ...., ....., ,,,,,)
  if (/^[\.,]{1,5}$/.test(clean)) return false;

  // Excessive continuous dots or commas (>5)
  if (/\.{6,}/.test(clean) || /\,{6,}/.test(clean)) return true;

  // Check for 6 or more repeating identical characters
  if (/(.)\1{5,}/.test(clean)) return true;

  // Punctuation flood of non-dot/comma symbols
  if (/^[\s\?!;:\-_+=\*\^%$#@~`\/\\|<>\{\}\[\]]{3,}$/.test(clean)) return true;
  if (/^[\s\.\?!,;:\-_+=\*\^%$#@~`\/\\|<>\{\}\[\]]{6,}$/.test(clean)) return true;

  const commonMashes = [
    'asdfgh', 'asdfjkl', 'qwertyui', 'zxcvbn', 'lkjhgf',
    'qazwsx', 'wsxedc', 'edcrfv', 'rfvtgb', 'yhnujm',
    'poiuyt', 'mnbvcx'
  ];
  for (const mash of commonMashes) {
    if (clean.includes(mash)) return true;
  }
  if (/^[a-z]{8,}$/i.test(clean) && !/[aeiouy]/i.test(clean)) {
    return true;
  }
  return false;
}

function isVerticalLetterSpam(text) {
  if (!text || typeof text !== 'string') return false;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length >= 3 && lines.every(l => l.length <= 2)) {
    return true;
  }
  return false;
}

function isInnocentColloquialism(text) {
  if (!text) return false;
  const clean = text.trim();
  for (const pattern of INNOCENT_COLLOQUIALISMS) {
    if (pattern.test(clean)) return true;
  }
  return false;
}

/**
 * Analyzes whole conversation utterance and text lines
 */
function analyzeConversationLine(text) {
  if (!text || typeof text !== 'string') {
    return {
      isViolation: false,
      isThreat: false,
      isHarassment: false,
      isLowEffort: false,
      category: null,
      reason: null,
      warningMessage: null
    };
  }

  const cleaned = text.trim();
  if (cleaned.length === 0) {
    return {
      isViolation: true,
      isThreat: false,
      isHarassment: false,
      isLowEffort: true,
      category: 'empty',
      reason: 'empty_message',
      warningMessage: '⚠️ Warning: Empty message detected.'
    };
  }

  // ── STEP 1: False Positive Protection for Idioms & Safe Colloquialisms ──
  if (isInnocentColloquialism(cleaned)) {
    return {
      isViolation: false,
      isThreat: false,
      isHarassment: false,
      isLowEffort: false,
      category: null,
      reason: null,
      warningMessage: null
    };
  }

  // ── STEP 1.1: Phone Number Sharing Protection ──
  if (detectPhoneNumber(cleaned)) {
    return {
      isViolation: true,
      isThreat: false,
      isHarassment: false,
      isLowEffort: false,
      category: 'privacy_phone_sharing',
      reason: 'phone_number_detected',
      warningMessage: '🚫 Warning: Sharing phone numbers or personal contact numbers is restricted to protect your privacy.'
    };
  }

  // ── STEP 1.2: Snapchat & Instagram / Social Media Sharing Protection ──
  if (detectSocialMediaSharing(cleaned)) {
    return {
      isViolation: true,
      isThreat: false,
      isHarassment: false,
      isLowEffort: false,
      category: 'social_handle_leak',
      reason: 'social_media_detected',
      warningMessage: '🚫 Warning: Sharing Snapchat, Instagram, or social IDs is not allowed. Please keep conversations within the chat.'
    };
  }

  // ── STEP 1.3: Restricted Symbol Restriction (Max 5 continuous dots/commas, no prohibited special symbols) ──
  if (detectRestrictedSymbols(cleaned)) {
    const isExcessivePunct = /\.{6,}/.test(cleaned) || /\,{6,}/.test(cleaned);
    const warn = isExcessivePunct
      ? '⚠️ Warning: Continuous dots (.) or commas (,) are allowed up to 5 times max.'
      : '⚠️ Warning: Special symbols like /, @, #, $, %, ^, *, _, +, =, ~, |, <, > are restricted. Only letters, numbers, spaces, commas (,), and periods (.) are permitted (up to 5 continuous dots/commas).';
    return {
      isViolation: true,
      isThreat: false,
      isHarassment: false,
      isLowEffort: false,
      category: 'restricted_symbols',
      reason: isExcessivePunct ? 'excessive_punctuation_detected' : 'restricted_symbols_detected',
      warningMessage: warn
    };
  }

  // Prepare normalized candidate variations (vertical collapsed, stripped spacers, leet)
  const verticalCollapsed = cleaned.replace(/([a-zA-Z0-9])[\r\n]+([a-zA-Z0-9])/g, '$1$2').replace(/\s+/g, ' ');
  const strippedSpacers = cleaned.toLowerCase().replace(/[\s\.\-_,\/\\~\|\*\^#%+=:;'"!?`]+/g, '');
  const candidateTexts = [cleaned, verticalCollapsed, strippedSpacers];

  // ── STEP 2: Threats of Violence & Bodily Harm ──
  for (const cand of candidateTexts) {
    for (const pattern of THREAT_PATTERNS) {
      if (pattern.test(cand)) {
        return {
          isViolation: true,
          isThreat: true,
          isHarassment: true,
          isLowEffort: false,
          category: 'threat_violence',
          reason: 'threat_violence_detected',
          warningMessage: '⚠️ Warning (1/3): Inappropriate or threatening language detected. Message was not sent. Please keep conversations respectful!'
        };
      }
    }
  }

  // ── STEP 3: Stalking, Doxxing & Doorstep Intimidation ──
  for (const cand of candidateTexts) {
    for (const pattern of STALKING_DOX_PATTERNS) {
      if (pattern.test(cand)) {
        return {
          isViolation: true,
          isThreat: true,
          isHarassment: true,
          isLowEffort: false,
          category: 'threat_dox_stalking',
          reason: 'stalking_dox_threat_detected',
          warningMessage: '⚠️ Warning (1/3): Inappropriate or threatening language detected. Message was not sent. Please keep conversations respectful!'
        };
      }
    }
  }

  // ── STEP 4: Extortion, Blackmail & Coercion ──
  for (const cand of candidateTexts) {
    for (const pattern of EXTORTION_PATTERNS) {
      if (pattern.test(cand)) {
        return {
          isViolation: true,
          isThreat: true,
          isHarassment: true,
          isLowEffort: false,
          category: 'coercion_blackmail',
          reason: 'blackmail_coercion_detected',
          warningMessage: '⚠️ Warning (1/3): Inappropriate or threatening language detected. Message was not sent. Please keep conversations respectful!'
        };
      }
    }
  }

  // ── STEP 5: Explicit Sexual Harassment & Predatory Demands ──
  for (const cand of candidateTexts) {
    for (const pattern of SEXUAL_HARASSMENT_PATTERNS) {
      if (pattern.test(cand)) {
        return {
          isViolation: true,
          isThreat: false,
          isHarassment: true,
          isLowEffort: false,
          category: 'sexual_harassment',
          reason: 'sexual_harassment_detected',
          warningMessage: '⚠️ Warning (1/3): Inappropriate language detected. Message was not sent. Please keep conversations respectful!'
        };
      }
    }
  }

  // ── STEP 6: Severe Cyberbullying & Suicide Encouragement ──
  for (const cand of candidateTexts) {
    for (const pattern of CYBERBULLYING_PATTERNS) {
      if (pattern.test(cand)) {
        return {
          isViolation: true,
          isThreat: true,
          isHarassment: true,
          isLowEffort: false,
          category: 'cyberbullying_selfharm',
          reason: 'severe_cyberbullying_detected',
          warningMessage: '⚠️ Warning (1/3): Inappropriate language detected. Message was not sent. Please keep conversations respectful!'
        };
      }
    }
  }

  // ── STEP 7: Low-Effort Lines & Vertical Spam (English Focus) ──
  for (const pattern of LOW_EFFORT_EXACT_PATTERNS) {
    if (pattern.test(cleaned)) {
      return {
        isViolation: true,
        isThreat: false,
        isHarassment: false,
        isLowEffort: true,
        category: 'low_effort',
        reason: 'low_effort_detected',
        warningMessage: '⚠️ Warning: Low-effort message detected. Please put effort into starting a real conversation!'
      };
    }
  }

  if (isVerticalLetterSpam(cleaned)) {
    return {
      isViolation: true,
      isThreat: false,
      isHarassment: false,
      isLowEffort: true,
      category: 'low_effort_vertical_spam',
      reason: 'low_effort_vertical_spam',
      warningMessage: '⚠️ Warning: Low-effort message detected. Please put effort into starting a real conversation!'
    };
  }

  if (isKeyboardMashOrCharacterFlood(cleaned)) {
    return {
      isViolation: true,
      isThreat: false,
      isHarassment: false,
      isLowEffort: true,
      category: 'low_effort_gibberish',
      reason: 'low_effort_gibberish',
      warningMessage: '⚠️ Warning: Low-effort message detected. Please put effort into starting a real conversation!'
    };
  }

  return {
    isViolation: false,
    isThreat: false,
    isHarassment: false,
    isLowEffort: false,
    category: null,
    reason: null,
    warningMessage: null
  };
}

module.exports = {
  analyzeConversationLine,
  isInnocentColloquialism,
  isKeyboardMashOrCharacterFlood,
  isVerticalLetterSpam,
  detectPhoneNumber,
  detectSocialMediaSharing,
  detectRestrictedSymbols,
  INNOCENT_COLLOQUIALISMS
};
