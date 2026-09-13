/** Fork-owned tool registration must remain visible in the runtime-harvested catalog. */
import { expect, it } from 'vitest'
import { collectToolCatalog } from './gen-tool-catalog.ts'

it('harvests the approval tool even though its package is not named tool-*', async () => {
  const catalog = await collectToolCatalog()
  const approval = catalog.find(entry => entry.pkg === '@deepseek-ai/dsh-dev-loop-approval')
  expect(approval).toBeDefined()
  expect(approval?.schemas.map(schema => schema.name)).toEqual(['present_piece_for_approval'])
  expect(approval?.sources.present_piece_for_approval).toBe('packages/dev-loop/approval/src/index.ts')
})
