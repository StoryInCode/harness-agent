#!/usr/bin/env node
/** External native CLI fixture: validate argv, workspace, stdin framing, and EOF. */

import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

assert.equal(process.cwd(), dirname(fileURLToPath(import.meta.url)))
assert.deepEqual(process.argv.slice(2), [
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--print-timeout', '30000ms',
  '--model', 'fixture-native-model',
])
let input = ''
for await (const chunk of process.stdin) input += chunk
assert.equal(input, `${JSON.stringify({
  event: 'user',
  message: { content: 'Return the native delegation marker.' },
})}\n`)
process.stdout.write(`${JSON.stringify({ event: 'progress', text: 'not the final answer' })}\n`)
process.stdout.write(`${JSON.stringify({
  event: 'result',
  result: { status: 'SUCCESS', response: 'Native Antigravity delegation completed.' },
})}\n`)
