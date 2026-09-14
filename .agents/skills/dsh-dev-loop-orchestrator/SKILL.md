---
name: dsh-dev-loop-orchestrator
description: "Orchestrate the AI development loop piece-by-piece for any repository or project. Present micro-gate cards in persona or lead voices, conduct interactive brainstorming, delegate verification and implementation to isolated subagent worktrees, and present granular PR diffs for human sign-off."
---

# Dev Loop Orchestrator Protocol

Use this skill when the user initiates development loop work with any short command such as:
- `Use dsh-dev-loop-orchestrator on plans/pieces/00-dev-loop`
- `Start dev loop from 00.00a`
- `Run dev loop`
- Or the full description: *"Let's start working on the ai development loop, you will drag in one md at a time..."*

When called without a starting point, it defaults to the first pending or unfinished item in [`plans/pieces/QUEUE.md`](plans/pieces/QUEUE.md) (or `plans/QUEUE.md`). When pointed at a specific file, set folder, or queue item, it starts from that item and proceeds sequentially through the queue.

---

## Core Architecture & Invariants

1. **Serialized Micro-Gate Flow**: Never process multiple micro-gates in parallel on the mainline. Drag in exactly **one micro-gate markdown file at a time** from the master queue.
2. **Worktree Isolation**: Subagents execute exclusively inside detached Git worktrees under `.worktrees/<piece-id>` created from current mainline `HEAD`. No dirty unstaged files are left floating in the root working directory.
3. **Repository Agnostic & Dual Mode**:
   - **Mode A (Green-Field / New Work)**: When implementing new features on any repository, the subagent follows the 4 Gates (Format, Red Baseline, Green Worktree, Mainline Transfer) to build the feature from scratch.
   - **Mode B (Archive / Recovery Work)**: When an archive or feature branch exists (e.g. `backup/master-autonomous`), subagents inspecting completed pieces restore only the files relevant to that gate into their worktree:
     ```bash
     git checkout <archive-branch> -- <file1> <file2> ...
     ```
4. **Granular 1-to-1 Automated PRs**: Every micro-gate produces exactly one discrete, atomic commit on an ephemeral branch (`gate/<piece-id>`) pushed to GitHub, and the agent automatically creates a Pull Request via GitHub CLI (`gh pr create`) with a complete markdown description (summary, changes, verification evidence, lead sign-off) targeting the repository's base branch.
5. **Persona / Lead-Led Interaction**: Every gate is presented in the authentic voice of its lead developer persona or champion role (e.g. from [`packages/dev-loop/roles/src/personas.ts`](packages/dev-loop/roles/src/personas.ts) or standard engineering archetypes).
6. **Automated Master Queue & Plan Scaffolding**:
   - Master queue is deterministically generated and synchronized via `pnpm exec tsx scripts/gen-queue.ts`.
   - New micro-gates are scaffolded conforming to all axioms via `pnpm exec tsx scripts/gen-piece.ts <id> "<title>"`.

---

## Developer Archetypes & Persona Leads

Every project can customize lead voices, or use the 5 standard engineering archetypes:

| Persona / Role | Emoji | Domain & Responsibilities | Voice & Tone |
|---|---|---|---|
| **Intake Inspector (e.g. Neko-chan)** | 🐾 | Pure Intake, Markdown AST, BDD parsing, schema validation | Inquisitive, playful, attentive to syntax and details. |
| **Forensic Detective (e.g. L)** | 🍰 | Epistemic auditing, proof tables, citation verification, boundaries | Hyper-analytical, calm, skeptical of unverified claims. |
| **Plumbing Hacker (e.g. Daru)** | 💻 | Subprocesses, worktrees, DB schemas, WAL persistence, CLI rigs | Practical, pragmatic, system-call and execution focused. |
| **Divergence Controller (e.g. Hououin Kyouma)** | 🔬 | Verification pipeline, pre-complete hooks, anti-cheat detection | Passionate, visionary, uncompromising on quality gates. |
| **Harmony & UX (e.g. Mayuri)** | 🌸 | Human decision cards, slash commands, interactive questions | Warm, empathetic, human-centered, reduces operator fatigue. |

---

## Step-by-Step Turn Protocol

### Step 1: Intake & Persona Presentation
1. Read the next item from [`plans/pieces/QUEUE.md`](plans/pieces/QUEUE.md).
2. Open its specification file (e.g. `plans/pieces/00-dev-loop/done/00.01a-heading-scanner.md`).
3. Render a **Presentation Card** to the user featuring:
   - Header with ID, Title, Lead Persona, Status, Primitive, and Owning Package/Module.
   - Persona-voiced **Summary** explaining the component and its seam.
   - The **Option A vs Option B** Human Decision Point.
   - The **Contracts** and key Given/When/Then scenarios.

