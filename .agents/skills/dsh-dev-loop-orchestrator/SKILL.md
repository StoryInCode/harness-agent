---
name: dsh-dev-loop-orchestrator
description: "Orchestrate the DeepSeek Harness AI development loop piece-by-piece. Present micro-gate cards in persona voices, conduct interactive brainstorming, delegate verification and implementation to isolated subagent worktrees, and present granular PR diffs for human sign-off."
---

# DSH Dev Loop Orchestrator Protocol

Use this skill when the user initiates development loop work with any short command such as:
- `Use dsh-dev-loop-orchestrator on plans/pieces/00-dev-loop`
- `Start dev loop from 00.00a`
- `Run dev loop`
- Or the full description: *"Let's start working on the ai development loop, you will drag in one md at a time..."*

When called without a starting point, it defaults to the first pending item in [`plans/pieces/QUEUE.md`](plans/pieces/QUEUE.md). When pointed at a specific file or folder, it starts from that file and proceeds sequentially through the queue.

---

## Core Architecture & Invariants

1. **Serialized Micro-Gate Flow**: Never process multiple micro-gates in parallel on the mainline. Drag in exactly **one micro-gate markdown file at a time** from [`plans/pieces/QUEUE.md`](plans/pieces/QUEUE.md).
2. **Worktree Isolation**: Subagents execute exclusively inside detached Git worktrees under `.worktrees/<piece-id>` created from current mainline `HEAD`. No dirty unstaged files are left floating in the root working directory.
3. **Archive Branch Protection (`backup/master-autonomous`)**: All previously autonomous code is preserved on the immutable `backup/master-autonomous` branch. Subagents inspecting "done" pieces restore only the files relevant to that gate into their worktree:
   ```bash
   git checkout backup/master-autonomous -- <file1> <file2> ...
   ```
4. **Granular 1-to-1 Automated PRs**: Every micro-gate produces exactly one discrete, atomic commit on an ephemeral branch (`gate/<piece-id>`) pushed to GitHub, and the agent automatically creates a Pull Request via GitHub CLI (`gh pr create`) with a complete markdown description (summary, changes, verification evidence, persona sign-off) targeting `StoryInCode/harness-agent:master`.
5. **Persona-Led Interaction**: Every gate is presented in the authentic voice of its lead developer persona from [`packages/dev-loop/roles/src/personas.ts`](packages/dev-loop/roles/src/personas.ts).

---

## The 5 Persona Leads

| Persona | Emoji | Title & Domain | Voice & Mannerisms |
|---|---|---|---|
| **Neko-chan** | 🐾 | Inspector Cat (Pure Intake & AST Parsing) | Playful, inquisitive, cat puns (`nya~`, `purr~`), sensory treat metaphors. |
| **L** | 🍰 | Forensic Detective (Epistemic Auditing & Claims) | Hyper-analytical, calm, percentages, skepticism of unverified claims, fond of sweets. |
| **Daru** | 💻 | Super Hacker (Subprocesses, Worktrees & SQLite) | Practical, cynical of academic fluff, CLI/process obsessed, otaku gaming slang. |
| **Hououin Kyouma** | 🔬 | Mad Scientist (Worldlines, Gates & Lifecycle) | Flamboyant, theatrical, Steins;Gate references ("El Psy Kongroo"), uncompromising vetoes. |
| **Mayuri** | 🌸 | Gentle Seamstress (Human Interaction & Harmony) | Warm, empathetic, human-centered (`tut-turii~ 🌸`), sewing metaphors, reduces operator fatigue. |

---

## Step-by-Step Turn Protocol

### Step 1: Intake & Persona Presentation
1. Read the next item from [`plans/pieces/QUEUE.md`](plans/pieces/QUEUE.md).
2. Open its specification file (e.g. `plans/pieces/00-dev-loop/done/00.01a-heading-scanner.md`).
3. Render a **Presentation Card** to the user featuring:
   - Header with ID, Title, Lead Persona, Status, Primitive, and Owning Package.
   - Persona-voiced **Summary** explaining the component and its seam.
   - The **Option A vs Option B** Human Decision Point.
   - The TypeScript **Contracts** and key Given/When/Then scenarios.

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
# 1. Ensure .worktrees/ is ignored and create the isolated worktree
git worktree add --detach .worktrees/<piece-id> HEAD
```

#### For "To Review & Verify" (Done Pieces):
1. The subagent extracts only the relevant production and test files from the archive:
   ```bash
   git -C .worktrees/<piece-id> checkout backup/master-autonomous -- <paths>
   ```
2. The subagent executes the piece's targeted Vitest test suite:
   ```bash
   pnpm exec vitest run <test-path> -t '<scenario-filter>'
   ```
3. The subagent verifies citation paths in `## References` and `## Resources and proof`.
4. If the user requested code modifications during brainstorming, the subagent implements them and verifies tests pass green.

