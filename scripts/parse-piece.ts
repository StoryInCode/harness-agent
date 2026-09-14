/**
 * Piece record and validation-finding types shared by the directory service, its
 * pure parser, and every downstream development-loop consumer.
 * @module @deepseek-ai/dsh-dev-loop-directory/types
 */

/**
 * Lifecycle state a piece file declares in its `**Status:**` header line. The
 * four states are the closed vocabulary the lifecycle state machine transitions
 * between; a file declaring anything else is rejected rather than defaulted.
 */
export type PieceStatus = 'todo' | 'pending' | 'done' | 'blocked'

/**
 * Machine-readable reason one piece file failed or warned during validation.
 * Each code maps to exactly one rejected condition so a caller can branch on
 * the cause without matching message text.
 */
export type PieceFindingCode =
  | 'PIECE_SIZE_EXCEEDED'
  | 'MISSING_REQUIRED_SECTION'
  | 'MISSING_RECOMMENDED_SECTION'
  | 'INVALID_HARNESS_PRIMITIVE'
  | 'INVALID_PIECE_STATUS'
  | 'MALFORMED_PIECE_HEADER'

/**
 * Severity a finding carries, mirroring the `severity:` field of the `axiom`
 * blocks in `plans/AGENTS.md`. A blocker rejects the file; a warning is
 * recorded on the accepted record.
 */
export type PieceFindingSeverity = 'blocker' | 'warning'

/** One validation observation about one piece file. */
export interface PieceFinding {
  /** Which condition was observed. */
  readonly code: PieceFindingCode
  /** Whether the condition rejects the file or only annotates it. */
  readonly severity: PieceFindingSeverity
  /** Operator-facing explanation naming the offending value. */
  readonly message: string
}

/** One Given/When/Then scenario extracted from a piece's `## Behaviour` section. */
export interface PieceScenario {
  /** Precondition text following the `Given` marker. */
  readonly given: string
  /** Action text following the `When` marker. */
  readonly when: string
  /** Observable-outcome text following the `Then` marker. */
  readonly then: string
}

/** Header fields every piece file declares above its first section. */
export interface PieceMetadata {
  /** Dotted piece id such as `00.01`, taken from the title line. */
  readonly id: string
  /** Human title following the id on the title line. */
  readonly title: string
  /** Owning set name such as `00-dev-loop`. */
  readonly set: string
  /** Dispatch position within the set; lower runs earlier. */
  readonly queue: number
  /** Piece ids that must reach `done` before this one may be dispatched. */
  readonly dependsOn: readonly string[]
  /** Declared lifecycle state. */
  readonly status: PieceStatus
  /** Declared Harness primitive, validated against the closed vocabulary. */
  readonly primitive: string
  /** Single owning workspace package name. */
  readonly pkg: string
}

/** A parsed, validated piece file together with the evidence of its validation. */
export interface PieceRecord extends PieceMetadata {
  /** Path the content was read from, as supplied to the parser. */
  readonly path: string
  /** Physical line count measured against the configured ceiling. */
  readonly lineCount: number
  /** Full `## Summary` body, newline-joined. */
  readonly summary: string
  /** Scenarios extracted from `## Behaviour`, in document order. */
  readonly scenarios: readonly PieceScenario[]
  /** Non-blocking findings; a fully compliant piece carries none. */
  readonly warnings: readonly PieceFinding[]
}

/** One file a scan could not parse. A malformed sibling is data, not an exception. */
export interface PieceRejection {
  /** Path of the file that was rejected. */
  readonly path: string
  /** The first blocking condition, for callers that branch on one cause. */
  readonly code: PieceFindingCode
  /** Every finding observed on that file, blockers and warnings together. */
  readonly findings: readonly PieceFinding[]
}

/** Valid records and rejected files, reported together so neither hides the other. */
export interface SetScan {
  /** Every piece of the set that parsed, ordered by queue position then by id. */
  readonly pieces: readonly PieceRecord[]
  /** Every piece file of the set that did not parse, in scan order. */
  readonly rejected: readonly PieceRejection[]
}

/**
 * Outcome of parsing one file without throwing: `ok` discriminates the record
 * from the rejection, so a scan needs no exception to keep reading siblings.
 */
