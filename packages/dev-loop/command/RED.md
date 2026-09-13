# 00.11 command behavioral RED handoff

## Authority and scope

Test Writer authored only `packages/dev-loop/command` in the detached `command-tests` worktree. The accepted specification is the amended 00.11 text transferred by the parent to master at `a35ad037e2`; the older specification inside this detached worktree is not authoritative. The amended command grammar and failure/budget paragraphs were reread from the main checkout. No branch or commit was created. No production behavior, invented service, persistence implementation, SDK command API, or shared snapshot adapter was added.

The source entry is an inert compiling named-export Consumer. Its sole behavior is effect-owned registration of `dev-loop`, with an attachment-free input hint and the fixed error `dev-loop behavior is not implemented`. Config carries required numeric fields but deliberately does not implement validation. The Implementer replaces this scaffold, not the frozen tests.

## Exact execution evidence

Run from `/home/sic/harness-agent/.worktrees/command-tests`:

```sh
pnpm exec vitest run packages/dev-loop/command/tests --reporter=json --outputFile=packages/dev-loop/command/red-results.json
```

Observed exit 1: **80 tests, 77 failed, 3 passed, 0 skipped**. All three files import and run. Failures are missing successful behavior, missing specific diagnostics, absent config rejection, or commands settling before their required filesystem/transition wait. There are no import/type/fixture-setup failures in this recorded baseline.

| File | Failed | Passed |
|---|---:|---:|
| `tests/command.spec.ts` | 48 | 2 |
| `tests/limits-cancellation.spec.ts` | 16 | 1 |
| `tests/observations.spec.ts` | 13 | 0 |

The three existing/scaffold behaviors pass: reversible named registration, runtime attachment refusal and runtime pre-abort rejection. Representative RED: `dev-loop behavior is not implemented: expected 'error' to be 'success'`. Cancellation barriers fail explicitly with `command settled before source read` or `command settled before transition`, not by a timeout.

Other commands actually run:

- `pnpm exec tsc -b packages/dev-loop/command --pretty false` — exit 0, compiling the inert package and declared dependency graph.
- `pnpm exec tsc -b vendor/include --pretty false` — exit 0, creating vendor declarations for the owner test program.
- `pnpm exec tsc -p packages/dev-loop/command/tsconfig.tests.json --pretty false` — final exit 0 with strict tests/source types. Explicit vendor project references preserve upstream compiler settings rather than applying repository strictness to vendor source.
- `pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/command` — final exit 0, 0 warnings and 0 errors on six TypeScript files.
- `git diff --check` — exit 0. `git status --short` reports only the new command package.

Initial dependency resolution failed because the detached tree lacked package-local `zod`. The parent authorized dependency provisioning from existing main modules; real ignored `node_modules` directories contain links to existing packages. No install, lockfile edit, upgrade or main-source edit occurred. Initial owner type and lint defects were corrected before this freeze; they are not counted as behavioral RED. The volatile JSON report is execution evidence, not a product snapshot or a frozen oracle.

## Frozen SHA-256

Paths below are relative to the repository root. The tests and owner test compiler configuration are frozen; any correction returns to the Test Writer and requires a new baseline.

| Path | SHA-256 |
|---|---|
| `packages/dev-loop/command/tests/command.spec.ts` | `45d30f184b6cbf136cad7c76c8312a8368e8337e3ee677e3939795359d660d10` |
| `packages/dev-loop/command/tests/harness.ts` | `8ef9d379b3a05cfd517870ea2674993da7aa297ac6a6e151dc1edd0899227492` |
| `packages/dev-loop/command/tests/limits-cancellation.spec.ts` | `3f9c5d74ece79de4362965b99f77d27b5448e5104dd4621551a1d3ddce0e5fdf` |
| `packages/dev-loop/command/tests/observations.spec.ts` | `a82ccc316cbe259860e0dd1bc8a5833e4ef38cbb8b8da503c0637fc21880a9a3` |
| `packages/dev-loop/command/tsconfig.tests.json` | `5f0eca3175d130b974c6ebda7a2a159aed06a3e51069550f0a567da4bc8ac191` |

Replaceable scaffold observations: `src/index.ts` = `8017eb43ed023fa8b6c3396b46b654ee96512a70a4f2bd948dc00ae651434400`; `src/types.ts` = `96e07a68a7264d5ff82a867e59c6426e1868059704d1d2489472608092bdd7c5`.

## What the tests require

The fixture composes real source implementations through Loader's official builtin registry and an actual temporary `cordis.yml`. Agents and the production AgentLoop come from the repository testkit. Source fixtures are valid Directory inputs, not fabricated records. Queue counts and ordering come from actual admissions and held external worker leases, not mocked scalar services. Each private root and Context is torn down after joins; no sleeps, fixed ports, process-global clock or environment mutation is used.

