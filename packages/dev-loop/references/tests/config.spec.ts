/** Deployment policy is validated rather than filled with hidden defaults. */
import { expect, it } from 'vitest'
import References from '../src/index.ts'
import type { Config } from '../src/types.ts'

const valid: Config = { repositoryRoot: '/repository', maxPieceBytes: 65_536, maxSourceBytes: 8192,
  maxObservationBytes: 65_536, maxReferences: 32 }
it.each(['maxPieceBytes', 'maxSourceBytes', 'maxObservationBytes', 'maxReferences'] as const)('%s rejects non-positive, fractional and unsafe numeric policy', (field) => {
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => References.Config({ ...valid, [field]: value }), `missing positive safe-integer validation for ${field}=${value}`).toThrow()
  }
})
it('repositoryRoot rejects blank policy rather than selecting ambient cwd', () => {
  expect(() => References.Config({ ...valid, repositoryRoot: '  ' })).toThrow()
})
it('maxObservationBytes rejects a budget smaller than the minimum complete error envelope', () => {
  expect(() => References.Config({ ...valid, maxObservationBytes: 1 })).toThrow(/maxObservationBytes|minimum|envelope/i)
})
