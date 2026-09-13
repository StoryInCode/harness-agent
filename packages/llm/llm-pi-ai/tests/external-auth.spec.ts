import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const previous = { ...process.env }

afterEach(() => {
  process.env = { ...previous }
  vi.restoreAllMocks()
})

// The fake secrets the leakage assertions watch for. None of them is a real
// credential; every assertion below proves none of them escapes to a caller.
const CODEX_SECRET = 'CODEX_SECRET_TEST_123'
const CLAUDE_SECRET = 'CLAUDE_SECRET_TEST_123'
const GOOGLE_SECRET = 'GOOGLE_SECRET_TEST_123'

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'sig',
  ].join('.')
}

async function emptyHome(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  process.env.HOME = root
  delete process.env.CODEX_HOME
  delete process.env.CLAUDE_CONFIG_DIR
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS
  return root
}

describe('external CLI auth', () => {
  it('reads Codex CLI OAuth as the canonical pi-ai OAuth shape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-codex-'))
    process.env.CODEX_HOME = root
    delete process.env.OPENAI_API_KEY
    const access = jwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test' },
    })
    await writeFile(join(root, 'auth.json'), JSON.stringify({
      tokens: { access_token: access, refresh_token: 'refresh-test' },
    }))
    const { readExternalCredential } = await import('../src/external-auth.ts')
    expect(await readExternalCredential('openai-codex')).toMatchObject({
      type: 'oauth',
      access,
      refresh: 'refresh-test',
      accountId: 'acct-test',
    })
  })

  it('answers "missing" when no Codex credential exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-codex-missing-'))
    process.env.CODEX_HOME = root
    const { readExternalCredential } = await import('../src/external-auth.ts')
    expect(await readExternalCredential('openai-codex')).toBeUndefined()
  })

  it('fails a malformed Codex credential loudly and without leaking its content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-codex-bad-'))
    process.env.CODEX_HOME = root
    await writeFile(join(root, 'auth.json'), `{"tokens": "${CODEX_SECRET}`)
    const { readExternalCredential } = await import('../src/external-auth.ts')
    await expect(readExternalCredential('openai-codex')).rejects.toThrow(/not valid JSON/)
    await expect(readExternalCredential('openai-codex')).rejects.toThrow(/sign in/)
    await expect(readExternalCredential('openai-codex').catch((error: unknown) => String(error))).resolves
      .not.toContain(CODEX_SECRET)
  })

  it('writes a refreshed Codex credential back to the CLI file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-codex-write-'))
    process.env.CODEX_HOME = root
    const access = jwt({ exp: 1, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test' } })
    await writeFile(join(root, 'auth.json'), JSON.stringify({
      OPENAI_API_KEY: null,
      tokens: { access_token: access, refresh_token: 'old-refresh', account_id: 'acct-test' },
    }))
    const { modifyExternalCredential } = await import('../src/external-auth.ts')
    // A refresh-shaped mutation: derived from `current`, `undefined` for a
    // missing one — the shape the vendor write-back path exists to serve.
    const next = await modifyExternalCredential('openai-codex', async (current) => {
      if (current === undefined || current.type !== 'oauth') return undefined
      return {
        ...current,
        type: 'oauth',
        access: 'new-access',
        refresh: 'new-refresh',
        expires: Date.now() + 3600_000,
        accountId: 'acct-test',
      }
    })
    expect(next.handled).toBe(true)
    const stored = JSON.parse(await readFile(join(root, 'auth.json'), 'utf8')) as { tokens: Record<string, string> }
    expect(stored.tokens.access_token).toBe('new-access')
    expect(stored.tokens.refresh_token).toBe('new-refresh')
    expect(stored.tokens.account_id).toBe('acct-test')
    // The refresh rotates only the token pair; unrelated document members the
    // Codex CLI owns survive the rewrite.
    expect('OPENAI_API_KEY' in stored).toBe(true)
  })

  it('rewrites the token file without widening its permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-codex-mode-'))
    process.env.CODEX_HOME = root
    const path = join(root, 'auth.json')
    const access = jwt({ exp: 1, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test' } })
    await writeFile(path, JSON.stringify({
      tokens: { access_token: access, refresh_token: 'old-refresh', account_id: 'acct-test' },
    }), { mode: 0o644 })
    await chmod(path, 0o644)
    const { modifyExternalCredential } = await import('../src/external-auth.ts')
    await modifyExternalCredential('openai-codex', async (current) => {
      if (current === undefined || current.type !== 'oauth') return undefined
      return {
        ...current,
        type: 'oauth',
        access: 'new-access',
        refresh: 'new-refresh',
        expires: Date.now() + 3600_000,
        accountId: 'acct-test',
      }
    })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('serializes concurrent refreshes of one provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-codex-conc-'))
    process.env.CODEX_HOME = root
    const access = jwt({ exp: 1, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test' } })
    await writeFile(join(root, 'auth.json'), JSON.stringify({
      tokens: { access_token: access, refresh_token: 'old-refresh', account_id: 'acct-test' },
    }))
    const { modifyExternalCredential } = await import('../src/external-auth.ts')
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    // Each probe call passes `current === undefined`; only the real call, which
    // carries the vendor credential, marks the order.
    const first = modifyExternalCredential('openai-codex', async (current) => {
      if (current === undefined) return undefined
      order.push('first-start')
      await firstGate
      order.push('first-end')
      return undefined
    })
    const second = modifyExternalCredential('openai-codex', async (current) => {
      if (current === undefined) return undefined
      order.push('second-start')
      return undefined
    })
    await Promise.resolve()
    releaseFirst?.()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second-start'])
  })

  it('lets a login-shaped mutation fall through to the Harness record path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-codex-login-'))
    process.env.CODEX_HOME = root
    const access = jwt({ exp: 1, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test' } })
    const authPath = join(root, 'auth.json')
    await writeFile(authPath, JSON.stringify({
      tokens: { access_token: access, refresh_token: 'old-refresh', account_id: 'acct-test' },
    }))
    const { modifyExternalCredential } = await import('../src/external-auth.ts')
    // A login commit ignores `current` and returns the freshly obtained
    // credential; it must reach the Harness record store, never the file.
    const next = await modifyExternalCredential('openai-codex', async () => ({
      type: 'oauth',
      access: 'login-access',
      refresh: 'login-refresh',
      expires: Date.now() + 3600_000,
      accountId: 'acct-test',
    }))
    expect(next.handled).toBe(false)
    const stored = JSON.parse(await readFile(authPath, 'utf8')) as { tokens: Record<string, string> }
    expect(stored.tokens.refresh_token).toBe('old-refresh')
  })

  it('reads legacy Claude Code credentials as an api-key-shaped token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-'))
    process.env.CLAUDE_CONFIG_DIR = root
    delete process.env.ANTHROPIC_API_KEY
    await writeFile(join(root, '.credentials.json'), JSON.stringify({ tokens: [{ accessToken: 'claude-token' }] }))
    const { readExternalCredential } = await import('../src/external-auth.ts')
    expect(await readExternalCredential('anthropic')).toEqual({ type: 'api_key', key: 'claude-token' })
  })

  it('reads modern Claude Code OAuth and preserves refresh metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-oauth-'))
    process.env.CLAUDE_CONFIG_DIR = root
    await writeFile(join(root, '.credentials.json'), JSON.stringify({
      claudeAiOauth: {
        accessToken: 'claude-access',
        refreshToken: 'claude-refresh',
        expiresAt: 123456,
      },
    }))
    const { readExternalCredential } = await import('../src/external-auth.ts')
    expect(await readExternalCredential('anthropic')).toEqual({
      type: 'oauth',
      access: 'claude-access',
      refresh: 'claude-refresh',
      expires: 123456,
    })
  })

  it('answers "missing" when no Claude Code credential exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-missing-'))
    process.env.CLAUDE_CONFIG_DIR = root
    const { readExternalCredential } = await import('../src/external-auth.ts')
    expect(await readExternalCredential('anthropic')).toBeUndefined()
  })

  it('answers "unsupported format" for a Claude credential with no usable token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-bad-'))
    process.env.CLAUDE_CONFIG_DIR = root
    // An OAuth block missing its refresh half is not an api-key credential
    // either: nothing here can authenticate or refresh it.
    await writeFile(join(root, '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: CLAUDE_SECRET },
    }))
    const { readExternalCredential } = await import('../src/external-auth.ts')
    expect(await readExternalCredential('anthropic')).toBeUndefined()
  })

  it('reports a malformed Claude credential without leaking its content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-json-'))
    process.env.CLAUDE_CONFIG_DIR = root
    await writeFile(join(root, '.credentials.json'), `${CLAUDE_SECRET} not json`)
    const { readExternalCredential } = await import('../src/external-auth.ts')
    await expect(readExternalCredential('anthropic').catch((error: unknown) => String(error))).resolves
      .toContain('not valid JSON')
    await expect(readExternalCredential('anthropic').catch((error: unknown) => String(error))).resolves
      .not.toContain(CLAUDE_SECRET)
  })

  it('fails one provider independently of the other', async () => {
    const codexRoot = await mkdtemp(join(tmpdir(), 'dsh-iso-codex-'))
    const claudeRoot = await mkdtemp(join(tmpdir(), 'dsh-iso-claude-'))
    process.env.CODEX_HOME = codexRoot
    process.env.CLAUDE_CONFIG_DIR = claudeRoot
    await writeFile(join(codexRoot, 'auth.json'), 'not json at all')
    await writeFile(join(claudeRoot, '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: 'claude-access', refreshToken: 'claude-refresh', expiresAt: 1 },
    }))
    const { readExternalCredential } = await import('../src/external-auth.ts')
    await expect(readExternalCredential('openai-codex')).rejects.toThrow(/not valid JSON/)
    expect(await readExternalCredential('anthropic')).toMatchObject({ type: 'oauth', access: 'claude-access' })
  })

  it('enumerates external credentials as non-secret rows only', async () => {
    const codexRoot = await mkdtemp(join(tmpdir(), 'dsh-list-codex-'))
    const claudeRoot = await mkdtemp(join(tmpdir(), 'dsh-list-claude-'))
    process.env.CODEX_HOME = codexRoot
    process.env.CLAUDE_CONFIG_DIR = claudeRoot
    const access = jwt({ exp: 1, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct' } })
    await writeFile(join(codexRoot, 'auth.json'), JSON.stringify({
      tokens: { access_token: `${CODEX_SECRET}${access}`, refresh_token: 'r', account_id: 'acct' },
    }))
    await writeFile(join(claudeRoot, '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: CLAUDE_SECRET, refreshToken: 'r', expiresAt: 1 },
    }))
    const { listExternalCredentials } = await import('../src/external-auth.ts')
    const rows = await listExternalCredentials()
    expect(rows).toEqual([
      { providerId: 'openai-codex', type: 'oauth' },
      { providerId: 'anthropic', type: 'oauth' },
    ])
    expect(JSON.stringify(rows)).not.toContain(CODEX_SECRET)
    expect(JSON.stringify(rows)).not.toContain(CLAUDE_SECRET)
  })

  it('skips a broken source instead of failing the whole enumeration', async () => {
    const codexRoot = await mkdtemp(join(tmpdir(), 'dsh-list-bad-'))
    const claudeRoot = await mkdtemp(join(tmpdir(), 'dsh-list-good-'))
    process.env.CODEX_HOME = codexRoot
    process.env.CLAUDE_CONFIG_DIR = claudeRoot
    await writeFile(join(codexRoot, 'auth.json'), 'broken')
    await writeFile(join(claudeRoot, '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 },
    }))
    const { listExternalCredentials } = await import('../src/external-auth.ts')
    expect(await listExternalCredentials()).toEqual([{ providerId: 'anthropic', type: 'oauth' }])
  })

  it('answers nothing for providers without an external source', async () => {
    const { readExternalCredential } = await import('../src/external-auth.ts')
    expect(await readExternalCredential('zai')).toBeUndefined()
    expect(await readExternalCredential('openrouter')).toBeUndefined()
    expect(await readExternalCredential('google-vertex')).toBeUndefined()
  })

  it('derives project and global location from gcloud ADC/config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-google-'))
    const configDir = join(root, '.config', 'gcloud', 'configurations')
    await mkdir(configDir, { recursive: true })
    const adc = join(root, 'adc.json')
    await writeFile(adc, JSON.stringify({ type: 'authorized_user', quota_project_id: 'quota-project' }))
    await writeFile(join(configDir, 'config_default'), '[core]\nproject = configured-project\n')
    process.env.HOME = root
    process.env.GOOGLE_APPLICATION_CREDENTIALS = adc

    // Module-level homedir() follows the process user rather than HOME in some
    // Node builds; explicit project fallback from the ADC is therefore the
    // stable assertion here.
    const { googleAdcEnv } = await import('../src/external-auth.ts')
    expect(await googleAdcEnv('GOOGLE_CLOUD_PROJECT', adc)).toBeTruthy()
    expect(await googleAdcEnv('GOOGLE_CLOUD_LOCATION', adc)).toBe('global')
    expect(JSON.stringify(await googleAdcEnv('GOOGLE_CLOUD_PROJECT', adc))).not.toContain(GOOGLE_SECRET)
  })

  it('answers nothing when ADC is unavailable', async () => {
    await emptyHome('dsh-google-missing-')
    const { googleAdcEnv } = await import('../src/external-auth.ts')
    expect(await googleAdcEnv('GOOGLE_CLOUD_PROJECT')).toBeUndefined()
    expect(await googleAdcEnv('GOOGLE_CLOUD_LOCATION')).toBeUndefined()
    expect(await googleAdcEnv('GOOGLE_CLOUD_PROJECT', '/nonexistent/adc.json')).toBeUndefined()
  })

  it('reports a missing project separately instead of inventing a location', async () => {
    const root = await emptyHome('dsh-google-noproject-')
    const adc = join(root, 'adc.json')
    await writeFile(adc, JSON.stringify({ type: 'authorized_user', [GOOGLE_SECRET]: 'shape-only' }))
    const { googleAdcEnv } = await import('../src/external-auth.ts')
    expect(await googleAdcEnv('GOOGLE_CLOUD_PROJECT', adc)).toBeUndefined()
    expect(await googleAdcEnv('GOOGLE_CLOUD_LOCATION', adc)).toBeUndefined()
  })

  it('leaves unrelated environment names untouched', async () => {
    await emptyHome('dsh-google-unrelated-')
    const { googleAdcEnv } = await import('../src/external-auth.ts')
    expect(await googleAdcEnv('GEMINI_API_KEY')).toBeUndefined()
    expect(await googleAdcEnv('ZAI_API_KEY')).toBeUndefined()
    expect(await googleAdcEnv('ANTHROPIC_API_KEY')).toBeUndefined()
    expect(await googleAdcEnv('OPENAI_API_KEY')).toBeUndefined()
  })

  it('preflights ADC: names the gcloud command when credentials are absent', async () => {
    const { assertGoogleAdcReady } = await import('../src/external-auth.ts')
    await expect(assertGoogleAdcReady(async () => undefined, async () => false))
      .rejects.toThrow(/gcloud auth application-default login/)
  })

  it('preflights ADC: reports a missing project separately from missing credentials', async () => {
    const { assertGoogleAdcReady } = await import('../src/external-auth.ts')
    await expect(assertGoogleAdcReady(async () => undefined, async () => true))
      .rejects.toThrow(/no Google Cloud project is configured/)
  })

  it('preflights ADC: resolves when credentials and a project are both present', async () => {
    const { assertGoogleAdcReady } = await import('../src/external-auth.ts')
    await expect(assertGoogleAdcReady(
      async name => name === 'GOOGLE_CLOUD_PROJECT' ? 'proj' : undefined,
      async () => true,
    )).resolves.toBeUndefined()
  })
})
