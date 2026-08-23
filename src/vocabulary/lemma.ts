/**
 * Reducing an English word to the form a dictionary lists it under.
 *
 * Rules, not a lexicon: the dictionary itself is the lexicon, and this only has
 * to propose forms worth asking it about. Two questions come out of it, and they
 * are not the same question:
 *
 * - **Which entry do I read?** The word as selected, if it has one — `running`
 *   has its own entry and that is what the reader wants to see.
 * - **Which row does it belong to?** Always the reduced form. `running`, `ran`
 *   and `runs` are one vocabulary entry under `run`, or the list fills up with
 *   the same word three times (docs/specs/vocabulary.md §5).
 *
 * So `lookupCandidates()` orders the original first, and `resolveStem()` looks
 * only at the reductions.
 *
 * One implementation, shared by both platform ports: the desktop sends the whole
 * candidate list to SQLite in one call, and the browser — which has no
 * dictionary — falls back to the first reduction.
 */

/**
 * Forms no set of suffix rules will ever reach. Small on purpose: it covers the
 * verbs and plurals that actually turn up while reading, not every irregular in
 * the language.
 */
const IRREGULAR: Record<string, string> = {
  // to be / to have / to do
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', having: 'have',
  does: 'do', did: 'do', done: 'do', doing: 'do',
  // common irregular verbs
  ran: 'run', went: 'go', gone: 'go', goes: 'go',
  said: 'say', made: 'make', took: 'take', taken: 'take',
  saw: 'see', seen: 'see', came: 'come', knew: 'know', known: 'know',
  got: 'get', gotten: 'get', gave: 'give', given: 'give',
  found: 'find', thought: 'think', told: 'tell', became: 'become',
  left: 'leave', felt: 'feel', brought: 'bring', began: 'begin', begun: 'begin',
  kept: 'keep', held: 'hold', wrote: 'write', written: 'write',
  stood: 'stand', heard: 'hear', meant: 'mean', met: 'meet', paid: 'pay',
  sat: 'sit', spoke: 'speak', spoken: 'speak', lay: 'lie', lain: 'lie',
  led: 'lead', grew: 'grow', grown: 'grow', lost: 'lose', fell: 'fall',
  fallen: 'fall', sent: 'send', built: 'build', understood: 'understand',
  drew: 'draw', drawn: 'draw', broke: 'break', broken: 'break', spent: 'spend',
  rose: 'rise', risen: 'rise', drove: 'drive', driven: 'drive', bought: 'buy',
  wore: 'wear', worn: 'wear', chose: 'choose', chosen: 'choose',
  sought: 'seek', threw: 'throw', thrown: 'throw', caught: 'catch',
  dealt: 'deal', won: 'win', forgot: 'forget', forgotten: 'forget',
  ate: 'eat', eaten: 'eat', taught: 'teach', sold: 'sell', fought: 'fight',
  flew: 'fly', flown: 'fly', slept: 'sleep', drank: 'drink', drunk: 'drink',
  sang: 'sing', sung: 'sing', rang: 'ring', rung: 'ring',
  woke: 'wake', woken: 'wake', stole: 'steal', stolen: 'steal',
  struck: 'strike', hid: 'hide', hidden: 'hide', bit: 'bite', bitten: 'bite',
  shook: 'shake', shaken: 'shake', swam: 'swim', swum: 'swim',
  bore: 'bear', borne: 'bear', tore: 'tear', torn: 'tear',
  swore: 'swear', sworn: 'swear', froze: 'freeze', frozen: 'freeze',
  crept: 'creep', swept: 'sweep', wept: 'weep', knelt: 'kneel',
  clung: 'cling', flung: 'fling', hung: 'hang', stuck: 'stick', stung: 'sting',
  dug: 'dig', spun: 'spin', shone: 'shine', shot: 'shoot',
  // irregular plurals
  men: 'man', women: 'woman', children: 'child', feet: 'foot', teeth: 'tooth',
  geese: 'goose', mice: 'mouse', lice: 'louse', people: 'person', oxen: 'ox',
  lives: 'life', wives: 'wife', knives: 'knife', leaves: 'leaf',
  halves: 'half', wolves: 'wolf', thieves: 'thief', shelves: 'shelf',
  selves: 'self', loaves: 'loaf', calves: 'calf', elves: 'elf',
  criteria: 'criterion', phenomena: 'phenomenon', data: 'datum',
  analyses: 'analysis', crises: 'crisis', theses: 'thesis', bases: 'basis',
  indices: 'index', matrices: 'matrix', appendices: 'appendix',
  media: 'medium', bacteria: 'bacterium', memoranda: 'memorandum',
  curricula: 'curriculum', alumni: 'alumnus', cacti: 'cactus', fungi: 'fungus',
  nuclei: 'nucleus', radii: 'radius', stimuli: 'stimulus', syllabi: 'syllabus',
  // irregular comparatives
  better: 'good', best: 'good', worse: 'bad', worst: 'bad',
  further: 'far', furthest: 'far', farther: 'far', farthest: 'far',
}

const VOWELS = 'aeiou'

function isVowel(character: string): boolean {
  return VOWELS.includes(character)
}

/** Ends in a doubled consonant, as `stopp` and `runn` do. */
function endsInDoubledConsonant(word: string): boolean {
  const last = word.at(-1)
  const previous = word.at(-2)
  return Boolean(last && previous && last === previous && !isVowel(last) && /[a-z]/.test(last))
}

/**
 * Consonant–vowel–consonant, the shape that means a silent `e` was dropped.
 *
 * `mov` is one (so `moving` came from `move`); `walk` is not (so `walking` came
 * from `walk`). `w`, `x` and `y` are excluded because they do not behave that
 * way — `snow` is CVC by the letters and `snowing` is not `snowe`.
 */
