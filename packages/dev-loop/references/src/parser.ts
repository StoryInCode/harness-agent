/** Extract References observations with maintained Markdown/GFM syntax parsing. */
import assert from 'node:assert/strict'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { visit } from 'unist-util-visit'
import type { Nodes } from 'mdast'
import type { ReferenceEntry, ReferenceError } from './types.ts'

/** Locator syntax selects repository-root versus piece-directory resolution. */
export type LocatorKind = 'code' | 'link' | 'invalid'

const profiles = [
  ['Source', 'Role/preset that inspected it', 'Question it answered', 'Direct inspection or reported', 'How it was used'],
  ['Source', 'Role/preset and provenance', 'Decision informed'],
  ['Source', 'Question answered', 'Provenance'],
  ['Source', 'Provenance', 'Decision informed'],
  ['Source', 'Role/preset', 'Provenance', 'Decision informed'],
]

function rendered(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  if (node.type === 'image' || node.type === 'imageReference') {
    // fromMarkdown completes every image label, including an empty label, as text.
    assert(typeof node.alt === 'string')
    return node.alt
  }
  if (node.type === 'break') return ' '
  if ('children' in node) return node.children.map(rendered).join('')
  return ''
}

function normalized(node: Nodes): string {
  return rendered(node).replace(/\s+/g, ' ').trim()
}

function locators(node: Nodes, definitions: Map<string, string>): { source: string; kind: LocatorKind }[] {
  if (node.type === 'link') return [{ source: node.url, kind: 'link' }]
  if (node.type === 'linkReference') {
    const source = definitions.get(node.identifier.toUpperCase())
    // fromMarkdown emits reference nodes only for definitions collected from the complete tree.
    assert(source !== undefined)
    return [{ source, kind: 'link' }]
  }
  if (node.type === 'inlineCode') return [{ source: node.value, kind: 'code' }]
  // Image labels and HTML are not source locators.
  if (node.type === 'image' || node.type === 'imageReference') return []
  if ('children' in node) return node.children.flatMap(child => locators(child, definitions))
  return []
}

/**
 * Parse one top-level References section without checking sources or attribution.
 * @param text - Complete piece Markdown, including its References heading.
 * @param maxReferences - Maximum expanded locator count; overflow returns an error without truncating entries.
 * @returns Detached initial entries, structural errors, explicit-empty state, and locator kinds aligned with entries.
 */
export function parseReferences(text: string, maxReferences: number): {
  entries: ReferenceEntry[]
  errors: ReferenceError[]
  explicitEmpty: boolean
  kinds: LocatorKind[]
} {
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const entries: ReferenceEntry[] = []
  const errors: ReferenceError[] = []
  const kinds: LocatorKind[] = []
  const result = { entries, errors, explicitEmpty: false, kinds }
  const headings = tree.children.filter(node => node.type === 'heading' && normalized(node) === 'References')
  const heading = headings[0]
  if (!heading || heading.type !== 'heading') {
    errors.push({ code: 'MISSING_REFERENCES', message: 'The piece has no References section.' })
    return result
  }
  if (headings.length !== 1) {
    errors.push({ code: 'MALFORMED_REFERENCES', message: 'The piece must have exactly one References section.' })
    return result
  }
  const start = tree.children.indexOf(heading) + 1
  const following = tree.children.slice(start)
  const end = following.findIndex(node => node.type === 'heading' && node.depth <= heading.depth)
  const section = end === -1 ? following : following.slice(0, end)
  const body = section.filter(node => node.type !== 'definition')
  const block = body[0]
  if (body.length === 1 && block?.type === 'paragraph' && block.children.length === 1
    && block.children[0]?.type === 'text' && /^(?:None\.|No references\.)$/.test(block.children[0].value.trim())) {
    result.explicitEmpty = true
    return result
  }
  if (body.length !== 1 || block?.type !== 'table' || block.children.length < 2) {
    errors.push({ code: 'MALFORMED_REFERENCES', message: 'References must contain one populated supported table or plain None. or No references.' })
    return result
  }
  const header = block.children[0]
  assert(header)
  const columns = header.children.map(normalized)
  const profile = profiles.findIndex(candidate => candidate.length === columns.length
    && candidate.every((name, index) => name === columns[index]))
  if (profile === -1) {
    errors.push({ code: 'INVALID_COLUMNS', message: 'References columns must match a supported profile in its declared order.' })
    return result
  }
  const definitions = new Map<string, string>()
  visit(tree, 'definition', (node) => {
    if (!definitions.has(node.identifier.toUpperCase())) {
      definitions.set(node.identifier.toUpperCase(), node.url)
    }
  })
  for (const [index, row] of block.children.slice(1).entries()) {
    if (row.children.length !== columns.length) {
      errors.push({ code: 'MALFORMED_REFERENCES', message: `References row ${index + 1} has ${row.children.length} cells; expected ${columns.length}.` })
      continue
    }
    const values = row.children.map(normalized)
    const valueAt = (column: number): string => {
      const value = values[column]
      assert(value !== undefined)
      return value
    }
    const sourceCell = row.children[0]
    assert(sourceCell)
    const attributionIndex = profile === 2 || profile === 4 ? 2 : 1
    if (!values[0] || !values[attributionIndex]) {
      errors.push({ code: 'MALFORMED_REFERENCES', message: `References row ${index + 1} requires a source and attribution.` })
    }
    const sources = locators(sourceCell, definitions)
    if (!sources.length) sources.push({ source: valueAt(0), kind: 'invalid' })
    const explanatoryColumns: Record<string, string> = {}
    if (profile !== 0) {
      for (const [column, name] of columns.entries()) {
        if (column !== 0 && column !== attributionIndex && !(profile === 4 && column === 1)) {
          explanatoryColumns[name] = valueAt(column)
        }
      }
    }
    for (const locator of sources) {
      const entryIndex = entries.length
      entries.push({
        row: index + 1,
        source: locator.source,
        sourceText: valueAt(0),
        attribution: valueAt(attributionIndex),
        ...(profile === 0 ? { question: valueAt(2), inspection: valueAt(3), usage: valueAt(4) } : {}),
        ...(profile === 4 ? { rolePreset: valueAt(1) } : {}),
        explanatoryColumns: { ...explanatoryColumns },
        sourceStatus: 'not-checked',
        attributionStatus: 'unverified',
        inspectionStatus: 'unverified',
        limitations: [],
      })
      kinds.push(locator.kind)
      if (locator.kind === 'invalid') {
        errors.push({ code: 'INVALID_LOCATOR', message: `References row ${index + 1} requires a Markdown link or inline-code locator.`, entryIndex })
      }
    }
  }
  if (entries.length > maxReferences) {
    errors.push({ code: 'TOO_MANY_REFERENCES', message: `References contains ${entries.length} locators; maximum is ${maxReferences}.` })
  }
  return result
}