export type PieceParseResult =
  | { readonly ok: true; readonly record: PieceRecord }
  | { readonly ok: false; readonly rejection: PieceRejection }
/**
 * Pure piece-file grammar: header fields, the canonical section order, and the
 * severity model of the `axiom` blocks in `plans/AGENTS.md`. No filesystem
 * access happens here, so the verification gates can validate text they
 * already hold.
 *
 * @module @deepseek-ai/dsh-dev-loop-directory/parse
 */

/**
 * Closed Harness-primitive vocabulary from the `plans/AGENTS.md` META AXIOM.
 * `Plugin` is deliberately absent: the axiom states it "is not an answer".
 */
export const HARNESS_PRIMITIVES: readonly string[] = [
  'Service Definition',
  'Service Provider',
  'Consumer',
  'model-facing tool',
  'event/hook plugin',
  'agent-preset composition',
  'skill',
  'skill provider',
  'subagent provider',
  'subagent consumer',
  'workflow capability',
  'session projection',
  'session event',
  'command',
  'profile',
  'bundle',
  'patch layer',
  'client UI extension',
]

/** Line ceiling `R-piece-size` enforces, inclusive. */
export const PIECE_MAX_LINES = 280

/** Directory holding the set directories, relative to the filesystem backend's base. */
export const PIECE_ROOT = 'plans/pieces'

/** Subdirectory a completed piece moves into, per `R-done-pieces-moved`. */
export const DONE_DIRECTORY = 'done'

/** Validation failure carrying every finding observed on one piece file. */
export class PieceParseError extends Error {
  /** The first blocking condition, for callers that branch on one cause. */
  readonly code: PieceFindingCode
  /** Path the rejected content came from. */
  readonly path: string
  /** Every finding observed, blockers and warnings together. */
  readonly findings: readonly PieceFinding[]

  /**
   * The code is passed explicitly rather than searched for among the findings,
   * so the class stays total and carries no branch that a caller cannot reach.
   * @param path - path the rejected content came from.
   * @param code - the blocking condition this failure reports.
   * @param findings - every finding observed, blockers and warnings together.
   */
  constructor(path: string, code: PieceFindingCode, findings: readonly PieceFinding[]) {
    super(`${path}: ${findings.filter(finding => finding.severity === 'blocker').map(finding => finding.message).join('; ')}`)
    this.name = 'PieceParseError'
    this.code = code
    this.path = path
    this.findings = findings
  }
}

/** Options a caller supplies to override the axiom-derived defaults. */
export interface PieceParseOptions {
  /** Inclusive line ceiling; defaults to {@link PIECE_MAX_LINES}. */
  readonly maxLines?: number
  /** Accepted Harness primitives; defaults to {@link HARNESS_PRIMITIVES}. */
  readonly primitives?: readonly string[]
}

/**
 * Canonical `##` section order. A section that appears after a canonically
 * later one is reported exactly like an absent section, because both are the
 * same defect in a sequence check.
 */
const CANONICAL_SECTIONS: readonly string[] = [
  'Summary',
  'Behaviour',
  'Harness fit',
  'Contracts',
  'Dependencies',
  'References',
  'How to see it',
  'Teach me while you build',
  'Resources and proof',
  'Reuse capture',
  'Acceptance',
]

/** The one canonical section whose absence warns instead of rejecting, per `R-piece-reuse-capture`. */
const RECOMMENDED_SECTION = 'Reuse capture'

/** Labelled header fields every piece declares above its first section. */
const REQUIRED_HEADER_FIELDS: readonly string[] = [
  'Set',
  'Queue',
  'Depends on',
  'Status',
  'Harness primitive',
  'Package',
]

/** Closed lifecycle vocabulary a piece's `**Status:**` line must name. */
const PIECE_STATUSES: readonly PieceStatus[] = ['todo', 'pending', 'done', 'blocked']

/** Characters that open a CommonMark fenced code block. */
const FENCE_CHARS: readonly string[] = ['`', '~']

/** Shortest run of a fence character that opens or closes a fenced code block. */
const MIN_FENCE_LENGTH = 3

/** Deepest indentation CommonMark admits before a fence run, in spaces. */
const MAX_FENCE_INDENT = 3

