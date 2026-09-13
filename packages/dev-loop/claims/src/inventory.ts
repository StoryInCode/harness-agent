/** Resources-and-proof inventory from maintained Markdown/GFM parsing. @module dsh-dev-loop-claims/inventory */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { ClaimId, InventoryClaim } from './types.ts'

type Block = ReturnType<typeof fromMarkdown>['children'][number]
type Cell = Extract<Block, { type: 'table' }>['children'][number]['children'][number]
const columns = ['Claim', 'Citation', 'How established', 'Checked against']

function cellText(cell: Cell, text: string): string {
  if (!cell.children.length) return ''
  const start = cell.children[0]?.position?.start.offset
  const end = cell.children.at(-1)?.position?.end.offset
  assert(start !== undefined && end !== undefined)
  // Cell syntax stays visible (including citation backticks); GFM escaped pipes are decoded.
  return text.slice(start, end).trim().replace(/\\\|/g, '|')
}

/**
 * Parse the sole Resources and proof section without inferring claims from prose.
 * @param pieceId - Canonical piece identity included in every row fingerprint.
 * @param text - Complete piece Markdown.
 * @param maxClaims - Maximum inventory row count; excess rows throw without truncation.
 * @returns Ordered rows, or an empty array only for plain No load-bearing claims.; invalid structure throws.
 */
export function parseInventory(pieceId: string, text: string, maxClaims: number): InventoryClaim[] {
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const headings = tree.children.filter(node => node.type === 'heading'
    && node.children.length === 1 && node.children[0]?.type === 'text'
    && node.children[0].value.trim() === 'Resources and proof')
  const heading = headings[0]
  if (headings.length !== 1 || heading?.type !== 'heading') {
    throw new Error('Claim inventory requires exactly one Resources and proof section.')
  }
  const following = tree.children.slice(tree.children.indexOf(heading) + 1)
  const end = following.findIndex(node => node.type === 'heading')
  const body = (end === -1 ? following : following.slice(0, end)).filter(node => node.type !== 'definition')
  const block = body[0]
  if (body.length === 1 && block?.type === 'paragraph' && block.children.length === 1
    && block.children[0]?.type === 'text' && block.children[0].value.trim() === 'No load-bearing claims.') return []
  if (body.length !== 1 || block?.type !== 'table' || block.children.length < 2) {
    throw new Error('Claim inventory requires one populated proof table or No load-bearing claims.')
  }
  const header = block.children[0]
  assert(header)
  if (header.children.length !== columns.length
    || header.children.some((cell, index) => cellText(cell, text) !== columns[index])) {
    throw new Error('Claim inventory columns must be Claim, Citation, How established, Checked against in order.')
  }
  const rows = block.children.slice(1)
  if (rows.length > maxClaims) throw new Error('Claim inventory count exceeds maxClaims.')
  return rows.map((row, index) => {
    const values = row.children.map(cell => cellText(cell, text))
    if (values.length !== columns.length || values.some(value => !value)) {
      throw new Error(`Claim inventory row ${index + 1} requires four nonempty cells.`)
    }
    const [claim, citation, howEstablished, checkedAgainst] = values
    assert(claim !== undefined && citation !== undefined && howEstablished !== undefined && checkedAgainst !== undefined)
    const ordinal = index + 1
    const hash = createHash('sha256').update(JSON.stringify([pieceId, ordinal, ...values])).digest('hex')
    return { claimId: `claim:${hash}` as ClaimId, row: ordinal, claim, citation, howEstablished, checkedAgainst }
  })
}
