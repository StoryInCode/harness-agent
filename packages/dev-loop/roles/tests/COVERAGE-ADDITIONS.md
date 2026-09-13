# Public-path coverage additions

## Measured result

Seventeen new cases in three new specs passed alongside all thirty existing cases: **47 tests passed in 11 files, 23.11s wall time**. These additions are GREEN behavioral coverage against the parent's frozen implementation, not a new RED baseline. All five runtime/type source hashes matched the parent's supplied values before and after measurement. `coverage-additions-source.sha256` records that source snapshot; later authorized implementation changes do not alter this historical measurement.

The strict per-file coverage gate still **exited 1**. No threshold, source exclusion, ignore directive, production API, frozen acceptance assertion, or business service was changed.

| Source | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| All runtime files | 96.47% | 94.17% | 100% | 98.57% |
| config.ts | 100% | 100% | 100% | 100% |
| index.ts | 94.38% | 91.22% | 100% | 97.29% |
| records.ts | 100% | 100% | 100% | 100% |
| tool.ts | 97.72% | 92.85% | 100% | 100% |

The parent's preceding thirty-case measurement was 92.35% statements, 70.87% branches, 100% functions and 95.71% lines. The new run includes all four runtime modules; `types.ts` is excluded by the unchanged repository-wide type-only rule in `vitest.config.ts:209–210`, not by a local coverage exception.

## Executed commands

From `/home/sic/harness-agent/.worktrees/roles-tests`:

```sh
pnpm exec vitest run packages/dev-loop/roles/tests --testTimeout=90000 --hookTimeout=90000 --coverage --coverage.include='packages/dev-loop/roles/src/**/*.ts' --coverage.reportsDirectory=/tmp/dsh-roles-coverage-additions-87VbHh
pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/roles/tests/coverage-*.spec.ts
```

The report directory was allocated with `mktemp`. Paired 90000ms test/hook budgets are the previously authorized CI invocation budgets; no case deadline or runtime command budget changed. Full output: `coverage-additions-full-vitest.log`. HTML: `/tmp/dsh-roles-coverage-additions-87VbHh/index.html` and the four source pages. Actual repository Oxlint passed with 0 warnings/errors on 3 files; output: `coverage-additions-final-oxlint.log`. No new TypeScript-program, snapshot, build, full repository suite, commit, install, or independent review result is claimed.

## New case outcomes

Every case below passed in the assembled coverage run.

- `coverage-public.spec.ts` — 10 cases: real cwd-less initiator; missing-piece Queue admission; caller-provided string abort reason; explicit model options/depth/verification plus actual preset-attributed reopen; provider depth refusal with retained assignment; max-token partial report; actual child-local cancellation with parent signal still live; model error stop; terminal metadata overflow after a completed child; terminal metadata overflow after admission failure. The latter two preserve and reopen unresolved requested verification; their actual AggregateErrors distinguish one terminal-record failure from admission plus terminal-record failure.
- `coverage-durable.spec.ts` — 1 case: authoritative JSON parser inputs for tied requested/partial settled rows, missing child/assignment/stop metadata, retained preset attribution, piece filtering, stable id tie order, and detached returned history. These persisted vectors do not claim that the fixture executed the historical children.
- `coverage-config-tools.spec.ts` — 6 cases: whitespace-only provider; whitespace-only persona; missing allow/deny filter; actual deny-only inherited model schemas; oversized unrecognized model JSON field bounded by the final content renderer; actual published caller disposed during the public pre-execute gate.

Fixtures use the existing real YAML Loader, AgentLoop, tool runtime, Queue, Worktree, storage domain and spawn provider. Model responses alone are scripted. Public `AbortController.abort(string)` supplies the non-Error reason; no typed business API receives a forged value. The stale-caller case disposes a real published Agent and delegates the waterfall with `next()`; it never fabricates an Agent or invokes a private executor. Every fixture joins context disposal before deleting its private roots.

## Remaining twelve uncovered locations

Coordinates refer to the frozen source snapshot, not a later implementation revision.

| Source coordinates | Remaining behavior or limitation |
|---|---|
| index.ts 118:7 branch, 118:44 statement | AggregateError interpreted as unproven cleanup |
| index.ts 122:11 and 123:11 statements | Actual Queue cancellation/lease cleanup rejection and combined execution/cleanup failure |
| index.ts 137:5 branch, 137:33 statement, 141:37 branch | Failed status and limitation for unproven cleanup |
| index.ts 149:83 branch | Redundant non-text fallback after the preceding `output.some(nontext)` rejection already established all-text output |
| index.ts 151:9 branch, 151:46 statement | Diagnostic on a returned compatible provider result |
| tool.ts 42:5 branch, 42:68 statement | Consumer-local invalid-caller throw |

No honest actual rejecting provider lease was established. A thrown Cordis effect disposer is not such evidence; the prior discarded fixture must not be reinstated. Existing Queue-level controlled-lease tests prove Queue's own behavior but not Roles' real cleanup-failure integration. Fabricating an AggregateError merely to increment these counters would not prove the required lifetime behavior.

The shipped spawn/fork providers advertise both required persona and inherited-filter capabilities; their shared in-process driver does not emit a diagnostic field. Other provider adapters can emit diagnostics but have no demonstrated Roles-compatible composition in this fixture. That explicit outcome requirement remains implemented and uncovered; the absence of a current fixture does not authorize deleting it.

The real published-caller disposal case is rejected before the Roles tool body: ToolRuntime re-resolves the scoped tool after the pre-execute gate (`packages/core/tools/src/index.ts:1536–1537`). Thus it proves safe denial, not the consumer-local guard branch. No global mis-mount or fake Agent was added to bypass scoped lookup for coverage.

Only the redundant non-text fallback is identified as a narrow source simplification candidate. Production remains owned by the Implementer; these tests do not remove guards, future-provider diagnostics, or cleanup semantics to satisfy counters.

## Exploratory corrections and freeze

The initial new-only invocation had 15 passes and two unfrozen fixture expectation failures: failed aborts retain explicit failure text rather than an empty string, and the generic enum parser does not echo an oversized invalid value. The latter fixture now supplies an oversized unrecognized JSON key through the actual strict model parser. A focused two-case invocation passed before the single assembled coverage measurement. Those exploratory/correction logs are preserved separately; neither was labeled a production defect.

`COVERAGE-ADDITIONS-SHA256SUMS` freezes the three new specs and their evidence. Existing thirty-case files and prior reports/manifests remain unchanged. The source hold was released to the parent after the measured results, remaining locations and new spec hashes were delivered. The gate remains below 100%; this handoff is not completion of that gate.