/** ATX heading prefix of a section, the only heading level the piece format uses. */
const SECTION_PREFIX = '## '

/** Prefix of the `# NN.MM — Title` line. */
const TITLE_PREFIX = '# '

/** Separator between the piece id and its title: an em dash or a hyphen, surrounded by whitespace. */
const TITLE_SEPARATOR = /\s[—-]\s/

/** Width of every {@link TITLE_SEPARATOR} match: one space, one dash, one space. */
const TITLE_SEPARATOR_LENGTH = 3

/** Opening delimiter of a bold header label. */
const FIELD_PREFIX = '**'

/** Delimiter closing a bold header label and introducing its value. */
const FIELD_SEPARATOR = ':**'

/** Dotted piece id as the title line and the filename both spell it. */
const PIECE_ID = /^\d{2}\.\d{2}[a-z]?$/

/** `NN.MM[a-z]-<kebab-slug>.md`, the only basename `scanSet` reads. */
const PIECE_FILENAME = /^\d{2}\.\d{2}[a-z]?-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/

/** Value the `**Depends on:**` field carries when a piece depends on no other piece. */
const NO_DEPENDENCIES = 'none'

/** Number of characters the `NN.MM` id prefix of a piece filename occupies. */
const PIECE_ID_LENGTH = 5

/** Marker of a scenario bullet in `## Behaviour`, and the markers splitting its three parts. */
const GIVEN_MARKER = '- **Given** '
const WHEN_MARKER = ' **When** '
const THEN_MARKER = ' **Then** '

/** Opening or closing marker of a fenced code block. */
export interface FenceMarker {
  /** The fence character, so a tilde run never closes a backtick fence. */
  readonly char: string
  /** Run length, so a closer may be longer than its opener but never shorter. */
  readonly length: number
}

/** One `##` section and the half-open line range of its body. */
interface SectionSpan {
  /** Heading text with surrounding whitespace removed. */
  readonly title: string
  /** First body line. */
  readonly start: number
  /** One past the last body line; the next heading, or end of file. */
  end: number
}

/**
 * Return the fence marker a line opens or closes with.
 *
 * Up to three leading spaces precede the run, as CommonMark admits for both
 * openers and closers: an indented closer that this parser failed to recognise
 * would leave its fence open to the end of the file and report every later
 * section as absent. Deeper indentation is an indented code block, not a fence.
 *
 * @param line - one physical line, without its terminator.
 * @returns the marker, or `undefined` when the line carries no fence run.
 */
export function fenceMarkerAt(line: string): FenceMarker | undefined {
  let start = 0
  while (line[start] === ' ') start += 1
  if (start > MAX_FENCE_INDENT) return undefined
  for (const char of FENCE_CHARS) {
    let length = 0
    while (line[start + length] === char) length += 1
    if (length >= MIN_FENCE_LENGTH) return { char, length }
  }
  return undefined
}

/**
 * Split the file into its header region and its sections in document order.
 *
 * Fenced code blocks are tracked so a `##` line inside one stays content: it
 * neither satisfies a required section nor participates in the ordering. An
 * unclosed fence runs to the end of the file.
 *
 * @param lines - physical lines of the file.
 * @returns the header lines and every `##` section found outside a fence.
 */
function splitSections(lines: readonly string[]): { header: string[]; sections: SectionSpan[] } {
  const sections: SectionSpan[] = []
  let headerEnd = lines.length
  let fence: FenceMarker | undefined
  for (const [index, line] of lines.entries()) {
    const marker = fenceMarkerAt(line)
    if (fence !== undefined) {
      if (marker !== undefined && marker.char === fence.char && marker.length >= fence.length) fence = undefined
      continue
    }
    if (marker !== undefined) {
      fence = marker
      continue
    }
    if (!line.startsWith(SECTION_PREFIX)) continue
    const previous = sections.at(-1)
    if (previous === undefined) headerEnd = index
    else previous.end = index
    sections.push({ title: line.slice(SECTION_PREFIX.length).trim(), start: index + 1, end: lines.length })
  }
  return { header: lines.slice(0, headerEnd), sections }
}

