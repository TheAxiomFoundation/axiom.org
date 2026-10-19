// This is the TypeScript mirror of ops/comms/check_claims.py. Its regexes,
// predicate/noun scope, offsets and Markdown boundaries form one contract;
// see the canonical labelled fixtures and their recorded ops snapshot.
// Match ASCII-folded strings with /u, never /iu: Unicode case folding would
// introduce ASCII word characters (for example Kelvin sign and long s).
const asciiFold = (text: string) => text.replace(/[A-Z]/g, char => char.toLowerCase())
const pattern = (source: string) => new RegExp(source, 'u')
const WORD = String.raw`[A-Za-z0-9_'’-]+`
const SPACE_CHARS = '\t\v\f\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
const SPACES = new RegExp(`[${SPACE_CHARS}]+`, 'gu')
const SPACE_CHAR = new RegExp(`^[${SPACE_CHARS}]$`, 'u')
const CLAUSE_BREAK = pattern(String.raw`[.!?;:—\n]|--|, (?:and|but|so|yet|while) `)

const DECISION_CLAIMS = [
  String.raw`\b(every|each|all)( ${WORD})? decisions?(\b[^.;:!?\n]{0,30}\b(is|are|was|were|gets?|get))? (logged|recorded|traced|kept|saved|published|public)\b`,
  String.raw`\b(logs?|logged|logging|records?|recorded|recording|traces?|traced|tracing|captures?|captured|keeps?|kept|saves?|saved|publish(es|ed|ing)?|documents?|documented)\b[^.;:!?\n]{0,20}\b(every|each|all|its|their|our|the (encoder|model|agent)['’]s)( ${WORD})? decisions?\b`,
  String.raw`\b(every|each|all|its|their|our)( ${WORD})? decisions? (has|have|gets?|comes? with|carry|carries) (an? |its |their )?(${WORD} )?(record|log|trail|trace|history|explanation)s?\b`,
  String.raw`\bdecision[- ](trail|log)s?\b`,
  String.raw`\b(encoding|encoder['’]?s?|model['’]?s?|agent['’]?s?|interpretive|our|its|their) decisions? (is|are|was|were|gets?) (all |fully |publicly |openly )?(public|published|open|logged|recorded|traceable|auditable|visible|available|accessible)\b`,
  String.raw`\bpublish(es|ed|ing)? ((its|our|every|each|all|the (encoder|model|agent)['’]s) )?(encoding|encoder|model|agent|interpretive) decisions?\b|\bpublish(es|ed|ing)? (its|our|every|each|all|the (encoder|model|agent)['’]s) decisions?\b`,
].map(pattern)
const DECISION_LOG_NOUN = DECISION_CLAIMS[3]
const TRACE_NOUN = String.raw`(?<noun>traces?|transcripts?|reasoning|chains? of thought|thought process(es)?)`
const TRACE_CLAIMS = [
  pattern(String.raw`\b(?<verb>publish(es|ed|ing)?|keeps?|kept|keeping|retains?|retained|archives?|archived|stores?|stored|saves?|saved|logs?|logged|records?|recorded|shares?|shared|exposes?|exposed|releases?|released)(?<middle>( ${WORD}){0,4}?) ${TRACE_NOUN}\b(?!['’]s\b)`),
  pattern(String.raw`\b(?<middle>(${WORD} ){0,3}?)${TRACE_NOUN} (is|are|was|were|gets?) (publicly |openly |fully |permanently )?(?<state>published|public|kept|retained|archived|stored|logged|recorded|saved|available|accessible|visible|open|shared)\b`),
]
const COORDINATED_MODIFIERS = pattern(String.raw`(?:(?:the|a|an|its|our|their|full|detailed|model['’]s|encoder['’]s|agent['’]s) )*`)
const COORDINATED_TRACE = pattern(String.raw`(?: and | or |, (?:and )?)(?<middle>(${WORD} ){0,4}?)${TRACE_NOUN}\b(?!['’]s\b)(?! (?:is|are|was|were|gets?|stays?|remains?)\b)`)
const ENCODER_SCOPE = pattern(String.raw`\b(encoder|encoders|encoding|encodings|pipeline|pipelines|model|models|agent|agents|llm|llms|ai|run|runs|session|sessions)\b`)
const ENCODER_SUBJECT = pattern(String.raw`^ *(?:(?:the|our|its|an?|this|that|each|every|all|failed|failing|successful|targeted|axiom['’]s) )*` + ENCODER_SCOPE.source + String.raw`(?!(?: ` + ENCODER_SCOPE.source + String.raw`)*['’](?:s\b|(?= )))(?! ${WORD}['’](?:s\b|(?= )))`)
const INHERITED_PREDICATE = pattern(String.raw`^ *(?:(?:does|do|did|can|could|will|would|should|must|not|never|also|then|publicly|openly|fully|permanently|actually|currently|normally|usually|generally|automatically|routinely|necessarily|explicitly|directly) )*$`)
const OTHER_TRACE = pattern(String.raw`\b(calculation|citation|evaluation|computation|engine|replay|execution|stack|error|audit|request|network|span|rule|graph)$`)
const REFERENCE = pattern(String.raw`\b(path|paths|hash|hashes|reference|references|pointer|pointers|location|locations|name|names|sha|checksum|checksums|id|ids) (?:of|to|for)(?: [A-Za-z0-9_'’-]+){0,2}$`)
const DETERMINER = pattern(String.raw`\b(every|each|all|its|their)\b`)
const RETAIN = pattern(String.raw`^(keeps?|kept|keeping|retains?|retained|archives?|archived|stores?|stored|saves?|saved|logs?|logged|records?|recorded)$`)
const LOCAL_TRACE = pattern(String.raw`^ (locally\b|on (?:the |a |its )?local machine\b|on the machine that ran it\b)`)
const FAILED_SUBJECT = pattern(String.raw`\b(?:failed|failing) (?:(?:encoder|encoding|targeted|model|agent) ){0,2}(?:runs?|re-encodes?|encodings?|attempts?|sessions?) ?$`)
const FAILED_OBJECT = pattern(String.raw`^(?:(?:the|a|an|its|full|diagnostic) )*failed(?: (?:encoder|encoding))? (?:run['’]s |run |encoding['’]s )$`)
const FAILED_TRACE = pattern(String.raw`^ (?:of|from|for) (?:a |the )?failed (?:encoder |encoding )?(?:run|encoding|attempt|session)s?\b`)
const SUCCESSFUL_TRACE = pattern(String.raw`\b(?:successful|success)(?:[- ]${WORD}){0,3}[- ](?:runs?|re-encodes?|encodings?|attempts?|sessions?|ones|traces?)\b`)
const PUBLIC_DESTINATION = pattern(String.raw`\b(?:on|to|in|at|via) (?:(?:a|an|the|our|its) )?(?:[A-Za-z]+ )?public\b|\bpublicly\b`)
// Sentence context revokes an exemption only for an affirmative trace
// predicate or bare coordinated continuation, with denials scoped to it.
const CONTEXT_BREAK = pattern(String.raw`[;,](?: (?:and|or|but|yet|while|so))? ?| (?:and|or|but|yet|while|so) `)
const CONTEXT_DENIAL = pattern(String.raw`\b(?:not(?! (?:only|merely|simply)\b)|never|without|cannot|no|neither|nor)\b|n['‘’]t\b`)
const CONTEXT_PREFIX = pattern(String.raw`(?:(?:also|then|of|from|for|a|an|the|our|its|their|every|each|all|full|detailed|not only|not merely|not simply) )*`)
const PUBLIC_CONTINUATION = pattern(String.raw`(?:(?:it|they|(?:the|its|our|their) traces?) )?(?:(?:is|are|was|were|gets?) )?(?:also )?(?:(?:keeps?|kept|retains?|retained|stores?|stored|saves?|saved|archives?|archived|publishes?|published|shares?|shared|uploads?|uploaded)(?: (?:it|them))? )?`)
const NEGATED_PREDICATE = pattern(String.raw`(?:\b(?:not(?! only\b)|never|without|cannot|neither|nor)|n['‘’]t)(?: (?:ever|publicly|openly|fully|permanently|actually|currently|normally|usually|generally|automatically|routinely|necessarily|explicitly|directly))? $`)
const NEGATED_NOUN = pattern(String.raw`\b(?:no|neither|without|not every|not each|not all)(?: (?:encoder|encoding|public|complete|detailed|permanent))? $`)
const NOUN_PREDICATE = pattern(String.raw`\b(?:keep|keeps|kept|have|has|maintain|maintains|publish|publishes|provide|provides|retain|retains|store|stores|save|saves) (?:(?:a|an|the|its|our|their|public|complete|detailed) ){0,3}$`)
const DENIED_LOG = pattern(String.raw`^ (?:(?:is|are|was|were) (?:not|never)|(?:is|are|was|were)n['‘’]t) (?:kept|retained|maintained|stored|saved|published|available|public)\b`)

