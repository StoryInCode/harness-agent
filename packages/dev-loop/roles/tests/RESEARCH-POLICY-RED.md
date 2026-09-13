# Research policy acceptance freeze

## Scope and authority

Test Writer worked only in the detached `/home/sic/harness-agent/.worktrees/research-policy` worktree. The current main 00.06 and 00.07 plans supplied the specifications. Only `packages/dev-loop/roles` was copied from roles-tests, excluding `lib` and `node_modules`; dependency symlinks point to existing installations and are not deliverables. No production Roles source, branch, commit, or other worktree was edited. The separately authorized startup cleanup and generic deny-only amendments are recorded in `STARTUP-CLEANUP-AMENDMENT.md` and `RESEARCH-DENY-ONLY-AMENDMENT.md`.

`research-harness.ts` extends the existing real Loader fixture without editing `harness.ts` or `model-tools.spec.ts`. Additional Host and standing-preset rows load through test-only configuration files and the real Loader. Fork selection updates the actual Roles Loader entry after its provider is mounted; it does not call a raw provider or mutate private service configuration. The MockAdapter simulates the external model endpoint, including image input capability. All Queue, Worktree, Agent, tool, filesystem, attachment, provider and PTC execution owners are real.

## Exact command and result

Run from the isolated worktree:

```sh
pnpm exec vitest run packages/dev-loop/roles/tests/research-policy.spec.ts --testTimeout=90000 --hookTimeout=90000
```

`research-policy-RED.log` records exit 1: **3 failed, 15 passed, 18 total**. The three failures are behavioral: the Roles Host accepts Research deny-only, empty allow, and empty allow plus deny policies. Each test expects mount rejection before the fixture can enter a model operation. The public mount currently resolves instead. No import, timeout, or fixture failure remains in this freeze.

`RESEARCH-POLICY-SHA256SUMS` freezes both new test files and the exact RED log. `RESEARCH-POLICY-SOURCE-SHA256SUMS` identifies the unchanged copied production sources. Implementer must retain these test bytes. Any necessary fixture correction requires a new explicit baseline.

## Observed positive controls

The actual spawn/fork by native/PTC matrix drives the scoped Brain's `dev_loop_delegate` through scripted model responses. A Host execution probe is the first child call; Host, standing-preset and newly loaded unlisted probe counters remain zero. Real filesystem write, Bash and further-delegation tool calls are refused; independent file checks find no forbidden writes. Actual `read` returns the seeded source, and `read_image` produces a durable image whose stored bytes match the fixture. Native images appear in the tool result; nested PTC images arrive as additional model context. Parent and Implementer writes still modify their intended files. Repeated Research starts remain restricted, and the live registry returns to its parent-only membership.

Unknown, misspelled and reserved names fail before child model invocation without an orphan. Missing and unsupported provider policies fail at Host mount. Model arguments cannot override Host policy. An optional deny list subtracts from a nonempty allowlist. Actual provider-local structured capture remains available in all four provider/presentation combinations and is absent from the parent.

## Inspected admitted implementations and limits

- `packages/fs/tool-fs/src/read.ts:applyReadTool` resolves a regular file, reads through `ctx.fs.readText` or `streamText`, renders a bounded window, and emits a filesystem observation.
- `packages/fs/tool-fs/src/read-image.ts:applyReadImageTool` validates route modality, resolves and reads image bytes through `ctx.fs`, saves them through the attachment service before returning, and returns a durable image reference. Image admission intentionally writes attachment-store objects; this policy does not promise zero process filesystem writes.
- `packages/subagent/subagent-in-process-driver/src/structured.ts:attachStructuredRuntime` registers `structured_output` in the child's own scope, validates the supplied schema, concludes the turn, and commits capture on the authoritative tool result. Roles has no outputSchema option, so this is explicitly a provider-dependency control, not a new Roles policy API.
- Excluded real implementations are `tool-fs` write, `tool-bash` over `bash-local`, and standing-preset `tool-subagent` over spawn. Named counter probes additionally test future inherited contributions without expanding a deny inventory.

A name allowlist does not inspect arbitrary plugin implementations, restrict trusted direct service calls, bound allowed executable effects, or control child-local registration. The local filesystem fixture supplies no sandbox claim. One-shot Roles delegation does not promise persisted filter continuation. These tests do not verify research citations or general repository nonmutation.

## Additional checks and fixture diagnosis

`pnpm exec oxlint packages/dev-loop/roles/tests/research-harness.ts packages/dev-loop/roles/tests/research-policy.spec.ts packages/dev-loop/roles/tests/startup-cleanup.spec.ts` reports zero warnings/errors. `git diff --check` passed. `pnpm exec tsc -p packages/dev-loop/roles/tests/tsconfig.json --pretty false` exits 2 on vendored source strict-mode diagnostics; after package dependency links were completed, no Roles-source or Roles-test diagnostic appears in `research-policy-typescript-deps.log`. This is not a passing typecheck claim.

Initial five-second default Vitest runs timed out during actual Git/provider startup. The explicit 90-second lane budgets above expose the intended assertions rather than fixture deadlines. New-fixture exploratory runs also exposed incorrect whole-context disposal during fork reconfiguration, direct native dispatch against a PTC-only parent, and the distinction between native image results and PTC additional context. Only the new fixture was corrected before this freeze; the exploratory logs remain diagnostic evidence, not acceptance baselines.

## What the evidence teaches

An allowlist admits explicitly named inherited capabilities and excludes future names automatically. Enforcement must be observed at dispatch, not inferred from a missing schema. Here the existing runtime provides filtering before the first child turn; Roles owns selecting and validating the deployment policy. The simple alternative, a deny list, is appropriate only when an owner can enumerate every capability that must remain excluded; it cannot prove exclusion of future inherited contributions. No external prior art was inspected or code reused for these fixtures. The actionable decision is to change the explicit deployment allowlist only after inspecting each added implementation and extending its evidence; filesystem confinement, trusted plugins and continuation remain separate owners.

The separately delegated recorded-session snapshot work is not claimed complete by this policy freeze; its owner records its exact refresh/replay commands and hashes independently.
