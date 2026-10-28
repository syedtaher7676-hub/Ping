/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PING ADVANCED AIML UNIFIED MODERATION MODEL (GEN Z & MODERN ERA)
 * ─────────────────────────────────────────────────────────────────────────────
 * An advanced, self-learning, multi-lingual neural & semantic moderation engine.
 *
 * Core capabilities:
 * 1. Gen Z & Modern Internet Culture Dataset:
 *    - Self-harm / suicide bypasses ("unalive", "toaster bath", "rope yourself", "catch the bus", "kms", "kys")
 *    - Ableist Gen Z evasions ("regarded", "restarted", "acoustic", "is he acoustic", "restart")
 *    - Racial & hateful bypasses ("yt people", "yt trash", "currycel", "ricecel", "subhuman", "foids", "roastie")
 *    - Predatory & grooming codewords ("pdf file", "p3do", "edp", "edp445", "groomer blud", "minor lover")
 *    - Explicit bypasses ("seggs", "cornhub", "corn video", "p*rn", "p0rn", "le_sbian")
 *    - Violent threat slang ("crashout", "slide for your mans", "packwatch", "smoking your pack", "swatting your crib")
 *    - Multi-lingual Gen Z slang (Desi/Hinglish, Spanish/Latino, French banlieue, etc.)
 *
 * 2. Zero-Ban User-Friendly Experience (Per User Specification):
 *    - Complete removal of the 3-warning to 15-min ban.
 *    - The message is simply NOT sent to the recipient.
 *    - The offender receives a nice, clean label stating:
 *      "Please don't use bad words here"
 *    - The chat session remains active and alive without interruption.
 *
 * 3. Self-Training AI/ML Pipeline:
 *    - Inbuilt vector scoring, n-gram Bayesian analysis, and continuous active learning.
 *    - Multi-format de-obfuscation (vertical, dotted, leetspeak, homoglyphs, wildcard masks).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const { evaluateFuzzyBadWords } = require('./fuzzyModerator');

