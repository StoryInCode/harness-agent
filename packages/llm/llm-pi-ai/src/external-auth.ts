/**
 * Read-only/refreshable bridges to credentials owned by local vendor CLIs.
 *
 * These are fallbacks only. A credential explicitly stored by DeepSeek Harness
 * always wins. The bridge never copies a CLI credential into settings or the
 * Harness credential document.
 */
import { execFile } from 'node:child_process'
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { promisify } from 'node:util'
import type { Credential, CredentialInfo } from '@earendil-works/pi-ai'

const execFileAsync = promisify(execFile)
const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials'
const mutations = new Map<string, Promise<void>>()

type JsonObject = Record<string, unknown>

type ExternalCredential = {
  credential: Credential
  write?: (next: Credential) => Promise<void>
}

function object(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function missing(error: unknown): boolean {
  return object(error)?.code === 'ENOENT'
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return resolvePath(homedir(), path.slice(2))
  return path
}

function jwtPayload(token: string): JsonObject | undefined {
  try {
    const encoded = token.split('.')[1]
    if (encoded === undefined) return undefined
    return object(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')))
  } catch {
    return undefined
  }
}

function jwtExpiry(token: string): number {
  const exp = number(jwtPayload(token)?.exp)
  // Unknown expiry should force pi-ai through its refresh path instead of
  // silently trusting an opaque token forever.
  return exp === undefined ? 0 : exp * 1000
}

function codexAccountId(token: string, document: JsonObject): string | undefined {
  const tokens = object(document.tokens)
  const stored = string(tokens?.account_id) ?? string(document.account_id)
  if (stored !== undefined) return stored
  const auth = object(jwtPayload(token)?.['https://api.openai.com/auth'])
  return string(auth?.chatgpt_account_id)
}

/**
 * Locate Codex's credential file without reading it.
 * @returns auth.json under CODEX_HOME, or under ~/.codex when unset.
 */
export function defaultCodexAuthPath(): string {
  const root = process.env.CODEX_HOME
  return root === undefined ? join(homedir(), '.codex', 'auth.json') : join(root, 'auth.json')
}

/**
 * Locate Claude Code's credential file without reading it.
 * @returns .credentials.json under CLAUDE_CONFIG_DIR, or under ~/.claude when unset.
 */
export function defaultClaudeAuthPath(): string {
  const root = process.env.CLAUDE_CONFIG_DIR
  return root === undefined ? join(homedir(), '.claude', '.credentials.json') : join(root, '.credentials.json')
}

async function readJson(path: string): Promise<JsonObject | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (missing(error)) return undefined
    // A malformed or unreadable token file must not masquerade as a missing
    // login: the remediation differs, and neither message may echo content.
    const code = object(error)?.code
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(
        `the credential file at ${path} is not readable by this process (permission denied);`
        + ' fix its permissions or sign in again with the vendor CLI',
      )
    }
    throw error
  }
  try {
    return object(JSON.parse(raw))
  } catch {
    throw new Error(
      `the credential file at ${path} is not valid JSON; sign in again with the vendor CLI to recreate it`,
    )
  }
}

