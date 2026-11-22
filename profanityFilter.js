// Zero-dependency English and Tagalog profanity filter with normalization,
// leetspeak decoding, censored-word detection, and strict word boundaries
// to prevent false positives on innocent words (e.g., "Batangas", "putahe", "class").

// Safe compound phrases removed prior to scanning
const SAFE_PHRASES = [/\bleche\s+flan\b/gi];

// Core English and Tagalog/Filipino profanity terms and multi-word phrases
const PROFANITY_TERMS = [
  // English profanity & slurs
  'fuck',
  'fucker',
  'fuckers',
  'fucking',
  'fucked',
  'fucks',
  'motherfucker',
  'motherfucking',
  'wtf',
  'stfu',
  'shit',
  'shitty',
  'shitting',
  'shits',
  'bullshit',
  'dipshit',
  'shithead',
  'bitch',
  'bitches',
  'bitching',
  'bitchy',
  'son of a bitch',
  'asshole',
  'assholes',
  'dumbass',
  'jackass',
  'bastard',
  'bastards',
  'dick',
  'dicks',
  'dickhead',
  'cock',
  'cocks',
  'cocksucker',
  'cunt',
  'cunts',
  'pussy',
  'pussies',
  'whore',
  'whores',
  'slut',
  'sluts',
  'prick',
  'twat',
  'wanker',
  'douchebag',
  'nigger',
  'niggers',
  'nigga',
  'niggas',
  'faggot',
  'faggots',
  'retard',
  'retarded',

  // Tagalog / Filipino profanity & insults
  'putangina',
  'putang ina',
  'putanginamo',
  'putang ina mo',
  'putanginang',
  'tangina',
  'tang ina',
  'tanginamo',
  'tang ina mo',
  'tanginang',
  'ptngina',
  'tngina',
  'puta',
  'putragis',
  'punyeta',
  'pucha',
  'puchangina',
  'pota',
  'potangina',
  'potang ina',
  'anak ng puta',
  'leche',
  'letse',
  'lintik',
  'gago',
  'gaga',
  'gagong',
  'kagaguhan',
  'tarantado',
  'tarantada',
  'ulol',
  'ulul',
  'kupal',
  'bobo',
  'boba',
  'bobong',
  'kabobohan',
  'tanga',
  'tangang',
  'katangahan',
  'inutil',
  'hinayupak',
  'hayop ka',
  'hayup ka',
  'demonyo ka',
  'walanghiya',
  'walang hiya',
  'pakyu',
  'pak you',
  'pakshet',
  'paksyet',
  'peste',
  'pisteng yawa',
  'yawa',
  'buwisit',
  'bwisit',

  // Tagalog vulgar sexual / anatomical terms
  'kantot',
  'kantutan',
  'iyot',
  'iyutan',
  'jakol',
  'jabol',
  'titi',
  'tite',
  'burat',
  'etits',
  'puke',
  'puki',
  'bilat',
  'pekpek',
  'tamod',
  'pokpok',
  'bayag',
  'supot',
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Strict ASCII alphanumeric boundaries prevent matching inside "Batangas", "class", or "putahe"
const BOUNDARY_PATTERNS = PROFANITY_TERMS.map((term) => {
  const flexibleWhitespace = escapeRegex(term).replace(/\s+/g, '\\s+');
  return {
    term,
    regex: new RegExp(`(?<![a-z0-9])${flexibleWhitespace}(?![a-z0-9])`, 'i'),
  };
});

// Common censored asterisk evasions (e.g., f*ck, p*ta, t*ngina)
const CENSORED_PATTERNS = [
  { term: 'fuck', regex: /(?<![a-z0-9])f\*+c?k[a-z0-9*]*(?![a-z0-9])/i },
  { term: 'shit', regex: /(?<![a-z0-9])sh\*+t[a-z0-9*]*(?![a-z0-9])/i },
  { term: 'bitch', regex: /(?<![a-z0-9])b\*+t?ch[a-z0-9*]*(?![a-z0-9])/i },
  { term: 'putangina', regex: /(?<![a-z0-9])p\*+t+a+n+g+\s*i+n+a[a-z0-9*]*(?![a-z0-9])/i },
  { term: 'puta', regex: /(?<![a-z0-9])p\*+t+a(?![a-z0-9])/i },
  { term: 'tangina', regex: /(?<![a-z0-9])t\*+n+g+\s*i+n+a[a-z0-9*]*(?![a-z0-9])/i },
  { term: 'gago', regex: /(?<![a-z0-9])g\*+g+[oa](?![a-z0-9])/i },
  { term: 'bobo', regex: /(?<![a-z0-9])b\*+b+[oa](?![a-z0-9])/i },
  { term: 'kupal', regex: /(?<![a-z0-9])k\*+p+a+l(?![a-z0-9])/i },
  { term: 'punyeta', regex: /(?<![a-z0-9])p\*+n+y+e+t+a(?![a-z0-9])/i },
  { term: 'ulol', regex: /(?<![a-z0-9])u+l\*+l(?![a-z0-9])/i },
];

// Spaced-letter evasions (e.g., "f u c k", "p u t a", "g a g o")
const SPACED_PATTERNS = [
  { term: 'fuck', regex: /(?<![a-z0-9])f\s+u\s+c\s+k(?![a-z0-9])/i },
  { term: 'shit', regex: /(?<![a-z0-9])s\s+h\s+i\s+t(?![a-z0-9])/i },
  { term: 'bitch', regex: /(?<![a-z0-9])b\s+i\s+t\s+c\s+h(?![a-z0-9])/i },
  { term: 'gago', regex: /(?<![a-z0-9])g\s+a\s+g\s+[oa](?![a-z0-9])/i },
  { term: 'puta', regex: /(?<![a-z0-9])p\s+u\s+t\s+a(?![a-z0-9])/i },
  { term: 'tangina', regex: /(?<![a-z0-9])t\s+a\s+n\s+g\s+i\s+n\s+a(?![a-z0-9])/i },
  { term: 'bobo', regex: /(?<![a-z0-9])b\s+o\s+b\s+[oa](?![a-z0-9])/i },
  { term: 'ulol', regex: /(?<![a-z0-9])u\s+l\s+o\s+l(?![a-z0-9])/i },
  { term: 'kupal', regex: /(?<![a-z0-9])k\s+u\s+p\s+a\s+l(?![a-z0-9])/i },
  { term: 'pakyu', regex: /(?<![a-z0-9])p\s+a\s+k\s+y\s+u(?![a-z0-9])/i },
];

function stripSafePhrases(text) {
  let cleaned = String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  for (const phrase of SAFE_PHRASES) {
    cleaned = cleaned.replace(phrase, ' ');
  }
  return cleaned;
}

function normalizeStandard(cleaned) {
  return cleaned
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeLeetspeak(cleaned) {
  return cleaned
    .replace(/@/g, 'a')
    .replace(/4/g, 'a')
    .replace(/3/g, 'e')
    .replace(/[1!]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/7/g, 't')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchBoundaryTerms(text) {
  for (const entry of BOUNDARY_PATTERNS) {
    if (entry.regex.test(text)) {
      return entry.term;
    }
  }
  return null;
}

/**
 * Returns the first matched profanity term (or null if clean).
 */
function findProfanity(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }

  const cleaned = stripSafePhrases(text);

  // Pass A: Standard normalized text
  const standard = normalizeStandard(cleaned);
  const directMatch = matchBoundaryTerms(standard);
  if (directMatch) {
    return directMatch;
  }

  // Pass B: Leetspeak decoding + stretched-letter normalization (e.g., "g@go", "fuuuuck")
  const leet = decodeLeetspeak(cleaned);
  const collapsedSingle = leet.replace(/(.)\1{2,}/g, '$1');
  const collapsedDouble = leet.replace(/(.)\1{2,}/g, '$1$1');

  const leetMatch =
    matchBoundaryTerms(leet) ||
    matchBoundaryTerms(collapsedSingle) ||
    matchBoundaryTerms(collapsedDouble);
  if (leetMatch) {
    return leetMatch;
  }

  // Pass C: Censored asterisk patterns and spaced-letter evasions
  for (const entry of CENSORED_PATTERNS) {
    if (entry.regex.test(cleaned)) {
      return entry.term;
    }
  }
  for (const entry of SPACED_PATTERNS) {
    if (entry.regex.test(standard)) {
      return entry.term;
    }
  }

  return null;
}

/**
 * Returns true if the supplied text contains English or Tagalog profanity.
 */
function containsProfanity(text) {
  return findProfanity(text) !== null;
}

module.exports = {
  containsProfanity,
  findProfanity,
};