type Match = { pattern: RegExp; index: number; end: number; groups: Record<string, string | undefined> }
function matches(regex: RegExp, text: string): Match[] {
  return Array.from(text.matchAll(new RegExp(regex.source, 'gu')), match => ({
    pattern: regex, index: match.index!, end: match.index! + match[0].length, groups: match.groups ?? {},
  }))
}
function matchAt(regex: RegExp, text: string, start: number): Match | undefined {
  const sticky = new RegExp(regex.source, 'uy')
  sticky.lastIndex = start
  const match = sticky.exec(text)
  return match ? { pattern: regex, index: start, end: start + match[0].length, groups: match.groups ?? {} } : undefined
}
function fullMatch(regex: RegExp, text: string): boolean {
  const match = regex.exec(text)
  return !!match && match.index === 0 && match[0].length === text.length
}
const lastNounPhrase = (middle: string) => middle.split(/\b(?:and|or|but)\b/u).at(-1)!.replace(/^ +| +$/g, '')
// Match Python str.strip's whitespace set, including its four C0 separators.
const pythonStrip = (text: string) => text.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, '')

function* contextFragments(sentence: string, target: RegExp): Generator<[fragment: string, inheritedDenial: boolean]> {
  let start = 0, inheritedDenial = false
  for (const separator of matches(CONTEXT_BREAK, sentence)) {
    const fragment = sentence.slice(start, separator.index)
    yield [fragment, inheritedDenial]
    const first = target.exec(fragment)
    const denied: boolean = inheritedDenial || CONTEXT_DENIAL.test(first ? fragment.slice(0, first.index + first[0].length) : fragment)
    // "Never A or B" denies both alternatives; other conjuncts start anew.
    inheritedDenial = sentence.slice(separator.index, separator.end).replace(/^[,; ]+|[,; ]+$/gu, '') === 'or' && denied
    start = separator.end
  }
  yield [sentence.slice(start), inheritedDenial]
}