/**
 * Read the `**Label:** value` fields of the header region.
 *
 * A value ends at the `·` separator or at the end of its line, which is how
 * `plans/pieces/PIECE-FORMAT.md` packs several fields onto one line.
 *
 * @param header - lines preceding the first section heading.
 * @returns each declared label mapped to its trimmed value.
 */
function readHeaderFields(header: readonly string[]): Map<string, string> {
  const fields = new Map<string, string>()
  for (const line of header) {
    for (const segment of line.split('·')) {
      const trimmed = segment.trim()
      const separator = trimmed.indexOf(FIELD_SEPARATOR)
      if (!trimmed.startsWith(FIELD_PREFIX) || separator < 0) continue
      fields.set(
        trimmed.slice(FIELD_PREFIX.length, separator),
        trimmed.slice(separator + FIELD_SEPARATOR.length).trim(),
      )
    }
  }
  return fields
}

/**
 * Read one header field.
 * @param fields - fields the header declared.
 * @param label - label to read.
 * @returns the declared value, or `''` when the label is absent.
 */
function headerField(fields: ReadonlyMap<string, string>, label: string): string {
  return fields.get(label) ?? ''
}

/**
 * Validate one header field's value, but only when its label is declared.
 *
 * An absent label is already reported once as a malformed header, so judging
 * the value it never carried would report the same defect a second time and
 * name a vocabulary the file said nothing about.
 *
 * @param fields - fields the header declared.
 * @param label - label whose value is validated.
 * @param findings - list each observation is appended to.
 * @param check - returns the findings the declared value produces.
 */
function checkDeclaredField(
  fields: ReadonlyMap<string, string>,
  label: string,
  findings: PieceFinding[],
  check: (value: string) => readonly PieceFinding[],
): void {
  const value = fields.get(label)
  if (value === undefined) return
  findings.push(...check(value))
}

/**
 * Read the `**Depends on:**` field as the piece ids it names.
 * @param value - the declared field value.
 * @returns one entry per comma-separated id with backticks removed, empty for `none`.
 */
function readDependsOn(value: string): string[] {
  return value === NO_DEPENDENCIES ? [] : value.split(',').map(entry => entry.trim().replaceAll('`', ''))
}

/**
 * Return the title line of the header region.
 * @param header - lines preceding the first section heading.
 * @returns the first `# ` line, or `''` when the piece declares none.
 */
function findTitleLine(header: readonly string[]): string {
  let found = ''
  for (const line of header) {
    if (found === '' && line.startsWith(TITLE_PREFIX)) found = line
  }
  return found
}

/**
 * Return the body lines of one section.
 * @param sections - every section found outside a fence.
 * @param lines - physical lines of the file.
 * @param title - section title to read.
 * @returns the body lines, or an empty list when the section is absent.
 */
function sectionBody(sections: readonly SectionSpan[], lines: readonly string[], title: string): string[] {
  const found = sections.find(section => section.title === title)
  if (found === undefined) return []
  return lines.slice(found.start, found.end)
}

/**
 * Read one `## Behaviour` bullet as a scenario.
 * @param line - one body line of the Behaviour section.
 * @returns the three parts, or `undefined` when the line carries no complete Given/When/Then.
 */
function readScenario(line: string): PieceScenario | undefined {
  if (!line.startsWith(GIVEN_MARKER)) return undefined
  const whenAt = line.indexOf(WHEN_MARKER)
  const thenAt = line.indexOf(THEN_MARKER)
  if (whenAt < 0 || thenAt < whenAt) return undefined
  return {
    given: line.slice(GIVEN_MARKER.length, whenAt).trim(),
    when: line.slice(whenAt + WHEN_MARKER.length, thenAt).trim(),
    then: line.slice(thenAt + THEN_MARKER.length).trim(),
  }
}

/**
 * Narrow a declared status to the closed lifecycle vocabulary.
 * @param value - the declared `**Status:**` value.
 * @returns whether the value is one of the four lifecycle states.
 */
function isPieceStatus(value: string): value is PieceStatus {
  return PIECE_STATUSES.includes(value as PieceStatus)
}

/**
 * Record every canonical section that is absent or out of order.
 *
 * One forward pass with a monotone cursor reports both defects: a heading whose
 * canonical position precedes the last one accepted appeared too early, and a
 * canonical section the pass never reached is absent.
 *
 * @param sections - every section found outside a fence, in document order.
 * @param findings - list each observation is appended to.
 */
