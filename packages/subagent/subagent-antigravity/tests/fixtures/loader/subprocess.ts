/** External-process guard: registration may neither probe nor launch an installed CLI. */

import {
  SubprocessRuntime,
  type SubprocessHandle,
  type SubprocessTerminalHandle,
} from '@deepseek-ai/dsh-subprocess'

/** Count even swallowed subprocess attempts and prevent every external launch. */
export default class DormantSubprocess extends SubprocessRuntime {
  calls = 0

  async resolveExecutable(): Promise<string> {
    this.calls += 1
    throw new Error('Antigravity Loader composition must not resolve executables')
  }

  spawn(): SubprocessHandle {
    this.calls += 1
    throw new Error('Antigravity Loader composition must not spawn processes')
  }

  async spawnTerminal(): Promise<SubprocessTerminalHandle> {
    this.calls += 1
    throw new Error('Antigravity Loader composition must not spawn terminals')
  }
}