function affirmativeContext(sentence: string, target: RegExp): boolean {
  for (const [fragment, inheritedDenial] of contextFragments(sentence, target)) {
    if (inheritedDenial) continue
    for (const match of matches(target, fragment)) {
      if (CONTEXT_DENIAL.test(fragment.slice(0, match.end))) continue
      if (TRACE_CLAIMS.some(regex => matches(regex, fragment).some(claim =>
        !negated(fragment, claim) && (ENCODER_SCOPE.test(fragment) || fullMatch(INHERITED_PREDICATE, fragment.slice(0, claim.index)))))) return true
      const before = (pythonStrip(fragment.slice(0, match.index)) + ' ').replace(/^ +/u, '')
      const after = pythonStrip(fragment.slice(match.end))
      if (target === SUCCESSFUL_TRACE) {
        if (fullMatch(CONTEXT_PREFIX, before) && /^(?:(?:too|as well)(?: |$))?(?:without .*)?$/u.test(after)) return true
      } else if (fullMatch(PUBLIC_CONTINUATION, before)) return true
    }
  }
  return false
}

function traceClaim(clause: string, match: Match, governor?: Match, inheritedScope = false, sentence = ''): boolean {
  const middle = lastNounPhrase(match.groups.middle!)
  if (REFERENCE.test(middle) || OTHER_TRACE.test(middle)) return false
  const predicate = governor ?? match
  if (match.groups.noun === 'trace' || match.groups.noun === 'traces') {
    const successful = /\b(successful|success)\b/u.test(middle) || affirmativeContext(sentence, SUCCESSFUL_TRACE)
    if (!successful && (FAILED_SUBJECT.test(clause.slice(0, predicate.index)) || FAILED_OBJECT.test(middle + ' ') || FAILED_TRACE.test(clause.slice(match.end)))) return false
    const retaining = fullMatch(RETAIN, predicate.groups.verb ?? predicate.groups.state ?? '')
    const publicDestination = /\b(public|publicly)\b/u.test(clause.slice(match.index, match.end)) || affirmativeContext(sentence, PUBLIC_DESTINATION)
    if (retaining && LOCAL_TRACE.test(clause.slice(match.end)) && !publicDestination) return false
  }
  if (match.groups.noun === 'reasoning' || ENCODER_SCOPE.test(clause) || (inheritedScope && fullMatch(INHERITED_PREDICATE, clause.slice(0, predicate.index)))) return true
  return match.pattern === TRACE_CLAIMS[1] && DETERMINER.test(middle)
}