function checkSectionOrder(sections: readonly SectionSpan[], findings: PieceFinding[]): void {
  const seen = new Set<string>()
  let lastIndex = -1
  let lastTitle = ''
  for (const section of sections) {
    const canonicalIndex = CANONICAL_SECTIONS.indexOf(section.title)
    if (canonicalIndex < 0) continue
    if (canonicalIndex < lastIndex) {
      findings.push({
        code: 'MISSING_REQUIRED_SECTION',
        severity: 'blocker',
        message: `section "${lastTitle}" appears before "${section.title}", which must precede it`,
      })
    }
    lastIndex = canonicalIndex
    lastTitle = section.title
    seen.add(section.title)
  }
  for (const section of CANONICAL_SECTIONS) {
    if (seen.has(section)) continue
    if (section === RECOMMENDED_SECTION) {
      findings.push({
        code: 'MISSING_RECOMMENDED_SECTION',
        severity: 'warning',
        message: `recommended section "${section}" is absent`,
      })
      continue
    }
    findings.push({
      code: 'MISSING_REQUIRED_SECTION',
      severity: 'blocker',
      message: `required section "${section}" is absent`,
    })
  }
}

/**
 * Return whether a basename is a piece specification file.
 * @param name - directory-entry basename to test.
 * @returns whether the name matches `NN.MM-<kebab-slug>.md`.
 */
export function isPieceFilename(name: string): boolean {
  return PIECE_FILENAME.test(name)
}

/**
 * Return the piece id a piece file's own name declares.
 *
 * The filename carries the id, so a file whose content cannot be parsed is
 * still attributable to the id a caller asked for. The basename is assumed to
 * satisfy {@link isPieceFilename}, which every scanned entry does.
 *
 * @param path - path whose basename is a piece filename.
 * @returns the dotted `NN.MM` id opening that basename.
 */
export function pieceIdFromPath(path: string): string {
  const nameAt = path.lastIndexOf('/') + 1
  const match = path.slice(nameAt).match(/^\d{2}\.\d{2}[a-z]?/)
  return match ? match[0] : path.slice(nameAt, nameAt + PIECE_ID_LENGTH)
}

/**
 * Validate one piece file's text, reporting every finding as data.
 *
 * @param path - path the content came from, reported in findings.
 * @param content - complete file text.
 * @param options - ceiling and vocabulary overrides.
 * @returns the record the text describes and every finding observed on it.
 */