#### For "To Implement" (Todo Pieces):
1. **Gate 1 (Format)**: Verify markdown structure against `scripts/check-pieces.ts`.
2. **Gate 2 (Red Baseline)**: Author Given/When/Then tests and confirm they fail on existing code.
3. **Gate 3 (Green Worktree)**: Implement production code in `packages/` until all tests pass.
4. **Gate 4 (Mainline Transfer)**: Run typecheck and lint inside the worktree.

### Step 4: PR Creation, Automated Bot Review & Operator Sign-Off

1. The subagent commits the change inside the worktree and pushes to GitHub:
   ```bash
   git -C .worktrees/<piece-id> checkout -b gate/<piece-id>
   git -C .worktrees/<piece-id> commit -m "feat(dev-loop): <piece-id> — <title>"
   git -C .worktrees/<piece-id> push origin gate/<piece-id> --no-verify
   ```
2. The orchestrator automatically creates the Pull Request via GitHub CLI (`gh`) with a full description:
   ```bash
   gh pr create \
     --repo StoryInCode/harness-agent \
     --base master \
     --head gate/<piece-id> \
     --title "feat(dev-loop): <piece-id> — <title>" \
     --body "$(cat <<'EOF'
   ## Summary
   <Persona summary of the gate and architectural rationale>

   ## Key Changes
   - **Package**: `<package-name>`
   - **Specification**: `plans/pieces/.../<piece-id>-<title>.md`
   - **Files modified/added**:
     - `<file1>`
     - `<file2>`

   ## Verification & Test Evidence
   - [x] Targeted test suite passing: `<verification-command>`
   - [x] Clean worktree assertions verified

   ## Lead Persona Sign-Off
   - Lead: <Persona Emoji & Name> (<Persona Title>)
   EOF
   )"
   ```
3. **Automated Bot Review Polling & Remediation**:
   - The subagent polls for GitHub Copilot / CI bot reviews:
     ```bash
     gh api repos/StoryInCode/harness-agent/pulls/<pr-number>/reviews
     gh api repos/StoryInCode/harness-agent/pulls/<pr-number>/comments
     ```
   - If bot review comments exist:
     - The subagent reviews each finding.
     - Files are fixed and verified in `.worktrees/<piece-id>`.
     - Changes are committed and pushed to `gate/<piece-id>`.
4. Once all automated reviews/checks are clean, the orchestrator outputs ONLY:
   - **GitHub Pull Request**: `https://github.com/StoryInCode/harness-agent/pull/<pr-number>`
   *(Note: No noisy in-chat diff cards or file dumps; the user inspects diffs and CI directly on the GitHub PR).*
5. The orchestrator immediately presents an interactive question using `ask_question`:
   - `Approve and merge/proceed to next gate`
   - `Leave comments for modification`

### Step 5: Progression or Modification

- **If Approved**:
  1. The PR is merged and local mainline updated:
     ```bash
     gh pr merge gate/<piece-id> --merge --delete-branch
     git pull origin master
     git worktree remove --force .worktrees/<piece-id>
     ```
     *(Note: If the user merges manually on GitHub, the orchestrator runs `git pull origin master` and removes the worktree).*
  2. The gate is marked verified in [`plans/pieces/QUEUE.md`](plans/pieces/QUEUE.md).
  3. The orchestrator immediately advances to the next micro-gate in the queue!
- **If Comments for Modification**:
  1. Subagent modifies files in `.worktrees/<piece-id>` based on the user's feedback.
  2. Tests are re-run to green.
  3. Changes are committed and pushed to the existing `gate/<piece-id>` branch (`git -C .worktrees/<piece-id> push origin gate/<piece-id> --no-verify`), which automatically updates the open PR.
  4. The orchestrator prompts the user for re-review.
