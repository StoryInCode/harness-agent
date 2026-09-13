# Nested definition resolution regression

The parent reported the Implementer's actual-mdast finding that link definitions nested in a blockquote are globally visible. Test Writer reproduced the defect through the real Loader service in `nested-definitions.spec.ts`: the piece Summary contains `> [evidence]: ../../../tracked.txt`, and its valid References table cites `[evidence]`. Directory accepts the piece; mdast resolves the reference syntax, but the References parser's root-only definition map returns an invalid locator.

Before any fix, `pnpm exec vitest run packages/dev-loop/references/tests/nested-definitions.spec.ts --testTimeout=30000 --hookTimeout=30000 --reporter=verbose --reporter=json --outputFile.json=packages/dev-loop/references/tests/NESTED-DEFINITIONS-RED-vitest.json` exits 1 with one behavioral failure. Expected: no structural errors and the existing tracked file resolved with a full content fingerprint. Actual: `INVALID_LOCATOR` for entry zero. No import, Loader, timeout or type failure is claimed as RED.

`NESTED-DEFINITIONS-RED-SOURCE-SHA256SUMS` identifies production before the fix. `NESTED-DEFINITIONS-FROZEN-SHA256SUMS` freezes the new test and evidence independently of the historical 84-test baseline and the supplemental GREEN cases. The Implementer may fix production but must not change the test or rewrite this RED history.