function validatePiece(
  path: string,
  content: string,
  options: PieceParseOptions,
): { record: PieceRecord; findings: readonly PieceFinding[] } {
  const maxLines = options.maxLines ?? PIECE_MAX_LINES
  const primitives = options.primitives ?? HARNESS_PRIMITIVES
  const split = content.split('\n')
  // A single trailing newline terminates the last line rather than starting one,
  // so the count matches `wc -l`.
  const lines = split.at(-1) === '' ? split.slice(0, -1) : split
  const findings: PieceFinding[] = []

  if (lines.length > maxLines) {
    findings.push({
      code: 'PIECE_SIZE_EXCEEDED',
      severity: 'blocker',
      message: `${lines.length} lines exceeds the ${maxLines}-line ceiling`,
    })
  }

  const { header, sections } = splitSections(lines)
  const fields = readHeaderFields(header)
  for (const label of REQUIRED_HEADER_FIELDS) {
    if (!fields.has(label)) {
      findings.push({
        code: 'MALFORMED_PIECE_HEADER',
        severity: 'blocker',
        message: `header declares no **${label}:** field`,
      })
    }
  }

  const titleBody = findTitleLine(header).slice(TITLE_PREFIX.length).trim()
  const separatorAt = titleBody.search(TITLE_SEPARATOR)
  const id = separatorAt < 0 ? '' : titleBody.slice(0, separatorAt)
  const title = separatorAt < 0 ? '' : titleBody.slice(separatorAt + TITLE_SEPARATOR_LENGTH).trim()
  if (!PIECE_ID.test(id)) {
    findings.push({
      code: 'MALFORMED_PIECE_HEADER',
      severity: 'blocker',
      message: 'title line declares no `# NN.MM — Title` piece id',
    })
  }

  const queueText = headerField(fields, 'Queue')
  const queue = Number(queueText)
  checkDeclaredField(fields, 'Queue', findings, value => /^\d+$/.test(value) && queue >= 1 ? [] : [{
    code: 'MALFORMED_PIECE_HEADER',
    severity: 'blocker',
    message: `queue position "${value}" is not a positive integer`,
  }])

  // 00.02 and 00.04 turn these entries into dependency edges, so an entry that
  // is not a piece id is reported rather than carried as an unresolvable one.
  checkDeclaredField(fields, 'Depends on', findings, value => readDependsOn(value)
    .filter(entry => !PIECE_ID.test(entry))
    .map(entry => ({
      code: 'MALFORMED_PIECE_HEADER',
      severity: 'blocker',
      message: `dependency "${entry}" is not a piece id of the form NN.MM`,
    })))

  const statusText = headerField(fields, 'Status')
  const statusValid = isPieceStatus(statusText)
  checkDeclaredField(fields, 'Status', findings, value => statusValid ? [] : [{
    code: 'INVALID_PIECE_STATUS',
    severity: 'blocker',
    message: `status "${value}" is not one of ${PIECE_STATUSES.join(', ')}`,
  }])

  const primitive = headerField(fields, 'Harness primitive')
  checkDeclaredField(fields, 'Harness primitive', findings, value => primitives.includes(value) ? [] : [{
    code: 'INVALID_HARNESS_PRIMITIVE',
    severity: 'blocker',
    message: `Harness primitive "${value}" is not one of ${primitives.join(', ')}`,
  }])

  checkSectionOrder(sections, findings)

  const record: PieceRecord = {
    id,
    title,
    set: headerField(fields, 'Set'),
    queue,
    dependsOn: readDependsOn(headerField(fields, 'Depends on')),
    status: statusValid ? statusText : 'todo',
    primitive,
    pkg: headerField(fields, 'Package').replaceAll('`', ''),
    path,
    lineCount: lines.length,
    summary: sectionBody(sections, lines, 'Summary').join('\n').trim(),
    scenarios: sectionBody(sections, lines, 'Behaviour')
      .map(readScenario)
      .filter((scenario): scenario is PieceScenario => scenario !== undefined),
    warnings: findings.filter(finding => finding.severity === 'warning'),
  }

  return { record, findings }
}

/**
 * Return the first blocking finding, which decides whether a file is rejected.
 * @param findings - every finding observed on one file.
 * @returns the first blocker, or `undefined` when the file carries none.
 */
function firstBlocker(findings: readonly PieceFinding[]): PieceFinding | undefined {
  return findings.find(finding => finding.severity === 'blocker')
}

/**
 * Parse and validate one piece file's text.
 *
 * Blocking findings reject the file with {@link PieceParseError}; warnings ride
 * on the returned record. The path is used for messages only and is never read.
 *
 * @param path - path the content came from, reported in findings.
 * @param content - complete file text.
 * @param options - ceiling and vocabulary overrides.
 * @returns the validated record, carrying any warnings.
 */
export function parsePiece(path: string, content: string, options: PieceParseOptions = {}): PieceRecord {
  const { record, findings } = validatePiece(path, content, options)
  const blocker = firstBlocker(findings)
  if (blocker !== undefined) throw new PieceParseError(path, blocker.code, findings)
  return record
}

/**
 * Parse one piece file's text, reporting a rejection instead of throwing.
 *
 * A caller scanning a directory needs the rejected file as data: one malformed
 * file is a fact about the corpus, not a failure of the request that happened
 * to read it.
 *
 * @param path - path the content came from, reported in the rejection.
 * @param content - complete file text.
 * @param options - ceiling and vocabulary overrides.
 * @returns the validated record, or the rejection describing why there is none.
 */
export function tryParsePiece(path: string, content: string, options: PieceParseOptions = {}): PieceParseResult {
  const { record, findings } = validatePiece(path, content, options)
  const blocker = firstBlocker(findings)
  if (blocker !== undefined) return { ok: false, rejection: { path, code: blocker.code, findings } }
  return { ok: true, record }
}
