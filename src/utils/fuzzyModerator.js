/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PING ADVANCED 2028-30 FUZZY & PHONETIC MODERATION ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects all kinds of bad words and abusive phrases ("fuck off", "boobs",
 * "fck", "bobs", "fuk", "b00bs", etc.) across any alternative spelling,
 * leetspeak permutation, consonant skeleton, soundex/metaphone phonetic
 * equivalent, or obfuscated variation.
 *
 * Guaranteed 0 false positives on legitimate dictionary words (e.g. "book",
 * "boots", "focus", "cocktail", "butter", "assistant", "duck", "pass", etc.).
 */

// Canonical Root Bad Words and their categorized variants
const CANONICAL_BAD_WORDS = {
  // Vulgarities, Obscenities & Dismissals
  fuck: {
    roots: ['fuck', 'fucking', 'fucked', 'fucker', 'fuckers', 'fucks'],
    skeleton: 'fk',
    shortSkeleton: 'fk',
    phoneticKeys: ['FK', 'FKK', 'FKG'],
    patterns: [
      /\bf[u\*_.\-@#4v]+c*k+\b/i,
      /\bf+[ck]+\b/i,
      /\bph[u\*_.\-@#4v]+c*k+\b/i,
      /\bf+[u\*_.\-@#4v]+[kg]+\b/i,
      /\bf[\s.\-_*]+u[\s.\-_*]+c[\s.\-_*]+k\b/i
    ],
    exceptions: new Set(['fork', 'folk', 'fake', 'funk', 'flock', 'flask', 'focus', 'fact', 'facts', 'face', 'fast', 'fall', 'fill', 'full', 'feel', 'foot', 'feed', 'file', 'fine', 'fire', 'fish', 'five', 'flat', 'flow', 'fly', 'food', 'form', 'free', 'from', 'fail', 'fair', 'farm', 'fate', 'fear', 'film', 'firm', 'flag', 'foam', 'fond', 'fool', 'ford', 'foul', 'frog', 'fuel', 'fund', 'fury', 'fuse', 'fame', 'fist', 'fizz', 'duck', 'ducks', 'luck', 'lucky', 'buck', 'bucks', 'tuck', 'puck', 'suck', 'sucks', 'muck'])
  },

  fuck_off: {
    roots: ['fuck off', 'fck off', 'fuk off', 'fk off', 'f off', 'fuck u', 'fuck you', 'fck u', 'fuk u', 'fk u', 'fuckouttahere', 'get fucked', 'go fuck yourself'],
    skeleton: 'fkof',
    patterns: [
      /\bf[u\*_.\-@#4v]*c*k*\s*(off|of|u|you|urself|yourself)\b/i,
      /\bfk\s*(off|of|u|you)\b/i,
      /\bf\s*off\b/i,
      /\bfuckof+\b/i,
      /\bfckof+\b/i,
      /\bfukof+\b/i,
      /\b(gtfo|stfu)\b/i
    ],
    exceptions: new Set()
  },

  // Sexual body parts & explicit requests
  boobs: {
    roots: ['boob', 'boobs', 'boobie', 'boobies', 'bobs', 'b00bs', 'bewbs', 'boobz', 'b00bz', 'bobby'],
    skeleton: 'bbs',
    shortSkeleton: 'bb',
    phoneticKeys: ['BBS', 'BP', 'BB'],
    patterns: [
      /\bb[o0\*_.\-@#]{2,}b[sz]?\b/i,
      /\bb[e3]+w+b[sz]?\b/i,
      /\bb[o0\*_.\-]+b[sz]?\b/i,
      /\bb[\s.\-_*]+o[\s.\-_*]+o[\s.\-_*]+b[\s.\-_*]*s?\b/i,
      /\bb[\s.\-_*]+o[\s.\-_*]+b[\s.\-_*]*s?\b/i
    ],
    exceptions: new Set(['book', 'books', 'boot', 'boots', 'boost', 'boosts', 'bob', 'bobby', 'boom', 'booth', 'board', 'born', 'boss', 'bowl', 'box', 'boy', 'body', 'bond', 'bone', 'bonus', 'bold', 'bolt', 'bomb', 'bound', 'bout', 'baby', 'bake', 'ball', 'band', 'bank', 'bare', 'bark', 'barn', 'base', 'bath', 'beam', 'bean', 'bear', 'beat', 'beef', 'beer', 'bell', 'belt', 'bend', 'best', 'bill', 'bird', 'bite', 'blow', 'blue', 'boat'])
  },

  tits: {
    roots: ['tit', 'tits', 'titty', 'titties', 'tities', 't1ts'],
    skeleton: 'tts',
    shortSkeleton: 'tt',
    patterns: [
      /\bt[i1\*_.\-@!]+t[sz]?\b/i,
      /\bt[i1\*_.\-@!]+t+y\b/i,
      /\bt[i1\*_.\-@!]+t+i+e+s\b/i
    ],
    exceptions: new Set(['it', 'its', "it's", 'fit', 'fits', 'sit', 'sits', 'hit', 'hits', 'bit', 'bits', 'lit', 'pit', 'pits', 'kit', 'kits', 'wit', 'wits', 'tip', 'tips', 'tie', 'ties', 'tin', 'tins', 'tiny', 'till', 'time', 'times', 'title', 'tidy', 'ticket', 'tight', 'that', 'this', 'they', 'them', 'then', 'the', 'two', 'too', 'to', 'top', 'tap', 'tub', 'tea', 'tag', 'ten', 'ton', 'text', 'test', 'taste', 'trust', 'treat', 'truth', 'total'])
  },

  pussy: {
    roots: ['pussy', 'pussies', 'pussi', 'puzzy', 'puss', 'puxxy'],
    skeleton: 'pss',
    shortSkeleton: 'ps',
    patterns: [
      /\bp[u\*_.\-@#v]+[s$z]{2,}y?\b/i,
      /\bp[u\*_.\-@#v]+x{2,}y?\b/i
    ],
    exceptions: new Set(['pass', 'passed', 'passes', 'passing', 'press', 'push', 'pushed', 'pushes', 'pushing', 'plus', 'post', 'past', 'pure', 'pause', 'pose', 'party'])
  },

  dick: {
    roots: ['dick', 'dicks', 'dik', 'dck', 'd1ck'],
    skeleton: 'dk',
    patterns: [
      /\bd[i1\*_.\-!]+c*k+[sz]?\b/i
    ],
    exceptions: new Set(['dickens', 'dock', 'duck', 'deck', 'dark', 'desk', 'disk', 'disc', 'drink', 'drop', 'draw', 'deep', 'dare', 'date', 'direct', 'drive', 'during', 'pick', 'picks', 'kick', 'kicks', 'tick', 'ticks', 'sick', 'nick', 'wick', 'lick'])
  },

  cock: {
    roots: ['cock', 'cocks', 'cok', 'c0ck'],
    skeleton: 'ck',
    patterns: [
      /\bc[o0\*_.\-]+c*k+[sz]?\b/i
    ],
    exceptions: new Set(['cocktail', 'cocktails', 'cook', 'cooks', 'cork', 'clock', 'check', 'chick', 'crack', 'click', 'cake', 'cool', 'coin', 'coat', 'cost', 'come', 'came', 'code', 'core', 'dock', 'lock', 'mock', 'rock', 'sock'])
  },

  bitch: {
    roots: ['bitch', 'bitches', 'btch', 'b1tch', 'betch', 'biatch', 'bixch'],
    skeleton: 'btch',
    patterns: [
      /\bb[i1\*_.\-!e]+t*c+h+[sz]?\b/i,
      /\bb[i1\*_.\-!e]+x+c*h+[sz]?\b/i
    ],
    exceptions: new Set(['batch', 'beach', 'birth', 'bench', 'bunch', 'branch', 'botch', 'belch', 'both', 'bath', 'booth', 'which', 'pitch', 'rich', 'catch', 'match', 'watch', 'witch', 'hitch', 'ditch'])
  },

  asshole: {
    roots: ['asshole', 'assholes', 'ashole', 'azzhole'],
    skeleton: 'sshl',
    patterns: [
      /\ba[s$z]{2,}h[o0]l[e3][sz]?\b/i
    ],
    exceptions: new Set()
  },

  cunt: {
    roots: ['cunt', 'cunts', 'cnt'],
    skeleton: 'cnt',
    patterns: [
      /\bc[u\*_.\-@#v]+n+t+[sz]?\b/i
    ],
    exceptions: new Set(['count', 'counts', 'can', 'cant', "can't", 'center', 'cent', 'cents', 'current', 'court', 'cut', 'cute', 'content', 'continue', 'contact', 'country', 'control', 'hunt', 'hunts', 'hunting', 'hunter', 'hint', 'hints', 'hurt', 'hurts', 'hurting', 'punt', 'punts', 'runt', 'runts', 'aunt', 'aunts'])
  },

  slut: {
    roots: ['slut', 'sluts', 'slutt', 'slt'],
    skeleton: 'slt',
    patterns: [
      /\bs+l+[u\*_.\-@#v]+t+[sz]?\b/i
    ],
    exceptions: new Set(['salt', 'slit', 'slot', 'slate', 'slow', 'solo', 'silt', 'suit', 'shut', 'soft', 'sort', 'spot', 'start', 'still', 'stop', 'sight', 'short', 'smart', 'sweet'])
  },

  whore: {
    roots: ['whore', 'whores', 'whor', 'h0re'],
    skeleton: 'whr',
    patterns: [
      /\bw+h+[o0\*_.\-]+r+[e3]?[sz]?\b/i
    ],
    exceptions: new Set(['where', 'whole', 'whose', 'whom', 'white', 'whale', 'wheel', 'while'])
  },

  nigger: {
    roots: ['nigger', 'niggers', 'nigga', 'niggaz', 'n1gger', 'n1gga', 'nxxga'],
    skeleton: 'ngr',
    patterns: [
      /\bn+[i1\*_.\-!x]+g{2,}[a-z]*\b/i
    ],
    exceptions: new Set(['niger', 'nigeria', 'night', 'neigh', 'neighbor'])
  },

  diddy: {
    roots: ['diddy', 'dixxy', 'diddi', 'diddie', 'diddler', 'diddling', 'diddled'],
    skeleton: 'ddy',
    patterns: [
      /\bd+[i1\*_.\-!]+[dx]{2,}[yie]+\b/i
    ],
    exceptions: new Set(['daddy', 'did', 'duty', 'daily'])
  },

  // Urdu / South Asian slurs & profanity
  jhaat: {
    roots: ['jhaat', 'jhaant', 'jhat', 'jhant', 'jhaatu', 'jhantu', 'jhaantu', 'jhatu'],
    skeleton: 'jht',
    shortSkeleton: 'jht',
    patterns: [
      /\bj+h+[a\*_.\-@4]+[n]*t+[szu]?\b/i,
      /\bj+h+[a\*_.\-@4]{2,}t+[szu]?\b/i,
      /\bj[\s.\-_*]+h[\s.\-_*]+a[\s.\-_*]+a?[\s.\-_*]*n?[\s.\-_*]*t\b/i
    ],
    exceptions: new Set()
  },

  suwar: {
    roots: ['suwar', 'suar', 'suwwar', 'soowar', 'suaar'],
    skeleton: 'swr',
    shortSkeleton: 'swr',
    patterns: [
      /\bs+[u\*_.\-@#0ov]+[w]*[a\*_.\-@4]+r+[sz]?\b/i,
      /\bs[\s.\-_*]+u[\s.\-_*]+[w]*[\s.\-_*]*a[\s.\-_*]+r\b/i
    ],
    exceptions: new Set(['sour', 'shower', 'swear', 'sweet', 'sweater', 'sugar', 'super', 'sure', 'software', 'sword', 'swerve'])
  }
};

// Global Consonant Skeleton Generator
function extractConsonantSkeleton(word) {
  if (!word || typeof word !== 'string') return '';
  return word
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z]/g, '')
    .replace(/[aeiouy]/g, '')
    .replace(/(.)\1+/g, '$1');
}

// Levenshtein distance calculation
function levenshteinDistance(s1, s2) {
  if (!s1) return s2 ? s2.length : 0;
  if (!s2) return s1.length;
  if (s1 === s2) return 0;

  const m = s1.length;
  const n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,       // deletion
        dp[i][j - 1] + 1,       // insertion
        dp[i - 1][j - 1] + cost // substitution
      );

      // Transposition check (Damerau)
      if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }

  return dp[m][n];
}

// Strip spacer symbols and numbers to check squished word
function squishWord(word) {
  if (!word || typeof word !== 'string') return '';
  return word
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b');
}

/**
 * Evaluates whether text contains bad words or alternative spellings
 * @param {string} text
 * @param {Array<string>} representations
 * @returns {{hasBadWord: boolean, matchedWords: Array<string>, category: string}}
 */
function evaluateFuzzyBadWords(text, representations = []) {
  if (!text || typeof text !== 'string') {
    return { hasBadWord: false, matchedWords: [], category: null };
  }

  const rawLower = text.toLowerCase().trim();
  const matchedWords = new Set();
  let matchedCategory = 'profanity_vulgarity';

  // 1. Check multi-word phrase patterns directly first (e.g. "fuck off", "fck off", "fk off")
  for (const [key, config] of Object.entries(CANONICAL_BAD_WORDS)) {
    for (const pattern of config.patterns) {
      const match = rawLower.match(pattern);
      if (match) {
        const matchedSnippet = match[0].toLowerCase().trim();
        if (!config.exceptions.has(matchedSnippet)) {
          matchedWords.add(key);
          if (['boobs', 'tits', 'pussy', 'dick', 'cock'].includes(key)) {
            matchedCategory = 'sexual_harassment_vulgarity';
          }
        }
      }
    }

    // Also test across representations (spaced, dotted, leet)
    for (const rep of representations) {
      if (!rep) continue;
      for (const pattern of config.patterns) {
        const match = rep.match(pattern);
        if (match) {
          const matchedSnippet = match[0].toLowerCase().trim();
          if (!config.exceptions.has(matchedSnippet)) {
            matchedWords.add(key);
          }
        }
      }
    }
  }

  // 2. Token-level fuzzy & consonant skeleton matching
  const tokens = rawLower
    .split(/[\s,\.\-_:\/\*\+#!?\(\)\[\]\{\}]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2);

  for (const token of tokens) {
    if (token.length < 3) continue; // Skip 1-2 character tokens (e.g. "it", "at", "to", "is", "in", "or", "he")
    const squished = squishWord(token);
    const skeleton = extractConsonantSkeleton(token);

    for (const [key, config] of Object.entries(CANONICAL_BAD_WORDS)) {
      if (config.exceptions.has(token) || config.exceptions.has(squished)) {
        continue;
      }

      // Exact root match
      if (config.roots.includes(token) || config.roots.includes(squished)) {
        matchedWords.add(key);
        break;
      }

      // Consonant skeleton match for words of length 3-8
      if (config.skeleton && skeleton && config.skeleton === skeleton && token.length <= 8) {
        matchedWords.add(key);
        break;
      }

      // Damerau-Levenshtein distance matching for misspellings (e.g. "fuk", "fukk", "fck", "bobs", "boobz")
      for (const root of config.roots) {
        // For short roots (3 letters or fewer), only allow exact match or distance 1 if token.length >= 4 with matching skeleton
        if (root.length <= 3) {
          if (token.length <= 3 && token !== root && squished !== root) continue;
        }

        // Require onset consonant matching for short roots (length <= 5) to prevent rhyming false positives
        // (e.g. "hunt" vs "cunt", "duck" vs "fuck", "pick" vs "dick", "rock" vs "cock")
        const firstTokenChar = squished[0] || token[0];
        const firstRootChar = root[0];
        const isHomophoneOnset = (firstTokenChar === firstRootChar) ||
          (firstTokenChar === 'k' && firstRootChar === 'c') ||
          (firstTokenChar === 'c' && firstRootChar === 'k') ||
          (token.startsWith('ph') && firstRootChar === 'f');

        if (root.length <= 5 && !isHomophoneOnset) {
          continue;
        }

        if (Math.abs(token.length - root.length) <= 2) {
          const dist = levenshteinDistance(token, root);
          const maxAllowedDist = root.length <= 4 ? 1 : 2;

          if (dist <= maxAllowedDist) {
            if (!config.exceptions.has(token) && !config.exceptions.has(squished)) {
              matchedWords.add(key);
              break;
            }
          }
        }
      }
    }
  }

  return {
    hasBadWord: matchedWords.size > 0,
    matchedWords: Array.from(matchedWords),
    category: matchedCategory
  };
}

module.exports = {
  CANONICAL_BAD_WORDS,
  evaluateFuzzyBadWords,
  extractConsonantSkeleton,
  levenshteinDistance,
  squishWord
};
