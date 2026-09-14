import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ANTIGRAVITY_MODELS,
  parseModelsOutput,
  resolveModelMetadata,
} from '../src/models.ts'

describe('Antigravity LLM Models', () => {
  it('contains expected default models matching agy models', () => {
    expect(DEFAULT_ANTIGRAVITY_MODELS.length).toBeGreaterThanOrEqual(14)
    expect(DEFAULT_ANTIGRAVITY_MODELS.some(m => m.id === 'gemini-3.8-flash-high')).toBe(true)
    expect(DEFAULT_ANTIGRAVITY_MODELS.some(m => m.id === 'claude-sonnet-4-6')).toBe(true)
    expect(DEFAULT_ANTIGRAVITY_MODELS.some(m => m.id === 'claude-opus-4-6-thinking')).toBe(true)
  })

  it('parses tab-separated output correctly', () => {
    const raw = [
      'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
      'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
      'invalid-line',
      '',
    ].join('\n')

    const models = parseModelsOutput(raw, 'antigravity')
    expect(models).toEqual([
      { provider: 'antigravity', id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { provider: 'antigravity', id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
    ])
  })

  it('resolves model metadata with correct context windows and reasoning', () => {
    const gemini = resolveModelMetadata('antigravity', 'gemini-3.8-flash-high')
    expect(gemini.id).toBe('gemini-3.8-flash-high')
    expect(gemini.name).toBe('Gemini 3.8 Flash (High)')
    expect(gemini.context?.contextWindow).toBe(1_048_576)
    expect(gemini.reasoning?.defaultEffort).toBe('high')

    const claude = resolveModelMetadata('antigravity', 'claude-sonnet-4-6')
    expect(claude.context?.contextWindow).toBe(200_000)
    expect(claude.reasoning?.defaultEffort).toBe('high')

    const gpt = resolveModelMetadata('antigravity', 'gpt-oss-120b-medium')
    expect(gpt.context?.contextWindow).toBe(128_000)
  })
})