function endsInConsonantVowelConsonant(word: string): boolean {
  if (word.length < 3) return false
  const [third, second, last] = [word.at(-3)!, word.at(-2)!, word.at(-1)!]
  return (
    /[a-z]/.test(third) &&
    !isVowel(third) &&
    isVowel(second) &&
    /[a-z]/.test(last) &&
    !isVowel(last) &&
    !'wxy'.includes(last)
  )
}

/**
 * Undo the spelling change that goes with a suffix, best guess first.
 *
 * `stopp` → `stop` (the doubling), `mov` → `move` (the silent e), `walk` →
 * `walk` (neither). The alternatives follow, because only the dictionary can
 * settle a word this cannot.
 */
function baseForms(stripped: string): string[] {
  const forms: string[] = []
  if (endsInDoubledConsonant(stripped)) {
    forms.push(stripped.slice(0, -1), stripped, `${stripped}e`)
  } else if (stripped.length < 3 || endsInConsonantVowelConsonant(stripped)) {
    // Too short to have survived losing a letter, or the CVC that a silent `e`
    // leaves behind: `us` came from `use`, `mov` from `move`.
    forms.push(`${stripped}e`, stripped)
  } else {
    forms.push(stripped, `${stripped}e`)
  }
  return forms
}

/**
 * The word as the dictionary would file it: lowercase, no surrounding
 * punctuation, straight apostrophes.
 */
export function normaliseWord(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[‘’ʼ]/g, "'")
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}]+/u, '')
    .replace(/[^\p{L}]+$/u, '')
}

/**
 * Whether a selection is one word, and therefore something to look up.
 *
 * A sentence has no dictionary entry, which is why the definition area is not
 * rendered at all for one (docs/specs/vocabulary.md §9).
 */
export function isSingleWord(text: string): boolean {
  const word = normaliseWord(text)
  return word.length > 0 && !/\s/.test(word) && /\p{L}/u.test(word)
}

/**
 * The reductions of a word, best guess first — the original is not among them.
 */
function reductions(word: string): string[] {
  const forms: string[] = []
  const irregular = IRREGULAR[word]
  // An irregular form is the one thing here that is certain, so it leads.
  if (irregular) forms.push(irregular)

  if (word.endsWith("'s") || word.endsWith("s'")) forms.push(word.slice(0, -2))
  if (word.endsWith("n't")) forms.push(word.slice(0, -3))

  // Plural and third person singular.
  if (word.length > 4 && word.endsWith('ies')) forms.push(`${word.slice(0, -3)}y`)
  if (word.length > 4 && word.endsWith('ves')) {
    forms.push(`${word.slice(0, -3)}f`, `${word.slice(0, -3)}fe`)
  }
  if (word.length > 4 && /(?:s|x|z|ch|sh)es$/.test(word)) forms.push(word.slice(0, -2))
  if (word.length > 3 && word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) {
    forms.push(word.slice(0, -1))
  }

  // Past tense and past participle.
  if (word.length > 4 && word.endsWith('ied')) forms.push(`${word.slice(0, -3)}y`)
  if (word.length > 3 && word.endsWith('ed')) forms.push(...baseForms(word.slice(0, -2)))

  // Present participle and gerund.
  if (word.length > 4 && word.endsWith('ing')) forms.push(...baseForms(word.slice(0, -3)))

  // Comparative and superlative.
  if (word.length > 4 && word.endsWith('iest')) forms.push(`${word.slice(0, -4)}y`)
  if (word.length > 4 && word.endsWith('ier')) forms.push(`${word.slice(0, -3)}y`)
  if (word.length > 4 && word.endsWith('est')) forms.push(...baseForms(word.slice(0, -3)))
  if (word.length > 3 && word.endsWith('er')) forms.push(...baseForms(word.slice(0, -2)))

  // Adverbs.
  if (word.length > 4 && word.endsWith('ily')) forms.push(`${word.slice(0, -3)}y`)
  if (word.length > 3 && word.endsWith('ly')) {
    forms.push(word.slice(0, -2), `${word.slice(0, -2)}le`)
  }

  return [...new Set(forms)].filter((form) => form.length >= 2 && form !== word)
}

/**
 * The forms to ask the dictionary about, the word as selected first.
 *
 * "先查原形，查不到再还原后重查" (§5) is this ordering: the platform port asks
 * about all of them in one call and answers with the first that has an entry,
 * rather than making a round trip per form.
 */
export function lookupCandidates(raw: string): string[] {
  const word = normaliseWord(raw)
  if (!word) return []
  return [word, ...reductions(word)]
}

/**
 * Which vocabulary row a word belongs to.
 *
 * `known` is the subset of the candidates the dictionary recognises, which
 * settles the two cases rules alone cannot:
 *
 * - A reduction the dictionary has always wins, even when the word itself is a
 *   headword. `running` has its own entry, but filing it under `running` would
 *   put `run` in the list twice.
 * - A word whose reductions the dictionary has *never heard of* is already its
 *   own lemma. `anopheles` ends in `s`, and the rules will happily offer
 *   `anophele`; the dictionary knowing one and not the other is what says so.
 *
 * With no dictionary at all — the browser build — only the rules are left, so
 * the first reduction is the best that can be said. That is the degradation:
 * regular words still land right, `anopheles` does not.
 */
export function resolveStem(raw: string, known: readonly string[] = []): string {
  const candidates = lookupCandidates(raw)
  if (candidates.length === 0) return ''
  const [word, ...forms] = candidates
  const recognised = new Set(known.map((form) => normaliseWord(form)))
  const reduction = forms.find((form) => recognised.has(form))
  if (reduction) return reduction
  return recognised.has(word) ? word : (forms[0] ?? word)
}