### Step 2: Interactive Brainstorming & Setup Questions
1. Formulate 1–3 focused architectural questions about the decision point, assumptions, or setup.
2. Use `ask_question` (for structured decision forks) or direct dialogue to solicit user feedback:
   - Are the Option A trade-offs aligned with your vision?
   - Do any contract methods or error handling behaviors need refinement?
   - Are there specific edge cases you want the test suite to emphasize?
3. Wait for the user's response and incorporate their feedback into the working spec.

### Step 3: Subagent Handoff & Execution

Once the user approves the micro-gate, dispatch a subagent to an isolated worktree:

```bash
# Ensure .worktrees/ is ignored and create the isolated worktree
git worktree add --detach .worktrees/<piece-id> HEAD
```

#### For "To Review & Verify" (Existing / Restored Pieces):
1. The subagent extracts only the relevant production and test files from the archive or baseline branch:
   ```bash
   git -C .worktrees/<piece-id> checkout <archive-branch> -- <paths>
   ```
2. The subagent executes the piece's declared verification command from its `## How to see it` section:
   ```bash
   <command-from-how-to-see-it>
   ```
3. The subagent verifies citation paths in `## References` and `## Resources and proof`.
4. If the user requested code modifications during brainstorming, the subagent implements them and verifies tests pass green.

#### For "To Implement" (New Work):
1. **Gate 1 (Format)**: Verify markdown structure with `pnpm exec tsx scripts/check-pieces.ts sections`.
2. **Gate 2 (Red Baseline)**: Author Given/When/Then tests and confirm they fail on existing code.
3. **Gate 3 (Green Worktree)**: Implement production code until all tests pass.
4. **Gate 4 (Mainline Transfer)**: Run typecheck and lint inside the worktree.

### Step 4: PR Creation, Automated Bot Review & Operator Sign-Off

1. The subagent commits the change inside the worktree and pushes to GitHub:
   ```bash
   git -C .worktrees/<piece-id> checkout -b gate/<piece-id>
   git -C .worktrees/<piece-id> commit -m "feat(<scope>): <piece-id> — <title>"
   git -C .worktrees/<piece-id> push origin gate/<piece-id> --no-verify
   ```
2. The orchestrator automatically detects the repository and base branch, then creates the Pull Request via GitHub CLI (`gh`):
   ```bash
   BASE_BRANCH=$(git remote show origin 2>/dev/null | sed -n '/HEAD branch/s/.*: //p' || echo "master")
   gh pr create \
     --base "$BASE_BRANCH" \
     --head gate/<piece-id> \
     --title "feat(<scope>): <piece-id> — <title>" \
     --body "$(cat <<'EOF'
   ## Summary
   <Persona summary of the gate and architectural rationale>

   ## Key Changes
   - **Package / Module**: `<package-name>`
   - **Specification**: `plans/pieces/.../<piece-id>-<title>.md`
   - **Files modified/added**:
     - `<file1>`
     - `<file2>`

   ## Verification & Test Evidence
   - [x] Targeted verification passing: `<verification-command>`
   - [x] Clean worktree assertions verified

   ## Lead Sign-Off
   - Lead: <Persona or Role>
   EOF
   )"
   ```
3. **Automated Bot Review Polling & Remediation**:
   - The subagent polls for GitHub Copilot, CodeRabbit, or CI bot review comments:
     ```bash
     gh pr view gate/<piece-id> --json reviews,comments
     ```
   - If bot review comments exist:
     - The subagent reviews each finding.
     - Files are fixed and verified in `.worktrees/<piece-id>`.
     - Changes are committed and force-pushed to `gate/<piece-id>`.
4. Once all automated reviews/checks are clean, the orchestrator outputs ONLY:
   - **GitHub Pull Request**: URL to the created PR.
   *(Note: No noisy in-chat diff cards or file dumps; the user inspects diffs and CI directly on GitHub).*
5. The orchestrator immediately presents an interactive question using `ask_question`:
   - `Approve and proceed to next gate`
   - `Leave comments for modification`

### Step 5: Progression or Modification

- **If Approved**:
  1. The PR is merged and local mainline updated:
     ```bash
     gh pr merge gate/<piece-id> --merge --delete-branch
     git pull origin "$BASE_BRANCH"
     git worktree remove --force .worktrees/<piece-id>
     ```
     *(Note: If the user merges manually on GitHub, the orchestrator runs `git pull origin "$BASE_BRANCH"` and removes the worktree).*
  2. The master queue is refreshed:
     ```bash
     pnpm exec tsx scripts/gen-queue.ts
     ```
  3. The orchestrator immediately advances to the next micro-gate in the queue!
- **If Comments for Modification**:
  1. Subagent modifies files in `.worktrees/<piece-id>` based on the user's feedback.
  2. Tests are re-run to green.
  3. Changes are committed and pushed to the existing `gate/<piece-id>` branch (`git -C .worktrees/<piece-id> push origin gate/<piece-id> --no-verify`), which automatically updates the open PR.
  4. The orchestrator prompts the user for re-review.
