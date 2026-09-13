# Bounded supplemental acceptance freeze

## Scope and outcome

Eight new tests in three new specs passed against the Implementer's held source in `/home/sic/harness-agent/.worktrees/roles-tests`. The Test Writer changed no runtime source, package manifest, root config, frozen fixture, or original baseline assertion. The only authorized original-test amendment is the five storage identifiers documented in `domain-amendment.md`. Original RED logs and hashes remain historical and were not overwritten.

No installation, branch, commit, independent review, moving-source coverage measurement, or 007 policy expansion was performed. These tests freeze GREEN acceptance evidence against the implementation observed during the parent-coordinated hold; they are not a RED baseline against the original stubs and do not establish full-piece coverage.

## Executed commands

From the prepared worktree root:

```sh
pnpm exec vitest run packages/dev-loop/roles/tests/supplemental-bounds.spec.ts packages/dev-loop/roles/tests/supplemental-lifecycle.spec.ts packages/dev-loop/roles/tests/supplemental-ptc.spec.ts --testTimeout=90000 --hookTimeout=90000
pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/roles/tests/supplemental-*.spec.ts
pnpm exec vitest run packages/dev-loop/queue/tests/queue.spec.ts -t 'fails closed when lease cleanup rejects|rejects Error cancellation and the ticket result with the same lease cleanup error' --testTimeout=90000 --hookTimeout=90000
```

- Supplemental tests: exit 0; 3 files, 8 tests passed; 18.71s wall time. No skips or unhandled errors on this Linux run.
- Actual repository Oxlint runner: exit 0; 3 files, 0 warnings and 0 errors. No ESLint substitution.
- Existing Queue evidence: exit 0; 2 selected cases passed, 38 unrelated cases filtered/skipped; 927ms wall time. This is not an assertion that all 40 Queue cases were executed.

Logs: `supplemental-vitest.log`, `supplemental-oxlint.log`, and `supplemental-queue-evidence.log`.

## Per-case evidence

| Case | Result | Reported duration |
|---|---|---|
| Exact multibyte brief accepted; one byte less rejected before intent | Passed | 2900ms |
| Complete persisted outcome metadata/text envelope at exact equality; one byte less fails without clipped completion | Passed | 8693ms |
| Complete rendered history envelope at exact equality; one byte less returns explicit overflow and preserves full history | Passed | 3037ms |
| Reasoning-only, non-text provider outcome recorded as failed | Passed | 2997ms |
| Cancellation during real Git worktree allocation before child creation | Passed | 2765ms |
| Cancellation at actual child publication before the provider returns its lease | Passed | 2669ms |
| Roles Research write denied through a real PTC worker; no write filesystem effect | Passed | 2964ms |
| Existing SubagentRuntime spawn keeps child-local structured capture under inherited allow filtering | Passed | Not separately printed by Vitest |

The exact-outcome case compares complete serialized records across three adjacent private fixtures. UUIDs, private-root components, Git ids, and epoch timestamps have equal serialized widths there; the test independently asserts the resulting byte equality rather than normalizing fields away. The history test measures real generous-budget rendered output, then uses separate real scoped consumers at the measured exact limit and one byte below it. No private service configuration is read.

## Lifetime and authority

The unchanged fixture awaits real context disposal before removing each private Git repository. The allocation case uses an executable Git post-checkout hook as an external-process readiness barrier, closes its filesystem watcher, cancels and joins the actual delegation, and observes empty Queue capacity. It is explicitly skipped on Windows because that fixture uses a POSIX executable hook. The publication case observes the actual child in the registry during start, then proves its removal; the failed start returns no lease, so Roles correctly records no acquired child id.

PTC runs the actual worker-thread code runtime, not a mock code executor. Its denied inherited write produces an error result and no file. That is tool-policy evidence, not a filesystem sandbox or restriction on arbitrary worker JavaScript. The separate structured-output case calls existing `SubagentRuntime.start` with its public `outputSchema` and `toolFilter`; Roles has no `outputSchema` field. Child-local structured capture is owned by that existing provider, remains available under inherited filtering, and is explicitly disposed after the result. No post-start Research guard or fictional role metadata was added.

## Limits and discarded fixture

A proposed child `ctx.effect` disposer exception did not produce a failed one-shot lease through the actual runtime and therefore was removed before freeze. Treating it as a Roles cleanup failure would invent a guarantee. The two executed existing Queue cases establish Queue's behavior when its consumer-supplied lease rejects disposal, but they use the Queue's existing controlled lease fixture; they do not prove Roles persists an unproven-cleanup observation through an actual external provider. That integration remains unproven here. No business-service mock was introduced to fill it.

Existing subagent structured tests were searched, but no combined inherited-filter plus child-local-capture case was found; the added prerequisite-level test explicitly owns only that combination. The original baseline already covers native inherited executor denial, handoff retention, and JSON reopen behavior; they were not duplicated wholesale.

## Test budget evidence

The initial supplemental run with Vitest's 5000ms default had six passing cases, one exact-outcome timeout, and two unfrozen lifecycle expectations that were corrected as described above. The outcome case contains three sequential real Git fixtures; its final measured 8693ms cannot fit the default 5000ms budget. The parent authorized the existing CI budget at invocation only. `.github/workflows/ci.yml` sets `DSH_COVERAGE_TEST_TIMEOUT_MS=90000`; `scripts/coverage-partitions.ts:79–95` pairs test and hook budgets because setup and teardown pay the same host contention. No production command deadline or frozen test timeout was enlarged.

## Handoff

`SUPPLEMENTAL-SHA256SUMS` identifies the new specs, reports and logs plus the amended original durability test. Verify it from the package directory with `sha256sum -c tests/SUPPLEMENTAL-SHA256SUMS`. Parent/Implementer owns any required devDependency registration for the new test import `@deepseek-ai/dsh-code-runtime-worker-thread`; the Test Writer did not edit the manifest. Necessary test corrections require a new explicit baseline.