function negated(clause: string, match: Match, governor?: Match): boolean {
  const before = clause.slice(0, (governor ?? match).index)
  if (NEGATED_PREDICATE.test(before) || NEGATED_NOUN.test(before)) return true
  if (match.pattern === TRACE_CLAIMS[0] || match.pattern === TRACE_CLAIMS[1] || match.pattern === COORDINATED_TRACE) {
    if (/^(?:no|neither|not (?:every|each|all))\b/u.test(lastNounPhrase(match.groups.middle!))) return true
  }
  if (match.pattern === DECISION_LOG_NOUN) {
    const verb = NOUN_PREDICATE.exec(before)
    if (verb && NEGATED_PREDICATE.test(before.slice(0, verb.index))) return true
    return DENIED_LOG.test(clause.slice(match.end))
  }
  return false
}

/** Explicit White_Space + FEFF normalization; LF remains a clause boundary. */
export function normalizeClaimSpaces(text: string): { text: string; offsets: number[] } {
  let normalized = ''
  const offsets: number[] = []
  let offset = 0, inSpace = false
  for (const char of text) {
    if (SPACE_CHAR.test(char)) {
      if (!inSpace) { normalized += ' '; offsets.push(offset) }
      inSpace = true
    } else {
      normalized += char
      // RegExp indices use UTF-16; returned input offsets use code points.
      for (let unit = 0; unit < char.length; unit++) offsets.push(offset)
      inSpace = false
    }
    offset++
  }
  return { text: normalized, offsets }
}

function clauses(text: string): [number, string, boolean][] {
  let start = 0, inheritedScope = false
  const result: [number, string, boolean][] = []
  for (const separator of matches(CLAUSE_BREAK, text)) {
    const following = matchAt(COORDINATED_TRACE, text, separator.index)
    if (following && fullMatch(COORDINATED_MODIFIERS, following.groups.middle!) && TRACE_CLAIMS[0].test(text.slice(start, separator.index))) continue
    const clause = text.slice(start, separator.index)
    result.push([start, clause, inheritedScope])
    const active = TRACE_CLAIMS[0].exec(clause)
    inheritedScope = text.slice(separator.index, separator.end) === ', and ' &&
      (!!matchAt(ENCODER_SUBJECT, clause, 0) || (inheritedScope && !!active && fullMatch(INHERITED_PREDICATE, clause.slice(0, active.index))))
    start = separator.end
  }
  result.push([start, text.slice(start), inheritedScope])
  return result
}

