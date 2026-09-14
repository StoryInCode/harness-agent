/**
 * Unit tests for micro-gate scaffolding utility gen-piece.ts.
 */

import { describe, expect, it } from 'vitest'
import { formatPieceContent, slugify, toPascalCase } from './gen-piece.ts'
import { parsePiece } from './parse-piece.ts'

describe('slugify', () => {
  it('converts titles into clean kebab-case slugs', () => {
    expect(slugify('User Authentication Service')).toBe('user-authentication-service')
    expect(slugify('OAuth2.0 Token Exchange')).toBe('oauth2-0-token-exchange')
    expect(slugify('  Leading and Trailing Spaces  ')).toBe('leading-and-trailing-spaces')
  })
})

describe('toPascalCase', () => {
  it('converts titles into PascalCase identifiers', () => {
    expect(toPascalCase('user authentication')).toBe('UserAuthentication')
    expect(toPascalCase('heading-scanner')).toBe('HeadingScanner')
  })
})

describe('formatPieceContent', () => {
  it('generates a specification that fully validates with parsePiece', () => {
    const content = formatPieceContent({
      id: '01.01',
      title: 'Authentication Service',
      set: '01-auth',
      lead: 'Lead Architect',
      primitive: 'Service',
      pkg: 'auth-core',
      dependsOn: 'none',
      queue: 1,
    })

    const record = parsePiece('plans/pieces/01-auth/01.01-authentication-service.md', content)
    expect(record.id).toBe('01.01')
    expect(record.title).toBe('Authentication Service')
    expect(record.set).toBe('01-auth')
    expect(record.primitive).toBe('Service')
    expect(record.pkg).toBe('auth-core')
    expect(record.status).toBe('todo')
    expect(record.queue).toBe(1)
    expect(record.scenarios.length).toBeGreaterThan(0)
    expect(record.warnings).toEqual([])
  })
})