/** Atomic secret-file rewrite, preserving its existing permission bits. */
async function writeJsonSecret(path: string, value: JsonObject): Promise<void> {
  let mode = 0o600
  try {
    // Never preserve group/world readability on a token file.
    mode = ((await stat(path)).mode & 0o600) || 0o600
  } catch (error) {
    if (!missing(error)) throw error
  }
  const temp = join(dirname(path), `.${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`)
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode })
  try {
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

async function codexCredential(): Promise<ExternalCredential | undefined> {
  const path = defaultCodexAuthPath()
  const document = await readJson(path)
  if (document === undefined) return undefined
  const tokens = object(document.tokens)
  const access = string(tokens?.access_token)
  const refresh = string(tokens?.refresh_token)
  if (access === undefined || refresh === undefined) return undefined
  const accountId = codexAccountId(access, document)
  if (accountId === undefined) return undefined

  return {
    credential: {
      type: 'oauth',
      access,
      refresh,
      expires: jwtExpiry(access),
      accountId,
    },
    async write(next) {
      if (next.type !== 'oauth') return
      const latest = await readJson(path) ?? document
      const latestTokens = object(latest.tokens) ?? {}
      await writeJsonSecret(path, {
        ...latest,
        tokens: {
          ...latestTokens,
          access_token: next.access,
          refresh_token: next.refresh,
          account_id: string(next.accountId) ?? string(latestTokens.account_id) ?? accountId,
        },
        last_refresh: new Date().toISOString(),
      })
    },
  }
}

function claudeOauthFromDocument(document: JsonObject): Credential | undefined {
  const oauth = object(document.claudeAiOauth)
  const access = string(oauth?.accessToken)
  const refresh = string(oauth?.refreshToken)
  if (access !== undefined && refresh !== undefined) {
    const expiresAt = number(oauth?.expiresAt)
    return {
      type: 'oauth',
      access,
      refresh,
      expires: expiresAt ?? jwtExpiry(access),
      ...string(oauth?.scope) === undefined ? {} : { scope: string(oauth?.scope) },
    }
  }

  // Older Claude Code builds stored an access token without the refresh half.
  // Anthropic's provider accepts that token through its api-key-shaped request
  // auth path; Claude Code remains responsible for rotating it.
  const first = Array.isArray(document.tokens) ? object(document.tokens[0]) : undefined
  const legacy = string(first?.accessToken) ?? string(first?.authToken) ?? string(document.accessToken)
  return legacy === undefined ? undefined : { type: 'api_key', key: legacy }
}

async function claudeFileCredential(): Promise<ExternalCredential | undefined> {
  const path = defaultClaudeAuthPath()
  const document = await readJson(path)
  if (document === undefined) return undefined
  const credential = claudeOauthFromDocument(document)
  if (credential === undefined) return undefined
  return {
    credential,
    ...(credential.type !== 'oauth' ? {} : {
      write: async (next: Credential): Promise<void> => {
        if (next.type !== 'oauth') return
        const latest = await readJson(path) ?? document
        const oauth = object(latest.claudeAiOauth) ?? {}
        await writeJsonSecret(path, {
          ...latest,
          claudeAiOauth: {
            ...oauth,
            accessToken: next.access,
            refreshToken: next.refresh,
            expiresAt: next.expires,
          },
        })
      },
    }),
  }
}

async function readClaudeKeychain(): Promise<JsonObject | undefined> {
  if (process.platform !== 'darwin') return undefined
  try {
    const { stdout } = await execFileAsync(
      'security',
      ['find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE, '-w'],
      { maxBuffer: 1024 * 1024 },
    )
    const raw = stdout.trim()
    return raw.length === 0 ? undefined : object(JSON.parse(raw))
  } catch {
    return undefined
  }
}

async function writeClaudeKeychain(document: JsonObject): Promise<void> {
  try {
    await execFileAsync(
      'security',
      [
        'add-generic-password', '-U',
        '-a', userInfo().username,
        '-s', CLAUDE_KEYCHAIN_SERVICE,
        '-w', JSON.stringify(document),
      ],
      { maxBuffer: 1024 * 1024 },
    )
  } catch (error) {
    // execFile embeds the full argv in its error message, and that argv carries
    // the token document; rethrow a message that names the operation only.
    const status = object(error)?.code
    throw new Error(
      'writing the refreshed Claude Code credential to the macOS Keychain failed'
      + (typeof status === 'string' ? ` (${status})` : ''),
    )
  }
}

async function claudeKeychainCredential(): Promise<ExternalCredential | undefined> {
  const document = await readClaudeKeychain()
  if (document === undefined) return undefined
  const credential = claudeOauthFromDocument(document)
  if (credential === undefined) return undefined
  return {
    credential,
    ...(credential.type !== 'oauth' ? {} : {
      write: async (next: Credential): Promise<void> => {
        if (next.type !== 'oauth') return
        const latest = await readClaudeKeychain() ?? document
        const oauth = object(latest.claudeAiOauth) ?? {}
        await writeClaudeKeychain({
          ...latest,
          claudeAiOauth: {
            ...oauth,
            accessToken: next.access,
            refreshToken: next.refresh,
            expiresAt: next.expires,
          },
        })
      },
    }),
  }
}

async function claudeCredential(): Promise<ExternalCredential | undefined> {
  // File first for Linux/legacy installs; Keychain second for current macOS Claude Code.
  return await claudeFileCredential() ?? await claudeKeychainCredential()
}

async function external(providerId: string): Promise<ExternalCredential | undefined> {
  switch (providerId) {
    case 'openai-codex': return codexCredential()
    case 'anthropic': return claudeCredential()
    default: return undefined
  }
}

/**
 * Read a vendor-CLI credential without persisting it into Harness.
 * @param providerId - provider identifier; openai-codex and anthropic have external stores.
 * @returns the external credential, or undefined when no supported credential is available.
 */
export async function readExternalCredential(providerId: string): Promise<Credential | undefined> {
  return (await external(providerId))?.credential
}

/**
 * Run pi-ai's locked refresh mutation against the vendor-owned credential.
 * Returns `handled=false` when this provider has no external credential, so the
 * caller can fall back to Harness's normal credential store.
 * @param providerId - provider whose external credential is eligible for refresh.
 * @param mutate - pure refresh mutation, first probed with undefined to distinguish login from refresh.
 * @returns whether the external store handled the refresh and its retained or updated credential.
 */
export async function modifyExternalCredential(
  providerId: string,
  mutate: (current: Credential | undefined) => Promise<Credential | undefined>,
): Promise<{ handled: boolean; credential?: Credential }> {
  let result: { handled: boolean; credential?: Credential } = { handled: false }
  const previous = mutations.get(providerId) ?? Promise.resolve()
  const operation = previous.catch(() => undefined).then(async () => {
    const source = await external(providerId)
    if (source === undefined || source.write === undefined) return
    // Classify the mutation before it touches the vendor store. pi-ai reaches
    // `modify` for two unrelated reasons: a login commit, whose mutation
    // ignores `current` and returns the freshly obtained credential, and a
    // refresh, whose mutation derives its result from `current` and answers
    // `undefined` for a missing one. Only a refresh of the vendor-owned grant
    // belongs in the vendor store; a login must commit a Harness record, so it
    // falls through to the caller's normal path. Both known mutation shapes
    // are pure, so the probing call is safe to repeat.
    if (await mutate(undefined) !== undefined) return
    const next = await mutate(source.credential)
    if (next === undefined) {
      result = { handled: true, credential: source.credential }
      return
    }
    await source.write(next)
    result = { handled: true, credential: next }
  })
  const tail = operation.then(() => undefined, () => undefined)
  mutations.set(providerId, tail)
  try {
    await operation
  } finally {
    if (mutations.get(providerId) === tail) mutations.delete(providerId)
  }
  return result
}

/**
 * List non-secret status rows for externally-owned credentials.
 * @returns provider ids and credential types for readable stores; unavailable or malformed stores are omitted.
 */
export async function listExternalCredentials(): Promise<CredentialInfo[]> {
  const result: CredentialInfo[] = []
  for (const providerId of ['openai-codex', 'anthropic']) {
    try {
      const credential = await readExternalCredential(providerId)
      if (credential !== undefined) result.push({ providerId, type: credential.type })
    } catch {
      // Status enumeration must not make an unrelated malformed CLI credential
      // take the entire Models page down. A request still fails loudly.
    }
  }
  return result
}

function defaultAdcPath(): string {
  return process.env.GOOGLE_APPLICATION_CREDENTIALS
    ?? join(homedir(), '.config', 'gcloud', 'application_default_credentials.json')
}

async function googleProjectFromConfig(): Promise<string | undefined> {
  const path = join(homedir(), '.config', 'gcloud', 'configurations', 'config_default')
  try {
    const raw = await readFile(path, 'utf8')
    let section = ''
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      const sectionMatch = /^\[([^\]]+)\]$/.exec(trimmed)
      if (sectionMatch !== null) {
        section = sectionMatch[1] ?? ''
        continue
      }
      if (section !== 'core') continue
      const projectMatch = /^project\s*=\s*(.+)$/.exec(trimmed)
      if (projectMatch !== null) return projectMatch[1]?.trim()
    }
  } catch (error) {
    if (!missing(error)) throw error
  }
  return undefined
}