function codePointCompare(left: string, right: string): number {
  const a = Array.from(left, char => char.codePointAt(0)!)
  const b = Array.from(right, char => char.codePointAt(0)!)
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

/** Python-compatible (original code-point offset, normalized claim) results. */
export function encoderRecordHits(raw: string): [number, string][] {
  const { text, offsets } = normalizeClaimSpaces(raw)
  const folded = asciiFold(text)
  const hits: [number, string][] = []
  for (const [start, clause, inheritedScope] of clauses(folded)) {
    // A clause split cannot hide a public destination or successful-run conjunct.
    const boundaries = ['.', '!', '?', '\n']
    const left = Math.max(...boundaries.map(char => start ? folded.lastIndexOf(char, start - 1) : -1)) + 1
    const ends = boundaries.map(char => folded.indexOf(char, start)).filter(end => end >= 0)
    const right = ends.length ? Math.min(...ends) : folded.length
    const sentence = folded.slice(left, right)
    const found: [Match, Match | undefined][] = DECISION_CLAIMS.flatMap(regex => matches(regex, clause).map(match => [match, undefined] as [Match, undefined]))
    for (const regex of TRACE_CLAIMS) {
      for (const match of matches(regex, clause)) {
        if (traceClaim(clause, match, undefined, inheritedScope, sentence)) found.push([match, undefined])
        if (regex === TRACE_CLAIMS[0]) {
          let end = match.end, following: Match | undefined
          while ((following = matchAt(COORDINATED_TRACE, clause, end))) {
            if (traceClaim(clause, following, match, inheritedScope, sentence)) found.push([following, match])
            end = following.end
          }
        }
      }
    }
    for (const [match, governor] of found) {
      if (negated(clause, match, governor)) continue
      const offset = governor?.index ?? match.index
      hits.push([offsets[start + offset], text.slice(start + offset, start + match.end)])
    }
  }
  return hits.sort(([leftOffset, leftClaim], [rightOffset, rightClaim]) => leftOffset - rightOffset || codePointCompare(leftClaim, rightClaim))
}

export const encoderRecordClaims = (raw: string): string[] => encoderRecordHits(raw).map(([, claim]) => claim)

const ALLOWED_SENTENCE = new RegExp(
  String.raw`(?:^|(?<=[.!?;:—…])|(?<=-->))[^.!?;:—…]*[.!?]?` +
  `[${SPACE_CHARS}\x60*_"')\\]]*<!--[${SPACE_CHARS}]*claims-check: allow[${SPACE_CHARS}]*-->`, 'gu',
)
const BLOCK_START = / *([-*+] |[0-9]+[.)] |#|```|<!--)/u
const STANDALONE = / *(#|```|<!--)/u
const QUOTE = /^ *(?:> *)+/u
const SENTENCE_END = /([.!?:]["'’”)\]*_`]*|-->) *$/u
const TABLE_TOKEN = /\\.|\|/gu
const codePointLength = (text: string) => Array.from(text).length
const stripSpaces = (text: string) => text.replace(/^ +| +$/g, '')
const isInternalNote = (text: string) => text.replace(new RegExp(`^[${SPACE_CHARS}]+`, 'u'), '').startsWith('*Internal note') && text.replace(new RegExp(`[${SPACE_CHARS}]+$`, 'u'), '').endsWith('*')

const INLINE_ESCAPABLE = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
function* inlineRegions(text: string, incompleteComments = false): Generator<[kind: string, start: number, end: number]> {
  // All ranges use code points, as do the inline adapter and paragraph maps.
  const points = Array.from(text)
  let i = 0
  while (i < points.length) {
    let end = i + 1, kind = 'literal'
    if (points[i] === '\\' && i + 1 < points.length && INLINE_ESCAPABLE.includes(points[i + 1])) {
      end = i + 2
    } else if (points[i] === '`') {
      while (end < points.length && points[end] === '`') end++
      const tail = points.slice(end).join('')
      const close = new RegExp('(?<!`)' + '`'.repeat(end - i) + '(?!`)', 'u').exec(tail)
      if (close) end += codePointLength(tail.slice(0, close.index + close[0].length))
      else { i = end; continue }
    } else if (points.slice(i, i + 4).join('') === '<!--') {
      const tail = points.slice(i + 4).join('')
      const close = tail.indexOf('-->')
      if (close < 0 && !incompleteComments) { i += 4; continue }
      end = close >= 0 ? i + 4 + codePointLength(tail.slice(0, close)) + 3 : points.length
      kind = 'comment'
    } else { i++; continue }
    yield [kind, i, end]
    i = end
  }
}

function continuationVisible(text: string): string {
  const points = Array.from(text), parts: string[] = []
  let start = 0
  for (const [kind, left, right] of inlineRegions(text, true)) {
    if (kind === 'comment' && !/^<!-- *claims-check: allow *-->$/u.test(points.slice(left, right).join(''))) {
      parts.push(points.slice(start, left).join(''))
      start = right
    }
  }
  return parts.join('') + points.slice(start).join('')
}

// Markdown fixtures also cover the pre-existing messaging banned claims.
// Their Python expressions use Unicode words/case (unlike the encoder-only
// contract above). Preserve their first-match-per-pattern diagnostics.
const CHECK_VERB = String.raw`(cross-check|check|verif|validat|compar|run[s]? against|mapped to an oracle)`
const UNIVERSAL_SUBJECT = String.raw`((every|each|all|any)( single)?( one)?( of)?( (the|our|its))?( [\w,]+)? (encoding|published rule|rule|executable output|output|formula|provision|module)s?|everything|the (whole|entire) corpus|100 ?% of (the |our )?(rules|encodings))`
const NOT = String.raw`(?<!\bnot )(?<!n['’]t )(?<!\bnever )`
const NOT_AN = NOT + String.raw`(?<!\bnot an )(?<!n['’]t an )`
const LEGACY_BANNED_SOURCES = [
  String.raw`signs? off`, String.raw`human (sign|review|oversight|approv)`, String.raw`human-in-the-loop`, String.raw`experts? (verify|review|check)`,
  String.raw`${NOT}\b${UNIVERSAL_SUBJECT}\b[^.]{0,80}\b${CHECK_VERB}`,
  String.raw`${NOT}\b${CHECK_VERB}\w*\b[^.]{0,20}\b${UNIVERSAL_SUBJECT}\b`,
  String.raw`\b(open|cited|dated|executable|effective-dated|versioned),? (and )?(cross-checked|validated)\b`,
  String.raw`\b(every|each|all)( \w+)? (encoding|rule|module)s? (is|are|gets?|pass|passes|must pass)\b[^.]{0,30}\btest`,
  String.raw`\b(nothing|no (rule|encoding)) (ships|merges|reaches the corpus|is published) without\b`,
  String.raw`\b(produced|built|wrote|encoded|generated) (every rule|everything|the (whole |entire )?corpus)\b`,
  String.raw`everything in the corpus`, String.raw`\bSOUTHMOD\b[^.]{0,80}\bno published comparison`,
  String.raw`\bSOUTHMOD\b[^.]{0,80}\b(aren.t|are not|isn.t|is not|not) (yet )?(an? )?(oracles?|connected)\b`,
  String.raw`${NOT_AN}\bindependent(ly)? (of (the )?Axiom( Foundation)?|engines?|oracles?|calculators?|calculations?|implementations?|evidence|checks?|verification|validation|models?|calcs?|comparisons?|sources?|references?|benchmarks?)\b`,
  String.raw`${NOT}\bindependently (cross-)?(check|verif|validat|confirm|test|compar)`,
  String.raw`\b(compared?|maintained) independently\b`, String.raw`\bexternal (engines?|oracles?|calculators?|sources?|datasets?|models?)\b`,
  String.raw`\b(outside|third-party|separately maintained) (engines?|oracles?|calculators?|models?)\b`,
  String.raw`engines we (don.t|do not) control`, String.raw`built by (different|separate|other) teams`, String.raw`never grades its own work`,
  String.raw`\b(validated|verified|cross-checked|checked|tested) (against|by|with) ((both|the) )?(PolicyEngine|TAXSIM)\b`,
  String.raw`\btrusted (references?|oracles?|engines?|calculators?)\b`, String.raw`adjudicated cases`, String.raw`administrative ground truth`,
  String.raw`own recomputation`, String.raw`federal computation`, String.raw`answer key`, String.raw`federal reviewer verified`, String.raw`reviewer-certified`,
  String.raw`each deduction[^.]{0,20}(check|verif|match)`, String.raw`every stage[^.]{0,30}(check|verif|match|reproduc)`,
  String.raw`stage by stage`, String.raw`eliminat(es|ed) outright`, String.raw`the majority everywhere`, String.raw`twice the margin`,
  String.raw`95\.3 ?%`, String.raw`appears only in .{0,60}(memo|memorandum)`,
  String.raw`stratified sample|quality-control determinations|consistency tolerance|strictest class|no single changed input`,
]
const UNICODE_WORD = String.raw`[\p{L}\p{N}_]`
const UNICODE_BOUNDARY = `(?:(?<=${UNICODE_WORD})(?!${UNICODE_WORD})|(?<!${UNICODE_WORD})(?=${UNICODE_WORD}))`
const LEGACY_BANNED = LEGACY_BANNED_SOURCES.map(source => pattern(asciiFold(source)
  .replaceAll(String.raw`[\w,]`, String.raw`[\p{L}\p{N}_,]`)
  .replaceAll(String.raw`\w`, UNICODE_WORD).replaceAll(String.raw`\b`, UNICODE_BOUNDARY)))
const legacyFold = (text: string) => asciiFold(text).replace(/[İı]/g, 'i').replace(/K/g, 'k').replace(/ſ/g, 's')

export function blankAllowedClaims(text: string): string {
  // Keep original code-point offsets intact, including across wrapped lines.
  return text.replace(ALLOWED_SENTENCE, match => ' '.repeat(codePointLength(match)))
}

export type MarkdownBlock = { text: string; lines: [offset: number, line: number, raw: string][] }
export function markdownParagraphs(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let joined = '', lines: MarkdownBlock['lines'] = [], depth = 0, standalone = false
  const flush = () => { if (lines.length) blocks.push({ text: joined, lines }); joined = ''; lines = [] }
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.replace(SPACES, ' ')
    const quote = QUOTE.exec(line)
    const level = quote ? quote[0].split('>').length - 1 : 0
    const content = quote ? line.slice(quote[0].length) : line
    if (isInternalNote(content) || !stripSpaces(content)) { flush(); continue }
    const cells: string[] = []
    let start = 0
    for (const token of content.matchAll(TABLE_TOKEN)) {
      if (token[0] === '|') { cells.push(content.slice(start, token.index)); start = token.index! + 1 }
    }
    if (cells.length) {
      cells.push(content.slice(start))
      flush()
      for (const cell of cells) if (stripSpaces(cell)) blocks.push({ text: cell, lines: [[0, index + 1, raw]] })
      continue
    }
    // Inline comments are invisible; an explicit allowance still closes its clause.
    const visible = continuationVisible(joined)
    // Python's re.match anchors BLOCK_START/STANDALONE even without ^.
    if (lines.length && level <= depth && !matchAt(BLOCK_START, content, 0) && !standalone && !SENTENCE_END.test(visible)) {
      lines.push([codePointLength(joined) + 1, index + 1, raw])
      joined += ' ' + stripSpaces(content)
      continue
    }
    flush()
    joined = content
    lines = [[0, index + 1, raw]]
    depth = level
    standalone = !!matchAt(STANDALONE, content, 0)
  }
  flush()
  return blocks
}

const INLINE_ENTITY = /&(?:#[xX][0-9a-fA-F]{1,8}|#[0-9]{1,8}|[A-Za-z][A-Za-z0-9]{1,31});/u
const INLINE_PUNCTUATION = /^[\p{P}\p{S}]$/u
const entityCache = new Map<string, string>()
function decodeMarkdownEntity(token: string): string {
  const cached = entityCache.get(token)
  if (cached !== undefined) return cached
  // Attribute context preserves unknown named references rather than partially
  // decoding a legacy prefix. Numeric references use HTML's replacement table.
  const span = document.createElement('span')
  span.innerHTML = '<i data-entity="' + token + '"></i>'
  const decoded = span.firstElementChild!.getAttribute('data-entity')!.replace(/\n/g, ' ')
  entityCache.set(token, decoded)
  return decoded
}

/** Visible Markdown inline text, with original source code-point offsets. */
export function markdownInline(text: string): { text: string; offsets: number[] } {
  const points = Array.from(text)
  type Delimiter = { start: number; length: number; left: number; right: number; char: string; opens: boolean; closes: boolean }
  const delimiters: Delimiter[] = []
  const removed = new Set<number>(), protectedPoints = new Set<number>()
  const remove = (start: number, end: number) => { for (let j = start; j < end; j++) removed.add(j) }
  const regions = new Map<number, number>()
  for (const [kind, start, end] of inlineRegions(text)) {
    regions.set(start, end)
    const selected = kind === 'comment' ? removed : protectedPoints
    for (let j = start; j < end; j++) selected.add(j)
  }
  let i = 0
  while (i < points.length) {
    const char = points[i]
    if (regions.has(i)) { i = regions.get(i)!; continue }
    if (char !== '*' && char !== '_') { i++; continue }
    let end = i + 1
    while (end < points.length && points[end] === char) end++
    const before = points[i - 1] ?? '', after = points[end] ?? ''
    const beforeSpace = !before || before === '\n' || SPACE_CHAR.test(before)
    const afterSpace = !after || after === '\n' || SPACE_CHAR.test(after)
    const beforePunct = !!before && INLINE_PUNCTUATION.test(before)
    const afterPunct = !!after && INLINE_PUNCTUATION.test(after)
    const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct)
    const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct)
    delimiters.push({ start: i, length: end - i, left: 0, right: 0, char,
      opens: left && (char === '*' || !right || beforePunct),
      closes: right && (char === '*' || !left || afterPunct) })
    i = end
  }
  for (let c = 0; c < delimiters.length; c++) {
    const closer = delimiters[c]
    if (!closer.closes) continue
    for (let o = c - 1; o >= 0; o--) {
      const opener = delimiters[o]
      if (!opener.opens || opener.char !== closer.char) continue
      while (true) {
        const a = opener.length - opener.left - opener.right
        const b = closer.length - closer.left - closer.right
        if (!a || !b) break
        if ((opener.closes || closer.opens) && (a + b) % 3 === 0 && (a % 3 || b % 3)) break
        const count = a >= 2 && b >= 2 ? 2 : 1
        remove(opener.start + opener.length - opener.right - count, opener.start + opener.length - opener.right)
        remove(closer.start + closer.left, closer.start + closer.left + count)
        opener.right += count
        closer.left += count
      }
    }
  }
  const parts: string[] = [], offsets: number[] = []
  i = 0
  while (i < points.length) {
    if (removed.has(i)) { i++; continue }
    const token = !protectedPoints.has(i) && points[i] === '&' ? matchAt(INLINE_ENTITY, points.slice(i).join(''), 0) : undefined
    if (token) {
      const decoded = decodeMarkdownEntity(points.slice(i, i + token.end).join(''))
      parts.push(decoded)
      for (const _ of decoded) offsets.push(i)
      i += token.end
    } else { parts.push(points[i]); offsets.push(i); i++ }
  }
  return { text: parts.join(''), offsets }
}

/** Reference Markdown claim diagnostics (disclosures are separate checks). */
export function markdownClaims(raw: string): [number, string][] {
  return markdownParagraphs(raw).flatMap(block => {
    const { text: checked, offsets } = markdownInline(blankAllowedClaims(block.text))
    const legacy: [number, string][] = LEGACY_BANNED.flatMap(regex => {
      const match = regex.exec(legacyFold(checked))
      return match ? [[codePointLength(checked.slice(0, match.index)), checked.slice(match.index, match.index + match[0].length)] as [number, string]] : []
    })
    return [...legacy, ...encoderRecordHits(checked)].map(([offset, claim]) => {
      const line = block.lines.slice().reverse().find(([start]) => start <= offsets[offset])!
      return [line[1], claim] as [number, string]
    })
  })
}
