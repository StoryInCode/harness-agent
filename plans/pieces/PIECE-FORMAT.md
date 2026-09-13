# Piece format

One piece = one component an agent can ingest, implement and have reviewed in a single
sitting. Hard limit 280 lines, tracking the `R-piece-size` axiom rather than restating it. If it does not fit, it is not one piece.

Filename: `NN.MM-<kebab-slug>.md` inside a numbered set directory.

```markdown
# NN.MM — <Title>

**Set:** <set name> · **Queue:** <position> · **Depends on:** <piece ids, or none>
**Status:** todo | pending | done | blocked  (a `done` piece lives in `<set>/done/`, not in the set root; `blocked` is set by the loop when a gate or subagent fails, and is not written by hand)
**Harness primitive:** <one of the closed vocabulary> · **Package:** `@deepseek-ai/dsh-<name>`

## Summary

What it does (2-4 sentences, plain language) and how it does it (2-4 sentences, mechanism).
Written so the reader can approve or redirect without opening another file.

## Behaviour

Given / When / Then scenarios. 3-8 of them. Each one testable as written.

- **Given** <state> **When** <action> **Then** <observable outcome>

## Harness fit

Why this primitive and not the neighbouring ones. One short paragraph. Names the seam and
cites the Harness source that defines it.

## Contracts

The minimum an implementer needs: service name and signature, tool contract, event name and
payload, or config fields. Code block. No essays.

## Dependencies

Pieces that must be done first, and what this piece assumes from each.

## References

What was actually inspected to write this piece.

| Source | Role/preset that inspected it | Question it answered | Direct inspection or reported | How it was used |
|---|---|---|---|---|

## How to see it

How the OWNER observes this working once it is done. Exact and runnable, not a description.

- API: method + path, an example request, and the expected response
- UI: the route/screen, the command that starts the app, and what appears
- Command: the exact command line and its expected output
- No direct surface: the exact test command and the assertion that proves the behaviour

"Tests pass" is not an answer. Name what to run, where to look, and what correct looks like.

## Teach me while you build

Written for a junior developer who will go on to influence this project, take their own tasks,
and be trusted to decide. You are building a second brain and a future partner, not
documentation: transfer the judgment, not only the facts, and mark what is still uncertain so
they can disagree on evidence. Grounded in this project's real files. Define each term on
first use. Cover, as briefly as the subject allows:

- **Background** — what you need to know before the code makes sense
- **How it works here** — the real path: what calls it, what arrives, what it returns, what
  happens on failure, and which file to open
- **Why this approach** — the decision, the simplest alternative, when that alternative wins
- **Approaches considered** — 2-4 real candidates, one from outside this repo: what each is,
  who uses it, its tradeoffs, when it would win here. No straw men
- **Prior art inspected** — external projects, libraries or specs actually opened: the exact
  file or section, what was taken, adapted or rejected, and any license obligation. Separate
  reading source from reading a README from inferring from behaviour. Never name what you did
  not open
- **What we get for free** — framework/library behaviour vs. what we actually write
- **From the docs** — only if real documentation informed it: source, short verified quote,
  plain-English meaning. Never invent a quote; say so if it was not inspected
- **What to notice** — one or two things to look at
- **Concepts to own** — the transferable concepts this piece exercises, under their standard
  industry names, each with a one-line definition and where it appears here
- **Interview angle** — the interview question this work answers, an answer grounded in this
  implementation, and the follow-up an interviewer would ask next
- **Decisions you can now make alone** — what the reader may now change here unaided, what
  still needs escalation, and the open questions where their judgment is wanted
- **Approaches considered** — two to four REAL candidate approaches, never straw men. For each:
  what it is, who actually uses it, its tradeoffs, and the conditions under which it would win
  here. At least one candidate comes from outside this repository.
- **Prior art inspected** — the named external projects, libraries, specifications or standards
  actually examined: the exact file, module, RFC section or API inspected, what idea was taken,
  adapted or rejected, and whether code was reused and under which license. Distinguish reading
  the source from reading the README from inferring from behaviour. NEVER name a project that
  was not opened.
- **Concepts to own** — the transferable computer-science and engineering concepts this piece
  exercises, under their standard industry names (not local vocabulary), each with a one-line
  definition and where it appears here.
- **Interview angle** — the software-industry interview question this work answers, a crisp
  answer grounded in THIS implementation, and the follow-up an interviewer would ask next. Omit
  for pure boilerplate and say why.
- **Decisions you can now make alone** — which changes the reader can safely make here unaided,
  which still need escalation and to whom, and the open questions where their judgment is wanted.
- **Lesson** — one transferable idea

## Resources and proof

**Proof of claims** — one row per load-bearing claim:

| Claim | Citation | How established | Checked against |
|---|---|---|---|
| | repo path + symbol, doc section, spec clause, or external source | direct inspection / reported by <role, preset> / measured / UNVERIFIED | date or version |

**Learning resources** — the reading path for the owner: official docs sections, specifications,
the repository files worth opening, and external projects that solve this well. One line each on
what it is good for.

Never cite what was not opened. A quote is verbatim or it is not a quote. Prefer primary sources;
say when only a summary was available. Version-pin anything that changes.

## Reuse capture

Evidence for a later extraction agent. Mark candidates; do not generalize now.

- **Reuse candidate:** name · what it does · current usage · potential reuse · what would
  need to become generic · evidence · confidence (low/medium/high)
- **Known limitations** and where this should NOT be reused
- **Failure worth keeping** (if any): what was tried, why it failed, what worked instead,
  and when the rejected approach would still fit

State "no reuse candidates" explicitly when there are none. Looking generic is not evidence.

## Acceptance

Objective, checkable conditions. Includes the tests that must exist and pass.
```

## Rules

- Summary and Behaviour come first because they are what the user reads at the approval
  junction. Everything else supports implementation.
- Given/When/Then is the contract handed to the Test Writer. Write scenarios that fail
  when the behaviour is missing.
- References record real inspection only. A piece with no references says so explicitly.
- A piece names exactly one owning package. Work spanning two packages is two pieces with a
  dependency edge.
- No piece describes migration steps, effort estimates, or phases.
- A completed piece MOVES to `<set>/done/` keeping its filename and id; the set README records
  the move. The remaining set directory is always the remaining work.
- Superseded pieces go to trash, never to `done/`. `done/` means built; trash means discarded.