- All grammar routes, complete usage, whitespace, malformed/missing/extra inputs, invalid ids/digests, runtime attachments and literal multiword reject reasons.
- Full source and its exact raw SHA-256; same-length edits, changes during the review read, disappearance and malformed sources refuse review/approval.
- Exact live root identity: real child, same-id lookalike, disposed owner and owner removed during an awaited lookup cannot mutate state.
- Approval requests only the existing five-argument todo-to-pending transition, preserves source bytes and creates no Queue request. Reject requests pending-to-blocked with the full trimmed reason. Illegal initial states never call transition. A competing real Lifecycle writer causes compare-and-set refusal.
- Deterministic set/queue/id list ordering, current logical status instead of the disk header, malformed-source visibility, empty state, live starting/running reservations, changed live counts, timestamped status, Queue priority/FIFO order, positions, admission timestamps and current declared dependency diagnostics.
- Positive safe integer configuration, invalid tiny output configuration, exact derived refusal minimum, complete UTF-8 input/result bounds, multibyte reasons/source, and whole-result refusal for overflowing observations. The owned result envelope is measured as UTF-8 `JSON.stringify(CommandResult)`; command ids and Session event envelopes are runtime-owned and are not charged to this Consumer.
- Signals reach real source and writer calls. Runtime cancellation rejects as the runtime specifies. Defects remain thrown and log an error settlement. The command Session log preserves exact raw input and returned text paired by the actual generated command id, without a model turn.

## Accepted contradictions and deferred integration

Direct source inspection found that CommandRuntime rejects pre-aborted requests and races in-flight cancellation, and its attachment refusal has no usage suffix. The parent accepted and amended these exceptions before freeze. A positive one-byte output budget cannot represent a useful error; the parent amended the spec to require a minimum derived from the fixed complete refusal envelope. Tests do not alter these runtime behaviors to satisfy an inaccurate promise.

Lifecycle in this worktree is memory-only and takes five arguments. No frozen test claims durable acceptance. The 00.12 integration owner must return to the Test Writer to extend authorization assertions to actual `invocation.commandId`, receiving Session id and observed source digests/version, and then prove direct Lifecycle durable enforcement. Caller JSON cannot supply that authority. The parent reported a candidate authorization DTO; it is not imported or frozen here.

Package installation/aggregate wiring, repository Agent Note, bilingual/current-state product documentation and final integration gates remain with the parent/Implementer. No aggregate or shared infrastructure source was changed under this limited ownership.

## Keyless Session snapshot plan

Direct inspection of `snapshots/sdk/sdk.snapshot.ts` and SDK source found no command-execution action in the ordinary SDK replay adapter. The existing Web goal-command test uses an in-process scaffold; it does not establish a shipped-profile process replay. Therefore no ordinary user-message fixture was invented and no model prompt was used to simulate human authority.

The parent delegated a separate snapshot specialist for the new command-only Web/public-protocol adapter. Parent-provided Research findings, not execution by this Test Writer, identify `dsh --profile web --no-open --port 0`, the launch-token-to-cookie exchange, public `POST /api/session/create` and `POST /api/commands/execute`, and graceful shutdown before normalized JSONL comparison. A command-only fixture can derive its ordered requests from committed `command/run` events and compare actual paired `command/done` results. It needs explicit top-level corpus adapter ownership; no existing ordinary headless/SDK adapter is claimed to support it.

The requested owner scenario should exercise empty queue, help, a rejected grammar request and a full show in one root Session, with zero model calls. Its workspace seed owns exact piece bytes; the Session owns human-visible output. Add approve/reject and actual authorization identity when 00.12 is composed. After process restart, activate/adopt the same Session before command dispatch; the public command route resolves only live Agents. Loader Session assertions in this baseline supplement, but do not replace, that separately owned replay.

## Teach while building

**What it does:** This handoff separates missing command behavior from broken test setup. **Background:** A behavioral RED is a running assertion that fails because the feature is absent. Compare-and-set is a writer request that includes the expected current status, so another writer cannot silently overwrite it. **How it works here:** `tests/harness.ts` mounts real services; each case calls CommandRuntime, which supplies identity and logs the result. `observations.spec.ts` obtains live reservations from Queue itself. **Why this approach:** Directly calling a private parser would be cheaper, but would miss registration, admission, raw whitespace, identity and logging. That approach is appropriate only as supplementary parser unit coverage.

**Approaches considered:** Real Loader dispatch was selected over isolated handler tests and fabricated service returns. Existing SDK replay was inspected but lacks a command action; a separately owned shipped-Web protocol adapter is the feasible snapshot route reported by Research. This is a narrow Harness-integration testing task; no unrelated external parser or competing application architecture was adopted. **Prior art inspected:** No external project was inspected or reused. Vendored Cordis Entry/Loader source was read to use its existing entry/fiber disposal mechanism.

**What comes from the framework:** Cordis owns effects and injected service topology; CommandRuntime owns slash-command dispatch, attachment admission, command ids and paired logging; Directory owns parsing; Lifecycle owns legal transitions; Queue owns admission order and live reservations. **From the docs:** `docs/testing.md` says “Verify the world, not the self-report.” These tests reread source bytes and inspect actual Lifecycle/Queue state instead of accepting success text as proof of mutation.

**What to notice:** Approval's unchanged-source assertion proves memory-only semantics, not persistence. The cancellation barriers reject immediately when the inert command never reaches the expected dependency. **Concepts to own:** Optimistic concurrency appears in digest rechecks and expected-status writes; object identity appears in the live-root checks; resource ownership appears in private roots, release barriers and awaited teardown. **Interview angle:** “How do you avoid approving a changed specification?” Require the human's exact digest and recheck the bytes before the sole writer request; the next question is how the durable writer enforces that after restart, which belongs to 00.12.

**Decisions the Implementer can make:** Choose rendering details and internal decomposition while meeting complete grammar, required observations and byte accounting. Escalate test corrections, new Lifecycle edges, authorization DTO changes and snapshot infrastructure to their owners. **Transferable lesson:** A passing parser test cannot establish who authorized a mutation or whether its result was durably recorded.