/**
 * Fill the two values pi-ai's `google-vertex` provider needs on top of ADC.
 * Explicit Harness/environment values are resolved by the caller first.
 * @param name - GOOGLE_CLOUD_PROJECT, GCLOUD_PROJECT, or GOOGLE_CLOUD_LOCATION; other names are unsupported.
 * @param credentialsPath - optional ADC file path; otherwise the environment or default gcloud path is used.
 * @returns the resolved project, or global for location when a project exists; otherwise undefined.
 */
export async function googleAdcEnv(
  name: string,
  credentialsPath?: string,
): Promise<string | undefined> {
  if (name !== 'GOOGLE_CLOUD_PROJECT' && name !== 'GCLOUD_PROJECT' && name !== 'GOOGLE_CLOUD_LOCATION') {
    return undefined
  }
  const path = expandHome(credentialsPath ?? defaultAdcPath())
  const document = await readJson(path)
  if (document === undefined) return undefined

  const project = await googleProjectFromConfig()
    ?? string(document.project_id)
    ?? string(document.quota_project_id)
  if (project === undefined) return undefined
  if (name === 'GOOGLE_CLOUD_LOCATION') return 'global'
  return project
}

/**
 * Pre-flight the two facts pi-ai's `google-vertex` provider needs on top of
 * ADC, so a missing setup reaches the operator as an actionable instruction
 * instead of pi-ai's generic "Provider is not configured". `env` must answer
 * through the same resolution the request itself will use (stored references,
 * then the launch environment, then the ADC-derived fallbacks).
 * @param env - resolve one provider environment name.
 * @param fileExists - whether a credential path exists.
 * @throws Error naming the missing Google setup; never any credential content.
 */
export async function assertGoogleAdcReady(
  env: (name: string) => Promise<string | undefined>,
  fileExists: (path: string) => Promise<boolean>,
): Promise<void> {
  const adcPath = (await env('GOOGLE_APPLICATION_CREDENTIALS')) ?? defaultAdcPath()
  if (!(await fileExists(expandHome(adcPath)))) {
    throw new Error(
      'Google Application Default Credentials were not found.'
      + ' Run: gcloud auth application-default login, then retry.',
    )
  }
  const project = await env('GOOGLE_CLOUD_PROJECT') ?? await env('GCLOUD_PROJECT')
  if (project === undefined) {
    throw new Error(
      'Google authentication succeeded, but no Google Cloud project is configured.'
      + ' Run: gcloud config set project YOUR_PROJECT_ID (or set GOOGLE_CLOUD_PROJECT), then retry.',
    )
  }
}