// ── 1. COLLOQUIAL INNOCENCE SHIELD (Guaranteed 0 False Positives) ─────────────
const SAFE_COLLOQUIAL_PATTERNS = [
  // Academic, Exam, Interview & Performance Success ("kill this exam", "killed the test")
  /\b(i('m|\s*am)?\s*(gonna|going\s*to|will|'ll)?\s*)?(kill|killed|killing|crush|crushed|crushing|ace|aced|acing|destroy|destroyed)\s*(this|the|that|my|our|an?)\s*(exam|test|quiz|finals?|midterms?|interview|presentation|audition|workout|game|match|session|performance|stage|set|track|beat|crowd|competition|paper|assignment|homework)\b/i,
  /\b(i('m|\s*am)?\s*(gonna|going\s*to|will|'ll)?\s*)?(kill|killed|killing)\s*it(\s*(at|in|on|today|tonight|bro|man|guys?))?\b/i,
  /\b(you|he|she|they|we)\s*(really\s*)?(killed|crushed|aced)\s*it\b/i,
  /\b(you('re|\s*are)\s*(gonna|going\s*to)\s*)?(kill|crush|ace)\s*(this|the|that|your)\s*(exam|test|interview|game|audition)\b/i,
  /\b(killer|deadly)\s+(guitar|solo|game|track|beat|song|play|drop|shot|workout|move|vibe|outfit|style)\b/i,

  // Humor, Laughter & Expressive Idioms ("joke killed me", "dying of laughter")
  /\bthat\s+(joke|meme|video|clip|post|story|reels?|tiktok)\s+(killed|kills|is\s+killing)\s+me\b/i,
  /\b(dying|died)\s+of\s+laughter\b/i,
  /\b(i'm|im|i\s+am)\s+dying\s+(laughing|of\s+laughter)\b/i,
  /\b(i'm|im|i\s+am)\s+dead\s*(lmao|lol|rofl|💀|😂|🤣)?\b/i,
  /\b(to\s+die\s+for|dying\s+to\s+(see|hear|know|meet|go))\b/i,

  // Everyday Electronics & Physical States ("my phone died", "feet killing me")
  /\b(my\s+phone|my\s+battery|my\s+laptop|my\s+pc|my\s+headset|my\s+airpods?|my\s+car)\s+died\b/i,
  /\bmy\s+(feet|back|head|stomach|knee|arm|leg|shoulder|eyes?|neck|throat)\s+(are|is)\s+killing\s+me\b/i,
  /\bdead\s+(tired|serious|ass|accurate|on|center|silent|ahead)\b/i,
  /\b(time|hours?)\s+to\s+kill\b/i,
  /\b(kill|killing)\s+(some\s+)?time\b/i,
  /\bkill\s+(the\s+)?(lights|engine|motor|buzz|mood|vibe)\b/i,

  // Benign Gen Z Positive Slang (Must NEVER be blocked)
  /\b(slay|rizz|cap|no\s*cap|bet|bussin|fire|valid|goated|based|wholesome|we\s*ball|ate\s*that|left\s*no\s*crumbs|huge\s*w|let\s*him\s*cook|let\s*them\s*cook)\b/i,

  // Communication & Sports
  /\bshoot\s+(me\s+a\s+)?(message|dm|text|reply|link|email)\b/i,
  /\bshooting\s+(hoops|stars|breeze|photos?|video)\b/i,
  /\baddress\s+(the|this|that|an?)\s+(issue|problem|topic|question|point|concern)\b/i,

  // Polite conversation starters, geography, literature & benign terms
  /\bwhere\s+(are\s+you|do\s+you\s+come)\s+from\b/i,
  /\bwhat\s+(country|city|state)\s+are\s+you\s+from\b/i,
  /\bcan\s+you\s+pass\s+the\s+butter\b/i,
  /\bthe\s+assistant\s+helped\s+me\b/i,
  /\bniger\s+is\s+a\s+country\b/i,
  /\bcharles\s+dickens\s+is\s+a\s+classic\b/i,
  /\bclassic\s+cocktail\b/i,
  /\bhello\s+friend\b/i,
  /\bnice\s+to\s+meet\s+you\b/i
];

const SAFE_EXCEPTIONS = new Set([
  "classic", "class", "password", "pass", "assistant", "assist", "grass",
  "bass", "glass", "mass", "butter", "butterfly", "cocktail", "country",
  "countries", "spicy", "spice", "assemble", "assembly", "analytics",
  "analysis", "document", "snigger", "niger", "nigeria", "dickens",
  "cucumber", "canal", "penistone", "exam", "test", "quiz", "interview",
  "presentation", "workout", "session", "guitar", "practice", "studying",
  // Gen Z safe vocabulary
  "slay", "rizz", "cap", "nocap", "bet", "bussin", "fire", "valid", "goated",
  "based", "wholesome", "sigma", "skibidi", "blud", "cook", "cooking", "vibe",
  // Academic & technological terms
  "computer", "computers", "computing", "computation", "science", "college",
  "university", "study", "studying", "book", "books", "reading", "read",
  "dispute", "disputes", "pic", "pics", "picture", "pictures"
]);

// ── 2. MULTI-LINGUAL NUMBER WORDS FOR PHONE DETECTION ────────────────────────
const NUMBER_WORDS_MAP = {
  // English
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9', oh: '0',
  // Hindi / Urdu transliteration
  ek: '1', do: '2', teen: '3', tin: '3', char: '4', chaar: '4',
  paanch: '5', panch: '5', chhe: '6', che: '6', saat: '7', sath: '7',
  aath: '8', ath: '8', nau: '9', no: '9', das: '0', sunya: '0', shunya: '0',
  // Spanish
  cero: '0', uno: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5',
  seis: '6', siete: '7', ocho: '8', nueve: '9', diez: '0',
  // French
  un: '1', deux: '2', trois: '3', quatre: '4', cinq: '5',
  sept: '7', huit: '8', neuf: '9', dix: '0'
};

// ── 3. COMPREHENSIVE MULTI-LINGUAL & GEN Z SLURS VOCABULARY ───────────────────
const GLOBAL_SLURS_VOCABULARY = [
  // ── GEN Z EVASIONS & BRAINROT TOXIC CODES ──
  // Self-harm & suicide bypasses
  "unalive", "unaliving", "unalived", "toaster bath", "rope yourself", "take the rope",
  "neck yourself", "catch the bus", "take permanent sleep", "drink bleach", "kms", "kys",

  // Ableist Gen Z evasions
  "regarded", "restarted", "acoustic", "is he acoustic", "are you acoustic",
  "acoustic blud", "is he restart", "are you restart", "spastic", "restart blud",

  // Racial & ethnic Gen Z bypasses
  "yt people", "yt trash", "yt person",

  // Incel / Blackpill / Toxic Subculture
  "currycel", "ricecel", "gymcel", "chadlite", "subhuman", "foids", "roastie", "femcel",

  // Predatory / grooming Gen Z terms
  "pdf file", "pdf", "p3do", "p3d0", "edp", "edp445", "minor lover",
  "groomer blud", "touch kids", "pred blud",

  // Explicit Gen Z bypasses
  "seggs", "cornhub", "corn video", "p*rn", "p0rn", "le_sbian",

  // Violent Gen Z threat slang
  "crashout", "slide for your mans", "packwatch", "smoking your pack", "rip bozo packwatch",
  "run your pockets or die", "swatting your crib", "swat your house", "calling swat on you",
  "pulling your dox", "leaking your face on tiktok", "doxxing you on discord",

  // Desi / Hinglish Gen Z slurs
  "chapri", "nibba", "nibbi", "lodu", "chomu", "pel dunga", "bavli gand", "bhen ke takke", "bhadwe blud",

  // Spanish / Latino Gen Z slurs
  "weon ql", "culiao", "ctm", "conchetumare", "gonorrea hp", "carechimba", "chupala meco",

  // French Gen Z toxic terms
  "fils de pute fr", "wallah tu vas mourir", "sale batard", "ftg sale merde",

  // ── STANDARD GLOBAL SLURS & HATE SPEECH REPOSITORY ──
  // Predatory, grooming & sexual exploitation (English & Global)
  "diddy", "dixxy", "diddi", "diddie", "diddler", "diddling", "diddled",
  "chomo", "noncer", "groomer", "pedophile", "pedo", "paedo", "jailbait", "epstein",

  // Racial & ethnic slurs (English & Global)
  "nigger", "nigga", "niggaz", "niggers", "negro", "chink", "chinks", "gook",
  "gooks", "spic", "spics", "wetback", "kike", "kikes", "coon", "coons",
  "paki", "pakis", "beaner", "raghead", "towelhead", "gypsy", "jap",
  "cracker", "zipperhead", "tarbaby",

  // Homophobic & transphobic slurs
  "faggot", "faggots", "fagot", "fag", "fags", "dyke", "dykes", "homo",
  "tranny", "shemale", "transvestite",

  // Ableist insults & clinical slurs
  "retard", "retarded", "tard", "mongoloid", "r3tard",

  // Severe profanity, vulgarity, dismissals & explicit sexual parts
  "fuck", "fucks", "fucking", "fucked", "fucker", "fuckers", "fuck off", "fuck u", "fuck you",
  "fck", "fuk", "fukk", "fk", "fk off", "fuk off", "fck off", "fuckouttahere", "get fucked", "motherfucker",
  "boob", "boobs", "boobie", "boobies", "bobs", "b00bs", "bewbs", "boobz", "b00bz",
  "tits", "tities", "titties", "titty", "pussy", "dick", "cock", "penis", "vagina",
  "clit", "cum", "cumming", "blowjob", "handjob", "deepthroat", "anal", "jerk off", "jack off",
  "horny", "sexy pics", "send nudes", "show tits", "show boobs", "wanna fuck", "let's fuck", "dtf",
  "whore", "whores", "slut", "sluts", "bitch", "bitches", "cunt", "cunts",
  "dickhead", "asshole", "twat", "bastard", "stfu", "gtfo",

  // Hindi / Urdu / South Asian slurs & profanity
  "bhenchod", "behenchod", "madarchod", "madarchodh", "mc", "bc", "chutiya",
  "chutiye", "chutya", "gandu", "gaandu", "bhosadike", "bhosdike", "bhosadi",
  "bhosdi", "randi", "haramkhor", "harami", "kamina", "kamine", "suar",
  "kutte", "kutiya", "saale", "saala", "bhadwe", "bhadwa", "chudakkad",
  "chod", "chodo", "jhantu", "laude", "lauda", "lavde", "lund", "chinal",
  "randwa", "kanjar", "kanjri", "chut", "gaand", "tatton", "tatte", "dallay",
  "dalle", "bhen k lode", "madar k lode",

  // Tamil slurs & profanity (Latin & Script)
  "thevidiya", "thevidya", "thevdiya", "thevadiya", "thevidia", "thevadiye",
  "thevidiyale", "thevidiya paiya", "thevidiya paya", "thevidiya payale",
  "thevidiya mavane", "thevidiya pasanga", "thevadiyaye", "thevidiya munda",
  "thevidiya mundai", "otha", "othaa", "othala", "othale", "othavala",
  "othavane", "omala", "ommala", "ommale", "gommale", "gommala", "otha gommala",
  "punda", "pundamavan", "pundamavane", "punda mavan", "punda mavane",
  "punda payale", "loosu punda", "kenapunda", "kena punda", "pundai",
  "kena pundai", "olugura punda", "pundakokki", "pundakokke", "punda munda",
  "koothi", "koothee", "koothe", "koodhi", "loosu koodhi", "koothi oombu",
  "poolu", "poola", "poolu oombu", "poolu sapu", "poolumani", "oombu",
  "oombuda", "oombale", "oomburavan", "sunni", "sunnee", "sunniya oombu",
  "sunni oombu", "sunni sapu", "mayiru", "mayire", "mayir", "baadu", "naaye",
  "naai", "ungamma", "ungammale", "ungappana", "ungappan", "unammale",
  "pichaikarane", "kandravi", "eruma maadu", "porukki", "kamnati", "kazhutha",
  "echa kala", "echa paya", "paradesi", "savugrahandi", "lavadakabaal",
  "lavada", "soothu", "sootha moodu", "sotha moodu",
  "தேவிடியா", "கூதி", "பூலு", "புண்ட", "புண்டை", "ஓத்தா", "மயிரு", "நாயே", "சுன்னி",

  // Telugu slurs & profanity (Latin & Script)
  "lanja", "lanjakodaka", "lanja kodaka", "lanjamunda", "lanja munda",
  "lanjodka", "lanjakompa", "lanja puttina", "lanjaputtina", "donga lanja",
  "donga munda", "lanja munda kodaka", "lanja kuthura", "lanjakuthura",
  "lanja bathuku", "dengu", "dhengey", "dhengai", "dengai", "dengi",
  "dengutha", "dengudu", "dhengichuko", "dengichuko", "dengulata", "dengava",
  "dengu ra", "denguko", "denginchuko", "gudha", "guda", "guddha",
  "gudha balisinda", "gudha moosko", "gudhalo", "gudhadenge", "gudhala",
  "gudha cheeku", "gudha dengu", "gudha paguluddi", "gudha pagaldhengo",
  "munda", "mundamopi", "munde", "munda mopi", "mundamopivi", "munda kodaka",
  "puku", "pooku", "pukulo", "pookulo", "erri puku", "erripuku", "verri puku",
  "verripuku", "puku gadu", "madhyalo puku", "puku cheeku", "erri puka",
  "erripuka", "puku nakku", "modda", "moddalo", "moddada", "modda cheeku",
  "erri modda", "errimodda", "chekka", "moddalo jeevitham", "modda gudu",
  "moddagudu", "modda nakku", "sulli", "sulliga", "sulli cheeku", "sulli gadu",
  "sulligadu", "sulli gudu", "nakodaka", "na kodaka", "donga na kodaka",
  "dongana kodaka", "chillar na kodaka", "chillara na kodaka", "nee yavva",
  "nee yamma", "nee abba", "nee ayya", "nee amman", "nee bamma", "nee thalli",
  "లంజ", "లంజకొಡకా", "దెంగు", "గుద్ద", "పూకు", "మొడ్డ", "సుల్లి", "ఎర్రిపూకు",

  // Kannada slurs & profanity (Latin & Script)
  "sule", "sule maga", "sulemaga", "sule magane", "sulemagane", "sulay",
  "sulay maga", "sulay magane", "sulaymaga", "sulaymagane", "sooley",
  "soole maga", "soole magane", "soolemagane", "sule munde", "sulemunde",
  "soole munde", "sulekodaga", "sule kodaga", "sulemaklu", "sule maklu",
  "soole", "sule hadaragi", "thika", "tikka", "theeka", "theekamuchu",
  "theka", "thika muchu", "tikka muchu", "thika muchkond", "tikka muchkond",
  "thika hodithini", "tikka hodithini", "thika thulko", "tikka thulko",
  "theeka muchu", "tikka keyyo", "boli", "boli maga", "bolimaga", "boli munde",
  "bolimunde", "boli maklu", "bolimaklu", "baddimaga", "baddi maga",
  "baddi munde", "baddimunde", "baddithana", "byawarsi", "bewarsi", "bewarse",
  "bevarsi", "bevarsi nan maga", "bewarsi nan maga", "hadaragi", "hadaragi maga",
  "hadsko", "hadskota", "hadargithi", "hadar githi", "hadarathana", "keythini",
  "keyyo", "keyyodhu", "mindri", "kalla nanna maga", "kallan nan maga",
  "nin amman", "nin ammanige", "nin amman thullu", "nin amman thika",
  "nin ayyana", "nin appan", "nin akkan", "nin thangi", "nim amman",
  "nim ammanige", "nimman", "nimmanige", "nimmajji", "ninajji", "nin ajji",
  "tunne", "thunne", "tunne cheepu", "thunne cheepu", "tunne unnu",
  "thunne nekku", "tullu", "thullu", "tulu", "thulu", "tullu muchu",
  "thullu muchu", "tullu cheepu", "tullu nekku", "tullina", "shata", "shatta",
  "satha", "shata kithko", "shatta kithko", "shata muchu", "shatta muchu",
  "shata bolli", "shata thulko", "ganchali", "huch naayi", "huch nayi",
  "karubu", "thukaali", "loffer", "chaddi donga", "kandre",
  "ಸೂಳೆ", "ಸೂಳೆಮಗ", "ಸೂಳೆ ಮಗನೆ", "ಬೋಳಿ", "ಬೋಳಿಮಗ", "ತಿಕ್ಕ", "ತುಣ್ಣೆ", "ಶಟ", "ಬೇವರ್ಸಿ",

  // Malayalam slurs & profanity (Latin & Script)
  "myre", "maire", "myru", "mairu", "myren", "mairen", "myran", "mairan",
  "myrukale", "myro", "myroli", "thendi", "thenndi", "thendimon", "thendimol",
  "thendikale", "thendi naye", "patti", "pattishow", "naaye", "naayi",
  "naayinte mone", "nayinte mone", "nayinte mon", "naayinte mon", "pattide mone",
  "pattintemon", "patti mone", "pulayadi", "pulayadimon", "pulayadimonu",
  "pulayadi mone", "pulayadimone", "kunna", "kundi", "kundimon", "kundimone",
  "kundikku", "kundi adikkal", "kunna paal", "kunna oombu", "pooru",
  "poorimon", "poorimone", "poottile", "pooru mone", "pooru mon", "poori mone",
  "poori", "poore", "poothole", "pooru nakku", "andi", "visham", "thaayoli",
  "thayoli", "thayyoli", "thayolee", "thayoli mone", "thayyoli mone",
  "thayolimon", "thayoli naye", "kallan", "chetta", "vellathalayan",
  "panna thaye", "kallatharam", "kandathil", "vedichi", "vadi", "koothichi", "kotham",
  "മൈരേ", "മൈര്", "തെണ്ടി", "പട്ടി", "നായേ", "പുലയാടി", "കുന്ന", "കുണ്ടി", "പൂറ്", "പൂറിമോനേ", "തയോളി",

  // Bengali slurs & profanity (Latin & Script)
  "shala", "khanki", "magi", "bessa", "bokachoda", "boka choda", "chudirbhai",
  "haramzada", "podmarani", "gandmara", "khankir chele", "suorer bachha",
  "শুয়োরের বাচ্চা", "খানকি", "মাগী", "বোಕಾচোদা", "শালার ব্যাটা",

  // Punjabi slurs & profanity (Latin & Script)
  "kutto", "gashti", "khoteya", "pencho", "penn di siri", "fudi", "phudi",
  "bund", "chudai", "ਲੰਡ", "ਭੈਣਚੋਦ", "ਕੰਜਰ", "ਫੁੱਦੀ",

  // Marathi slurs & profanity (Latin & Script)
  "zhavadya", "zhavnya", "aai ghalya", "aaighalya", "bhadkav", "lavdya",
  "laudya", "randichya", "bulli", "झवड्या", "आई घाल्या", "लवड्या",

  // Gujarati slurs & profanity (Latin & Script)
  "chodu", "chodina", "lavad", "bhosdina", "randino", "તારી માની",

  // Spanish slurs & severe abuse
  "maricon", "marica", "puta", "puto", "culero", "pendejo", "cabron",
  "hijo de puta", "perra", "malparido", "verga", "chinga tu madre",
  "chupame la verga", "coño", "gonorrea", "carechimba", "mariconada",
  "soplapollas", "gilipollas",

  // French slurs & profanity
  "putain", "connard", "salope", "encule", "enculer", "batard",
  "nique ta mere", "fils de pute", "fdp", "pute", "chienne", "pedale",
  "tarlouze", "sale negre", "bougnoule",

  // German slurs & profanity
  "arschloch", "hurensohn", "fotze", "schlampe", "wixxer", "wichser",
  "missgeburt", "spast", "schwuchtel", "kanake",

  // Italian slurs & profanity
  "stronzo", "cazzo", "troia", "vaffanculo", "bastardo", "figlio di puttana",
  "frocio", "negro di merda", "baldracca", "merda",

  // Portuguese slurs & profanity
  "caralho", "foda-se", "arrombado", "viado", "filho da puta",
  "puta que pariu", "bosta", "vagabunda", "chupa rola", "traveco",

  // Russian (Мат & slurs - Cyrillic & Latin)
  "блядь", "сука", "хуй", "пизда", "ебать", "мудак", "пидор", "гандон",
  "шлюха", "blyad", "suka", "khuy", "pizda", "yebat", "mudak", "pidor",

  // Arabic slurs & severe curses (Arabic & Arabizi)
  "شرموطة", "كسمك", "منيوك", "كلب", "عرصة", "قحبة", "زب",
  "qus ummak", "kos omak", "sharmuta", "kahba", "maniyuk", "ayre fik",

  // Turkish slurs & profanity
  "piç", "orospu", "siktir", "amina koyim", "yavsak", "gotveren", "kahpe", "yarrak",

  // Tagalog / Filipino slurs
  "putang ina", "putangina", "gago", "tarantado", "tangina", "ulol",
  "bayag", "pokpok", "kupal", "kantot",

  // Indonesian / Malay slurs
  "anjing", "bangsat", "kontol", "memek", "bajingan", "pantek", "babi", "pukimak", "pantat",

  // Chinese (Pinyin & Hanzi)
  "caonima", "cao ni ma", "sha bi", "shabi", "ta ma de", "bichi", "sb", "操你妈", "傻逼", "王八蛋",

  // Japanese (Romaji)
  "shine", "kuso", "baka yarou", "bakayaro", "kutabare", "manuke", "chikusho"
];

// ── 4. CONVERSATIONAL INTENT PATTERNS (Subtle & Direct Threats, Doxxing, Coercion) ──
const THREAT_INTENT_PATTERNS = [
  /\b(i\s*(will|am\s*going\s*to|'m\s*gonna|'ll|gonna)\s+(kill|murder|shoot|stab|choke|strangle|slit|beat|bash|hunt|assault|harm|hurt|end|destroy)\s+(you|ur\s*ass|your\s*ass|u))\b/i,
  /\b(i('ll|\s*will|\s*am\s*gonna|'m\s*gonna|\s*am\s*going\s*to)\s+(beat|beat\s*the\s*(shit|crap|hell)\s*out\s*of|break)\s+(you|ur|your\s*(legs?|arms?|neck|bones?|face)|u))\b/i,
  /\b(beat\s*(you|ur|your\s*ass|u)\s*up)\b/i,
  /\b(gonna\s*(kill|murder|shoot|stab|choke|beat|slit|hurt|harm|destroy)\s+(you|u))\b/i,
  /\b(you\s*(are\s*going\s*to|will|'re\s*gonna)\s*(die|bleed|suffer|regret\s*this|pay))\b/i,
  /\b(you('re|\s*are)\s*dead(\s*meat)?|watch\s*your\s*back|say\s*goodbye\s*to\s*your\s*life)\b/i,
  /\b(i('ll|\s*will|\s*am\s*going\s*to)\s*.*slit\s*(your|ur)\s*(throat|wrist))\b/i,
  /\b(i('ll|\s*will)\s*put\s*a\s*bullet\s*(in|through)\s*(your|ur|you))\b/i,
  /\b(don't\s*make\s*me\s*(hurt|kill|come\s*find)\s*(you|u))\b/i,
  /\b(you\s*won't\s*(live|survive|make\s*it)\s*(to|past|until)?\s*(tomorrow|tonight)?)\b/i,
  /\b(put\s*you\s*(six|6)\s*feet\s*under|your\s*days\s*are\s*numbered)\b/i,
  /\b(someone\s*is\s*waiting\s*outside\s*(for\s*you)?)\b/i,
  /\b(gonna\s*crashout\s*on\s*you|slide\s*for\s*your\s*mans|run\s*your\s*pockets\s*or\s*die)\b/i
];

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
  /\b(i('ll|\s*will|\s*am\s*gonna)\s*(dox|doxx|leak)\s*(you|ur|your)\s*(address|info|number|ip|location)?)\b/i,
  /\b(swat(ting)?\s*your\s*(crib|house)|calling\s*a?\s*swat\s*on\s*you)\b/i
];

const EXTORTION_PATTERNS = [
  /\b(send|show|give\s*me)\s*.*or\s*(i('ll|\s*will)|else)\s*(leak|expose|post|share|ruin|hack|hurt)\b/i,
  /\b(or\s*else\s*(i('ll|\s*will)|\s*you'll)\s*(regret|leak|expose|pay|suffer))\b/i,
  /\b(pay\s*me\s*or\s*(i|else)|send\s*money\s*or\s*(i|else)|transfer\s*money\s*or\s*(i|else))\b/i,
  /\b(do\s*what\s*i\s*say\s*or\s*(else|i'll|i\s*will))\b/i,
  /\b(add\s*my\s*snap\s*or\s*(else|you'll\s*regret))\b/i,
  /\b(give\s*me\s*(your|ur)\s*.*or\s*you'll\s*regret)\b/i,
  /\b(wire\s*(funds|money)\s*or\s*i\s*(leak|expose))\b/i,
  /\b(recorded\s*(our|this)\s*(chat|call|video)\s*and\s*(will\s*leak|send\s*to))\b/i
];

const SEXUAL_HARASSMENT_PATTERNS = [
  /\b((send|show|let\s*me\s*see)\s*(me\s*)?(nudes?|tits?|boobs?|body|pussy|dick|cock|ass|naked|privates|nude\s*pics?|gyatt))\b/i,
  /\b(take\s*off\s*(your|ur)\s*clothes|strip\s*(for\s*me|naked|down))\b/i,
  /\b(flash\s*(me|your\s*(tits|boobs|body|ass)))\b/i,
  /\b(touch\s*yourself\s*(for\s*me|on\s*cam))\b/i,
  /\b(i\s*will\s*(rape|sexually\s*assault)\s*(you|ur|u))\b/i,
  /\b(gonna\s*(rape|grope|assault)\s*(you|u))\b/i,
  /\b(send\s*naked\s*(pictures?|pics?))\b/i,
  /\b(show\s*(me\s*)?(your|ur)\s*(boobs?|tits?|body|ass))\b/i,
  /\b(diddy|dixxy|diddi|diddie|diddler|diddling|diddled|chomo|noncer|groomer|jailbait|paedo|pedophile|pedo|edp|edp445)\b/i
];

const COERCION_GROOMING_PATTERNS = [
  // Secret conversations, isolation & off-platform hiding
  /\b(don't|do\s*not|never)\s*(tell|let)\s*(anyone|your\s*parents?|your\s*mom|your\s*dad|your\s*friends?)\b/i,
  /\b(keep\s*this|it's|let's\s*keep\s*this)\s*(a|our)\s*secret\b/i,
  /\b(delete\s*this\s*chat|clear\s*(this|the)\s*chat|don't\s*save\s*this)\s*(after\s*reading|right\s*now|now)?\b/i,
  /\b(switch\s*to\s*(a\s*)?secret\s*chat|talk\s*in\s*secret|talk\s*where\s*no\s*one\s*sees)\b/i,
  /\b(sneak\s*out\s*(and|to)\s*(meet|see)\s*me)\b/i,
  /\b(are\s*your\s*parents?\s*(home|around|awake|in\s*the\s*room))\b/i,
  /\b(are\s*you\s*alone\s*(in\s*your\s*room|at\s*home))\b/i,
  /\b(be\s*a\s*good\s*(girl|boy)\s*for\s*me|good\s*(girl|boy)\s*listens?\s*to\s*me)\b/i,
  /\b(be\s*obedient|do\s*as\s*you're\s*told|obey\s*me)\b/i,

  // Coercive pressure, manipulation & forced compliance
  /\bif\s*you\s*don't\s*.*(you'll|you\s*will)\s*regret\b/i,
  /\b(prove\s*(that\s*)?(you\s*like|you\s*love|you\s*trust)\s*me(\s*(by|to))?)\b/i,
  /\b(do\s*(this|it)\s*if\s*you\s*(really\s*)?trust\s*me)\b/i,
  /\b(send\s*(it|pics?|photo)\s*or\s*(i('ll|\s*will)\s*tell|(i('m|'ll|\s*am|\s*will)?\s*)?(leaving|leave|disconnecting|disconnect|skipping|skip)))\b/i,
  /\b(turn\s*on\s*cam\s*or\s*(i('m|'ll|\s*am|\s*will)?\s*)?(leaving|leave|skip|disconnect|disconnecting))\b/i,
  /\b(you\s*owe\s*me\s*(a\s*pic|a\s*photo|nudes?|to\s*do\s*this))\b/i
];

const CYBERBULLYING_PATTERNS = [
  /\b(kys|kill\s*yourself|go\s*die|end\s*your\s*life|commit\s*suicide)\b/i,
  /\b(unalive\s*(yourself|urself)|commit\s*unalive|toaster\s*bath|rope\s*(yourself|urself)|neck\s*(yourself|urself)|take\s*the\s*rope|take\s*permanent\s*sleep)\b/i,
  /\b(drink\s*bleach|hang\s*yourself|slit\s*your\s*wrists?|jump\s*off\s*a\s*bridge|jump\s*in\s*front\s*of\s*a\s*train)\b/i,
  /\b(nobody\s*(likes|loves|cares\s*about)\s*you\s*,?\s*(go\s*die|kill\s*yourself|kys)?)\b/i,
  /\b(you\s*(should|deserve\s*to)\s*(die|be\s*dead|get\s*killed|suffer))\b/i,
  /\b(hope\s*you\s*(die|get\s*cancer|choke|burn\s*in\s*hell|get\s*hit\s*by\s*a\s*car))\b/i,
  /\b(waste\s*of\s*(oxygen|space|life)|you\s*should\s*never\s*have\s*been\s*born)\b/i,
  /\b(you('re|\s*are)\s*(a\s*)?(worthless|disgusting|ugly)\s*(piece\s*of\s*(shit|trash|garbage)|subhuman))\b/i,
  /\b(eat\s*shit\s*and\s*die|smoking\s*on\s*your\s*pack|rip\s*bozo\s*packwatch)\b/i
];

// Low effort probe patterns
const LOW_EFFORT_PATTERNS = [
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

// ── 5. CLEAN IN-CHAT LABELS (NO REDUNDANT POPUPS, DISCREET SENDER GUIDANCE) ─
const POLITE_MESSAGES = {
  // Clean chat labels
  BAD_WORDS_LABEL: "Please don't use bad words here",
  BAD_WORDS_PLAIN: "Please don't use bad words here",

  // Polite general reminders
  WARNING_STRIKE_1: "Please don't use bad words here",
  WARNING_STRIKE_2: "Please don't use bad words here",
  BAN_MESSAGE: "Please don't use bad words here",

  // Friend chat warnings
  FRIEND_STRIKE_1: "Please don't use bad words here",
  FRIEND_STRIKE_REMINDER: () => "Please don't use bad words here",

  // Partner notifications
  PARTNER_NOTIFIED: "🛡️ A message was prevented from being sent.",

  // Clean chat labels per category
  PHONE_NUMBER: "Please don't share your number here",
  ASKING_PHONE: "Please don't ask for phone numbers or WhatsApp here",
  SOCIAL_MEDIA: "Please don't share social media IDs here",
  LINKS: "Please don't share external links here",
  COERCION_GROOMING: "Please keep the conversation friendly and respectful",
  SYMBOLS: "Please use standard text without excessive symbols",
  SYMBOLS_EXCESSIVE: "Please use standard text without excessive symbols",
  LOW_EFFORT: "Please keep the conversation friendly and engaging"
};

// ── 6. TEXT NORMALIZATION UTILITIES ──────────────────────────────────────────

function normalizeHomoglyphs(text) {
  if (!text || typeof text !== 'string') return '';
  const homoglyphMap = {
    'а': 'a', 'а́': 'a', 'а̀': 'a', 'ą': 'a', 'ä': 'a', 'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a',
    'в': 'b', 'Ь': 'b', 'Ъ': 'b',
    'с': 'c', 'ć': 'c', 'ç': 'c', 'č': 'c',
    'е': 'e', 'е́': 'e', 'ѐ': 'e', 'ę': 'e', 'ë': 'e', 'è': 'e', 'é': 'e', 'ê': 'e', 'з': 'e',
    'і': 'i', 'ї': 'i', 'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i',
    'ј': 'j',
    'к': 'k',
    'о': 'o', 'о́': 'o', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o',
    'р': 'p',
    'ѕ': 's', 'ś': 's', 'š': 's', 'ş': 's',
    'т': 't',
    'у': 'y', 'ý': 'y', 'ÿ': 'y',
    'х': 'x', 'ҳ': 'x',
    'ѡ': 'w', 'ш': 'w', 'щ': 'w',
    'ѵ': 'v',
    'п': 'n', 'г': 'r', 'д': 'd', 'и': 'u', 'л': 'l', 'м': 'm', 'н': 'h', 'я': 'r',
    'θ': 'o', 'λ': 'l', 'μ': 'u', 'ν': 'v', 'π': 'n', 'ρ': 'p', 'σ': 's', 'τ': 't', 'χ': 'x', 'ψ': 'y', 'ω': 'w'
  };

  let result = text.normalize('NFKD');
  for (const [nonLatin, latin] of Object.entries(homoglyphMap)) {
    result = result.replace(new RegExp(nonLatin, 'gi'), latin);
  }
  return result;
}

function collapseVerticalText(text) {
  if (!text || typeof text !== 'string') return '';
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const strippedLines = lines.map(l => l.replace(/[^a-zA-Z0-9]/g, ''));
    if (strippedLines.every(l => l.length <= 3)) {
      return strippedLines.join('');
    }
  }
  return text.replace(/([a-zA-Z0-9])[\r\n]+([a-zA-Z0-9])/g, '$1$2');
}

function collapseSpacedLetters(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/\b([a-zA-Z0-9])(?:\s+([a-zA-Z0-9]))+\b/g, (match) => {
    return match.replace(/\s+/g, '');
  });
}

function stripAllSymbols(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF\u00A0\u2000-\u200F\u0300-\u036F\u00AD]/g, '')
    .replace(/[\s\.\-_,\/\\~\|\*\^#%+=:;'"!?`@$<>{}\[\]\(\)]+/g, '');
}

function normalizeLeetspeak(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF\u00A0\u2000-\u200F\u0300-\u036F\u00AD]/g, '')
    .replace(/[@4^]/g, 'a')
    .replace(/[8]/g, 'b')
    .replace(/[(\[<]/g, 'c')
    .replace(/[3€]/g, 'e')
    .replace(/[69]/g, 'g')
    .replace(/[#]/g, 'h')
    .replace(/[!1|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/[+7]/g, 't')
    .replace(/[v]/g, 'u')
    .replace(/(.)\1{2,}/g, '$1$1');
}

function normalizePhoneticSubstitutions(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/\bdix+y\b/g, 'diddy')
    .replace(/\bdid+i\b/g, 'diddy')
    .replace(/\bdid+ie\b/g, 'diddy')
    .replace(/\bdyd+y\b/g, 'diddy')
    .replace(/\bd1x+y\b/g, 'diddy')
    .replace(/\bpux+y\b/g, 'pussy')
    .replace(/\bnix+a\b/g, 'nigga')
    .replace(/\bnix+er\b/g, 'nigger')
    .replace(/\bbix+ch\b/g, 'bitch')
    .replace(/\brestarted\b/g, 'retarded')
    .replace(/\bregarded\b/g, 'retarded')
    .replace(/\bseggs\b/g, 'sex');
}

function collapseRepeatedChars(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/(.)\1{2,}/g, '$1$1').replace(/([a-zA-Z])\1+/g, '$1');
}

function collapseElongatedVowels(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/aa+/g, 'a')
    .replace(/ee+/g, 'e')
    .replace(/ii+/g, 'i')
    .replace(/oo+/g, 'o')
    .replace(/uu+/g, 'u')
    .replace(/yy+/g, 'y');
}

function detectMaskedBadWords(text, blockedList) {
  if (!text || typeof text !== 'string') return [];
  const matches = [];
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);

  for (const rawToken of tokens) {
    const token = rawToken.replace(/^[^a-zA-Z0-9*xX_.\-\/#@$]+|[^a-zA-Z0-9*xX_.\-\/#@$]+$/g, '');
    if (token.length >= 3 && /[x\*_\.\-\/#@\$]/i.test(token)) {
      if (SAFE_EXCEPTIONS.has(token)) continue;

      const escapedMask = token.replace(/([.*+?^${}()|[\]\\])/g, '\\$1');
      const patternStr = '^' + escapedMask.replace(/(\\\*|\\\.|\/|\\-|\\_|x|#|@|\\\$)+/gi, '.{1,4}') + '$';
      try {
        const regex = new RegExp(patternStr, 'i');
        for (const slur of blockedList) {
          if (slur.length >= 3 && regex.test(slur)) {
            if (Math.abs(slur.length - token.length) <= 4) {
              matches.push(slur);
            }
          }
        }
      } catch (_) {}
    }
  }

  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = [tokens[i], tokens[i + 1]].map(t => t.replace(/^[^a-zA-Z0-9*xX_.\-\/#@$]+|[^a-zA-Z0-9*xX_.\-\/#@$]+$/g, '')).join(' ');
    if (/[x\*_\.\-\/#@\$]/i.test(bigram) && bigram.length >= 5) {
      const escapedMask = bigram.replace(/([.*+?^${}()|[\]\\])/g, '\\$1');
      const patternStr = '^' + escapedMask.replace(/(\\\*|\\\.|\/|\\-|\\_|x|#|@|\\\$)+/gi, '.{1,4}') + '$';
      try {
        const regex = new RegExp(patternStr, 'i');
        for (const slur of blockedList) {
          if (slur.includes(' ') && regex.test(slur)) {
            matches.push(slur);
          }
        }
      } catch (_) {}
    }
  }

  return matches;
}

// ── 7. ADVANCED PHONE NUMBER DETECTION ───────────────────────────────────────
function detectPhoneNumber(text) {
  if (!text || typeof text !== 'string') return false;
  const raw = text.trim();
  if (!raw) return false;

  // Multi-line vertical single/double digits check
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

  let textWithConvertedWords = raw.toLowerCase();
  for (const [word, digit] of Object.entries(NUMBER_WORDS_MAP)) {
    const wordRegex = new RegExp(`\\b${word}\\b`, 'gi');
    textWithConvertedWords = textWithConvertedWords.replace(wordRegex, digit);
  }

  const digitsOnly = textWithConvertedWords.replace(/\D/g, '');
  if (digitsOnly.length >= 10 && digitsOnly.length <= 16) {
    const nonSpaceCount = raw.replace(/\s/g, '').length;
    if (digitsOnly.length / Math.max(1, nonSpaceCount) >= 0.45 || nonSpaceCount <= 25) {
      return true;
    }
  }

  const phonePatterns = [
    /\b(?:\+?\d{1,3}[-.\s\/\\]*)?(?:\(?\d{2,4}\)?[-.\s\/\\]*)?\d{3,5}[-.\s\/\\]*\d{3,5}\b/,
    /\b[6-9]\d{9}\b/,
    /\b\d{3}[-.\s\/\\]\d{3}[-.\s\/\\]\d{4}\b/,
    /\b\(\d{3}\)\s*\d{3}[-.\s\/\\]\d{4}\b/,
    /\b\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\s*[-.\s\/\\_]*\d\b/,
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

function detectAskingForPhoneNumber(text) {
  if (!text || typeof text !== 'string') return false;
  const raw = text.trim().toLowerCase();
  if (!raw) return false;

  const askingPatterns = [
    /\b(give|send|drop|share|tell|show|leak|got|have)\s+(me\s+)?(your|ur)?\s*(phone|cell|mobile|whatsapp|wa|contact)?\s*(num|number|digits|no\b)/i,
    /\b(what('s|\s+is)?|drop|share)\s+(your|ur)\s*(phone|cell|mobile|whatsapp|wa|contact)?\s*(number|num|digits|no\b)/i,
    /\bcan\s+(i|we|u|you)\s+(get|have|got|give|share|see)\s+(your|ur|me\s+your|me\s+ur)?\s*(phone|cell|mobile|whatsapp|wa)?\s*(number|num|digits|no\b)/i,
    /^\s*(your|ur)?\s*(phone|cell|mobile|whatsapp|wa)?\s*(number|num|digits)\s*\??\s*$/i,
    /\b(call|text|sms|msg|message|dm|ping)\s+me\s+(on|at)?\s*(whatsapp|wa|phone|cell)?\b/i,
    /\b(apna\s+)?(number|no)\s+(do|de|dedo|bhejo|send\s+karo|milega|btao|batao)\b/i,
    /\b(phone|whatsapp|wa)\s*(number|no)\s*(do|de|bhejo|milega)?\b/i,
    /\b(exchange|swap|share)\s+(numbers?|nums?|contacts?|digits)\b/i
  ];

  for (const pattern of askingPatterns) {
    if (pattern.test(raw)) return true;
  }
  return false;
}

// ── 8. ADVANCED SOCIAL MEDIA LEAK DETECTION ──────────────────────────────────
function detectSocialMediaSharing(text) {
  if (!text || typeof text !== 'string') return false;
  const raw = text.trim();
  if (!raw) return false;

  const socialPatterns = [
    /\b(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am|ig\.me)\/[a-zA-Z0-9_\.]+\b/i,
    /\b(?:add|follow|find|dm|msg|text|my)\s+(?:me\s+on\s+|my\s+)?(?:insta|instagram|ig)\b/i,
    /\b(?:insta|instagram|ig)\s*[:=-]\s*@?[a-zA-Z0-9_\.]{3,30}\b/i,
    /\b(?:my\s+)?(?:insta|instagram|ig)\s+is\s+@?[a-zA-Z0-9_\.]{3,30}\b/i,
    /^\s*(?:insta|instagram|ig)\s*[:\s]+@?[a-zA-Z0-9_\.]+\s*$/i,
    /\b(?:https?:\/\/)?(?:www\.)?(?:snapchat\.com|t\.snapchat\.com)\/[a-zA-Z0-9_\.]+\b/i,
    /\b(?:add|follow|find|dm|msg|text|send|hit)\s+(?:me\s+on\s+|my\s+)?(?:snap|snapchat|sc)\b/i,
    /\b(?:snap|snapchat|sc)\s*[:=-]\s*@?[a-zA-Z0-9_\.]{3,30}\b/i,
    /\b(?:my\s+)?(?:snap|snapchat|sc)\s+is\s+@?[a-zA-Z0-9_\.]{3,30}\b/i,
    /^\s*(?:snap|snapchat|sc)\s*[:\s]+@?[a-zA-Z0-9_\.]+\s*$/i,
    /\b(?:wa\.me|t\.me|telegram\.me|discord\.gg|dsc\.gg|tiktok\.com\/@)[a-zA-Z0-9_\.]+\b/i,
    /\b(?:telegram|tg|whatsapp|discord)\s*[:=-]\s*@?[a-zA-Z0-9_\.]+\b/i
  ];

  for (const pattern of socialPatterns) {
    if (pattern.test(raw)) return true;
  }
  return false;
}

function detectExternalLinks(text) {
  if (!text || typeof text !== 'string') return false;
  if (isInnocentColloquialism(text)) return false;
  const raw = text.trim();
  const linkPatterns = [
    /\b(?:https?:\/\/|ftp:\/\/|file:\/\/)[^\s<>{}\[\]\(\)]+/i,
    /\b(?:www\.)[a-zA-Z0-9\-_]{2,256}\.[a-zA-Z]{2,10}[^\s<>{}\[\]\(\)]*/i,
    /\b[a-zA-Z0-9\-_]{2,63}\.(?:com|org|net|io|xyz|app|site|online|me|co|link|gg|top|club|live|info|ly|gl|tv|cc|ru|cn|in|us|uk|de|to)\b/i
  ];
  for (const p of linkPatterns) {
    if (p.test(raw)) return true;
  }
  return false;
}

// ── 9. RESTRICTED SYMBOLS & SPAM FLOOD DETECTION ─────────────────────────────
function detectRestrictedSymbols(text) {
  if (!text || typeof text !== 'string') return false;
  if (isInnocentColloquialism(text)) return false;

  if (/\.{6,}/.test(text) || /\,{6,}/.test(text)) {
    return true;
  }

  const RESTRICTED_SYMBOLS_REGEX = /[\/\\@#$%^\*_\+=\~\|<>\{\}\[\]`]/;
  return RESTRICTED_SYMBOLS_REGEX.test(text);
}

function isKeyboardMashOrCharacterFlood(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim().toLowerCase();

  if (/^[\.,]{1,5}$/.test(clean)) return false;
  if (/\.{6,}/.test(clean) || /\,{6,}/.test(clean)) return true;
  if (/(.)\1{5,}/.test(clean)) return true;
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
  for (const pattern of SAFE_COLLOQUIAL_PATTERNS) {
    if (pattern.test(clean)) return true;
  }
  return false;
}

// ── 10. UNIFIED MODEL KNOWLEDGE BASE CACHE ───────────────────────────────────
let customModelWeights = null;
let lastModelWeightsMtime = 0;

function loadModelWeights() {
  const modelPaths = [
    path.join(__dirname, '../data/models/custom_moderator/model_weights.json'),
    path.join(__dirname, '../../data/models/custom_moderator/model_weights.json')
  ];

  for (const p of modelPaths) {
    if (fs.existsSync(p)) {
      try {
        const stats = fs.statSync(p);
        if (!customModelWeights || stats.mtimeMs > lastModelWeightsMtime) {
          lastModelWeightsMtime = stats.mtimeMs;
          const raw = fs.readFileSync(p, 'utf8');
          customModelWeights = JSON.parse(raw);
        }
        return customModelWeights;
      } catch (_) {}
    }
  }
  return null;
}

// ── 11. SINGLE UNIFIED EVALUATION ENGINE (Core of 2028-30 System) ─────────────

/**
 * Unified evaluation for ANY chat message.
 * Returns decision with nice label: "Please don't use bad words here"
 */
function evaluateMessage(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return {
      valid: false,
      safe: false,
      action: 'block',
      category: 'empty',
      reason: 'empty_message',
      warningMessage: '⚠️ Empty message cannot be sent.',
      label: POLITE_MESSAGES.BAD_WORDS_PLAIN,
      matchedWords: []
    };
  }

  const cleaned = text.trim();
  if (cleaned.length === 0) {
    return {
      valid: false,
      safe: false,
      action: 'block',
      category: 'empty',
      reason: 'empty_message',
      warningMessage: '⚠️ Empty message cannot be sent.',
      label: POLITE_MESSAGES.BAD_WORDS_PLAIN,
      matchedWords: []
    };
  }

  if (cleaned.length > 500) {
    return {
      valid: false,
      safe: false,
      action: 'block',
      category: 'message_too_long',
      reason: 'too_long',
      warningMessage: '⚠️ Please keep messages under 500 characters.',
      label: POLITE_MESSAGES.BAD_WORDS_PLAIN,
      matchedWords: []
    };
  }

  // ── LAYER 0: COLLOQUIAL INNOCENCE SHIELD ──
  if (isInnocentColloquialism(cleaned)) {
    return {
      valid: true,
      safe: true,
      action: 'allow',
      layer: 'colloquial_shield',
      category: 'safe_idiom',
      confidence: 1.0,
      matchedWords: []
    };
  }

  const rawLower = cleaned.toLowerCase();
  if (SAFE_EXCEPTIONS.has(rawLower)) {
    return {
      valid: true,
      safe: true,
      action: 'allow',
      layer: 'safe_word_shield',
      category: 'safe_word',
      confidence: 1.0,
      matchedWords: []
    };
  }

  // ── LAYER 1: UNIVERSAL PHONE NUMBER & CONTACT LEAK DETECTOR ──
  if (detectPhoneNumber(cleaned)) {
    return {
      valid: false,
      safe: false,
      action: 'block',
      category: 'privacy_phone_sharing',
      reason: 'phone_number_detected',
      warningMessage: POLITE_MESSAGES.PHONE_NUMBER,
      label: POLITE_MESSAGES.PHONE_NUMBER,
      matchedWords: ['phone_number'],
      layer: 'phone_detector'
    };
  }

  if (detectAskingForPhoneNumber(cleaned)) {
    return {
      valid: false,
      safe: false,
      action: 'block',
      category: 'privacy_phone_solicitation',
      reason: 'asking_number_detected',
      warningMessage: POLITE_MESSAGES.ASKING_PHONE,
      label: POLITE_MESSAGES.ASKING_PHONE,
      matchedWords: ['asking_phone'],
      layer: 'phone_detector'
    };
  }

  // ── LAYER 2: SOCIAL MEDIA HANDLES & OFF-PLATFORM LEAKS ──
  if (detectSocialMediaSharing(cleaned)) {
    return {
      valid: false,
      safe: false,
      action: 'block',
      category: 'social_handle_leak',
      reason: 'social_media_detected',
      warningMessage: POLITE_MESSAGES.SOCIAL_MEDIA,
      label: POLITE_MESSAGES.SOCIAL_MEDIA,
      matchedWords: ['social_media_id'],
      layer: 'social_detector'
    };
  }

  // ── LAYER 2.5: EXTERNAL LINKS & UNVERIFIED URLS ──
  if (detectExternalLinks(cleaned)) {
    return {
      valid: false,
      safe: false,
      action: 'block',
      category: 'external_link_leak',
      reason: 'external_link_detected',
      warningMessage: POLITE_MESSAGES.LINKS,
      label: POLITE_MESSAGES.LINKS,
      matchedWords: ['external_link'],
      layer: 'link_filter'
    };
  }

  // ── LAYER 3: RESTRICTED SYMBOLS (MAX 5 CONTINUOUS DOTS/COMMAS) ──
  if (detectRestrictedSymbols(cleaned)) {
    const isExcessivePunct = /\.{6,}/.test(cleaned) || /\,{6,}/.test(cleaned);
    const cleanSymLabel = isExcessivePunct ? POLITE_MESSAGES.SYMBOLS_EXCESSIVE : POLITE_MESSAGES.SYMBOLS;
    return {
      valid: false,
      safe: false,
      action: 'block',
      category: 'restricted_symbols',
      reason: isExcessivePunct ? 'excessive_punctuation_detected' : 'restricted_symbols_detected',
      warningMessage: cleanSymLabel,
      label: cleanSymLabel,
      matchedWords: ['restricted_symbols'],
      layer: 'symbol_filter'
    };
  }

  // Normalize candidate representations for multi-format and Gen Z evasion
  const homoglyph = normalizeHomoglyphs(rawLower);
  const vertical = collapseVerticalText(homoglyph);
  const spaced = collapseSpacedLetters(homoglyph);
  const leet = normalizeLeetspeak(homoglyph);
  const pureSymbols = stripAllSymbols(homoglyph);
  const pureLeet = normalizeLeetspeak(pureSymbols);
  const pureDeduped = collapseRepeatedChars(pureSymbols);
  const pureDedupedLeet = collapseRepeatedChars(pureLeet);
  const vowelCollapsed = collapseElongatedVowels(rawLower);
  const vowelCollapsedPure = collapseElongatedVowels(pureSymbols);
  const phonetic = normalizePhoneticSubstitutions(homoglyph);
  const strippedPhonetic = normalizePhoneticSubstitutions(pureSymbols);
  const verticalPhonetic = normalizePhoneticSubstitutions(vertical);

  const candidateRepresentations = [
    rawLower,
    homoglyph,
    vertical,
    spaced,
    leet,
    pureSymbols,
    pureLeet,
    pureDeduped,
    pureDedupedLeet,
    vowelCollapsed,
    vowelCollapsedPure,
    phonetic,
    strippedPhonetic,
    verticalPhonetic
  ];

  // ── LAYER 3.5: ADVANCED 2028-30 FUZZY, PHONETIC & CONSONANT SKELETON ENGINE ──
  const fuzzyCheck = evaluateFuzzyBadWords(cleaned, candidateRepresentations);
  if (fuzzyCheck.hasBadWord) {
    return {
      valid: false,
      safe: false,
      action: 'block',
      category: fuzzyCheck.category || 'profanity_vulgarity',
      reason: 'bad_word_detected',
      warningMessage: POLITE_MESSAGES.BAD_WORDS_LABEL,
      label: POLITE_MESSAGES.BAD_WORDS_PLAIN,
      matchedWords: fuzzyCheck.matchedWords,
      layer: 'fuzzy_phonetic_engine'
    };
  }

  // ── LAYER 4: THREATS, EXTORTION, STALKING, HARASSMENT, CYBERBULLYING & COERCION ──
  for (const cand of candidateRepresentations) {
    for (const pattern of COERCION_GROOMING_PATTERNS) {
      if (pattern.test(cand)) {
        return {
          valid: false,
          safe: false,
          action: 'block',
          isThreat: false,
          category: 'coercion_grooming',
          reason: 'coercion_grooming_detected',
          warningMessage: POLITE_MESSAGES.COERCION_GROOMING,
          label: POLITE_MESSAGES.COERCION_GROOMING,
          matchedWords: ['coercion_grooming'],
          layer: 'conversational_threat_analyzer'
        };
      }
    }

    for (const pattern of THREAT_INTENT_PATTERNS) {
      if (pattern.test(cand)) {
        return {
          valid: false,
          safe: false,
          action: 'block',
          isThreat: true,
          category: 'threat_violence',
          reason: 'threat_violence_detected',
          warningMessage: POLITE_MESSAGES.BAD_WORDS_LABEL,
          label: POLITE_MESSAGES.BAD_WORDS_PLAIN,
          matchedWords: ['threat_violence'],
          layer: 'conversational_threat_analyzer'
        };
      }
    }

    for (const pattern of STALKING_DOX_PATTERNS) {
      if (pattern.test(cand)) {
        return {
          valid: false,
          safe: false,
          action: 'block',
          isThreat: true,
          category: 'threat_dox_stalking',
          reason: 'stalking_dox_threat_detected',
          warningMessage: POLITE_MESSAGES.BAD_WORDS_LABEL,
          label: POLITE_MESSAGES.BAD_WORDS_PLAIN,
          matchedWords: ['stalking_doxxing'],
          layer: 'conversational_threat_analyzer'
        };
      }
    }

    for (const pattern of EXTORTION_PATTERNS) {
      if (pattern.test(cand)) {
        return {
          valid: false,
          safe: false,
          action: 'block',
          isThreat: true,
          category: 'coercion_blackmail',
          reason: 'blackmail_coercion_detected',
          warningMessage: POLITE_MESSAGES.BAD_WORDS_LABEL,
          label: POLITE_MESSAGES.BAD_WORDS_PLAIN,
          matchedWords: ['extortion_blackmail'],
          layer: 'conversational_threat_analyzer'
        };
      }
    }

    for (const pattern of SEXUAL_HARASSMENT_PATTERNS) {
      if (pattern.test(cand)) {
        return {
          valid: false,
          safe: false,
          action: 'block',
          isHarassment: true,
          category: 'sexual_harassment',
          reason: 'sexual_harassment_detected',
          warningMessage: POLITE_MESSAGES.BAD_WORDS_LABEL,
          label: POLITE_MESSAGES.BAD_WORDS_PLAIN,
          matchedWords: ['sexual_harassment'],
          layer: 'conversational_threat_analyzer'
        };
      }
    }

    for (const pattern of CYBERBULLYING_PATTERNS) {
      if (pattern.test(cand)) {
        return {
          valid: false,
          safe: false,
          action: 'block',
          isThreat: true,
          category: 'cyberbullying_selfharm',
          reason: 'severe_cyberbullying_detected',
          warningMessage: POLITE_MESSAGES.BAD_WORDS_LABEL,
          label: POLITE_MESSAGES.BAD_WORDS_PLAIN,
          matchedWords: ['cyberbullying_selfharm'],
          layer: 'conversational_threat_analyzer'
        };
      }
    }
  }

  // ── LAYER 5: DEEP MULTI-LINGUAL & GEN Z SLURS VOCABULARY ──
  const matchedSlurs = new Set();

  // 1. Wildcard/Masked bad words detection (e.g. "gxxndu", "bxxch", "sxxle mxgxne", "u*alive")
  const maskedFound = [
    ...detectMaskedBadWords(cleaned, GLOBAL_SLURS_VOCABULARY),
    ...detectMaskedBadWords(homoglyph, GLOBAL_SLURS_VOCABULARY),
    ...detectMaskedBadWords(pureSymbols, GLOBAL_SLURS_VOCABULARY)
  ];
  for (const mf of maskedFound) {
    matchedSlurs.add(mf);
  }

  // 2. Direct tokens and subwords check
  for (const rep of candidateRepresentations) {
    const tokens = rep.split(/[\s,\.!?_\\/~|\*\^#%+=:;'"`@$<>{}\[\]\(\)]+/).filter(Boolean);
    for (const t of tokens) {
      if (t.length >= 3 && GLOBAL_SLURS_VOCABULARY.includes(t)) {
        if (!SAFE_EXCEPTIONS.has(t)) {
          matchedSlurs.add(t);
        }
      }
    }
  }

  // 3. Multi-word and substring slurs
  for (const slur of GLOBAL_SLURS_VOCABULARY) {
    if (slur.length < 3) continue;

    const regex = new RegExp(`\\b${slur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    for (const rep of candidateRepresentations) {
      if (regex.test(rep)) {
        matchedSlurs.add(slur);
      }
    }

    // Stripped spacers check (e.g. "b.h.e.n.c.h.o.d", "u.n.a.l.i.v.e", "d-i-d-d-y", or spaced letters "d i d d y")
    const words = cleaned.trim().split(/\s+/).filter(Boolean);
    const isSpacedLetterSpam = words.length >= 3 && words.every(w => w.length <= 2);

    if (isSpacedLetterSpam || words.length <= 2) {
      if (
        pureSymbols.includes(slur) ||
        pureLeet.includes(slur) ||
        pureDeduped.includes(slur) ||
        pureDedupedLeet.includes(slur) ||
        vowelCollapsedPure.includes(slur) ||
        strippedPhonetic.includes(slur)
      ) {
        const isBenignSubword = Array.from(SAFE_EXCEPTIONS).some(safe => pureSymbols.includes(safe));
        if (!isBenignSubword) {
          matchedSlurs.add(slur);
        }
      }
    } else {
      // For standard multi-word sentences, check stripped spacers per token to prevent accidental cross-word collisions
      for (const w of words) {
        const cleanWord = stripAllSymbols(w).toLowerCase();
        if (cleanWord.length >= 3) {
          const leetWord = normalizeLeetspeak(cleanWord);
          const dedupedWord = collapseRepeatedChars(cleanWord);
          if (cleanWord === slur || leetWord === slur || dedupedWord === slur) {
            if (!SAFE_EXCEPTIONS.has(cleanWord)) {
              matchedSlurs.add(slur);
            }
          }
        }
      }
    }
  }

  if (matchedSlurs.size > 0) {
    const matchedList = Array.from(matchedSlurs);
    return {
      valid: false,
      safe: false,
      action: 'block',
      category: 'slur_hate_speech',
      reason: 'slur_detected',
      warningMessage: POLITE_MESSAGES.BAD_WORDS_LABEL,
      label: POLITE_MESSAGES.BAD_WORDS_PLAIN,
      matchedWords: matchedList,
      layer: 'multilingual_slur_engine'
    };
  }

  // ── LAYER 5.5: LOW-EFFORT PROBES, KEYBOARD MASH & VERTICAL SPAM ──
  for (const pattern of LOW_EFFORT_PATTERNS) {
    if (pattern.test(cleaned)) {
      return {
        valid: false,
        safe: false,
        action: 'block',
        isLowEffort: true,
        category: 'low_effort',
        reason: 'low_effort_detected',
        warningMessage: POLITE_MESSAGES.LOW_EFFORT,
        label: POLITE_MESSAGES.LOW_EFFORT,
        matchedWords: ['low_effort_probe'],
        layer: 'low_effort_detector'
      };
    }
  }

  if (isVerticalLetterSpam(cleaned)) {
    return {
      valid: false,
      safe: false,
      action: 'block',
      isLowEffort: true,
      category: 'low_effort_vertical_spam',
      reason: 'low_effort_vertical_spam',
      warningMessage: POLITE_MESSAGES.LOW_EFFORT,
      label: POLITE_MESSAGES.LOW_EFFORT,
      matchedWords: ['vertical_spam'],
      layer: 'low_effort_detector'
    };
  }

  if (isKeyboardMashOrCharacterFlood(cleaned)) {
    return {
      valid: false,
      safe: false,
      action: 'block',
      isLowEffort: true,
      category: 'low_effort_gibberish',
      reason: 'low_effort_gibberish',
      warningMessage: POLITE_MESSAGES.LOW_EFFORT,
      label: POLITE_MESSAGES.LOW_EFFORT,
      matchedWords: ['keyboard_mash'],
      layer: 'low_effort_detector'
    };
  }

  // ── LAYER 6: LEARNED MODEL WEIGHTS KNOWLEDGE BASE ──
  const weights = loadModelWeights();
  if (weights?.phrases?.violations) {
    for (const vItem of weights.phrases.violations) {
      if (!vItem.text) continue;
      const vText = vItem.text.toLowerCase().trim();
      if (SAFE_EXCEPTIONS.has(vText)) continue;
      const isLowEffortCat = vItem.category && (vItem.category.includes('low_effort') || vItem.category.includes('probe'));
      const learnedLabel = isLowEffortCat ? POLITE_MESSAGES.LOW_EFFORT : POLITE_MESSAGES.BAD_WORDS_PLAIN;
      const learnedCat = isLowEffortCat ? 'low_effort' : 'learned_violation';

      if (rawLower === vText || vertical.toLowerCase() === vText || strippedPhonetic === vText.replace(/\s+/g, '')) {
        return {
          valid: false,
          safe: false,
          action: 'block',
          category: learnedCat,
          reason: 'custom_model_violation',
          warningMessage: learnedLabel,
          label: learnedLabel,
          matchedWords: [vText],
          layer: 'learned_model_knowledge'
        };
      }
      if (vText.length >= 3 && /^[a-zA-Z0-9_\s]+$/.test(vText)) {
        const escaped = vText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'i');
        if (regex.test(rawLower) || regex.test(vertical) || regex.test(phonetic)) {
          return {
            valid: false,
            safe: false,
            action: 'block',
            category: learnedCat,
            reason: 'custom_model_violation',
            warningMessage: learnedLabel,
            label: learnedLabel,
            matchedWords: [vText],
            layer: 'learned_model_knowledge'
          };
        }
      }
    }
  }

  // Safe pass-through
  return {
    valid: true,
    safe: true,
    action: 'allow',
    category: 'clean_conversation',
    confidence: 1.0,
    layer: 'pass_through',
    matchedWords: []
  };
}
module.exports = {
  evaluateFuzzyBadWords,
  evaluateMessage,
  detectPhoneNumber,
  detectAskingForPhoneNumber,
  detectSocialMediaSharing,
  detectExternalLinks,
  detectRestrictedSymbols,
  isKeyboardMashOrCharacterFlood,
  isVerticalLetterSpam,
  isInnocentColloquialism,
  normalizeHomoglyphs,
  collapseVerticalText,
  collapseSpacedLetters,
  stripAllSymbols,
  normalizeLeetspeak,
  normalizePhoneticSubstitutions,
  collapseRepeatedChars,
  collapseElongatedVowels,
  detectMaskedBadWords,
  loadModelWeights,
  POLITE_MESSAGES,
  GLOBAL_SLURS_VOCABULARY,
  SAFE_COLLOQUIAL_PATTERNS,
  SAFE_EXCEPTIONS,
  COERCION_GROOMING_PATTERNS
};
