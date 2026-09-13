/** Keyless CLI protocol fixture; this executable does not mount Cordis. */
import { argv, cwd, env, stdin, stdout, stderr } from 'node:process'

let input = ''
for await (const chunk of stdin) input += chunk
const task = JSON.parse(input).message.content
const response = task === 'environment'
  ? JSON.stringify({ cwd: cwd(), token: env.ANTIGRAVITY_EXPLICIT_TOKEN, inherited: env.DSH_HOME, args: argv.slice(2) })
  : task
stderr.write('private-stderr-must-not-escape\n')
if (task === 'wait') {
  stdout.write(JSON.stringify({ event: 'init', init: {} }) + '\n')
  setInterval(() => {}, 1000)
} else {
  stdout.write(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response } }) + '\n')
}
