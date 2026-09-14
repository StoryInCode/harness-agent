#!/usr/bin/env python3
"""
Orchestrator script to generate all 46 micro-gates for Set 00,
clean up old coarse piece files, update the README index table,
and fix cross-references across plans/.
"""

import os
import sys
import glob
import re

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PIECES_DIR = os.path.join(BASE_DIR, 'plans', 'pieces', '00-dev-loop')
DONE_DIR = os.path.join(PIECES_DIR, 'done')

sys.path.insert(0, os.path.dirname(__file__))
from gates_00_01_to_00_03 import GATES_00_01_TO_00_03
from gates_00_04_to_00_07 import GATES_00_04_TO_00_07
from gates_00_08_to_00_10 import GATES_00_08_TO_00_10
from gates_00_11_to_00_14 import GATES_00_11_TO_00_14

ALL_GATES = (
    GATES_00_01_TO_00_03 +
    GATES_00_04_TO_00_07 +
    GATES_00_08_TO_00_10 +
    GATES_00_11_TO_00_14
)

print(f"Total micro-gates loaded: {len(ALL_GATES)}")
assert len(ALL_GATES) == 46, f"Expected 46 gates, got {len(ALL_GATES)}"


def format_gate(gate: dict) -> str:
    lines = []
    # Title
    lines.append(f"# {gate['id']} — {gate['title']}")
    lines.append("")
    # Header fields
    lines.append(f"**Set:** 00-dev-loop · **Queue:** {gate['queue']} · **Depends on:** {gate['depends']}")
    lines.append(f"**Lead Developer:** {gate['lead']}")
    lines.append(f"**Status:** {gate['status']}")
    lines.append(f"**Harness primitive:** {gate['primitive']} · **Package:** `{gate['package']}`")
    lines.append("")

    # 1. Summary
    lines.append("## Summary")
    lines.append("")
    lines.append(gate["summary_voice"])
    lines.append("")
    lines.append("### Human Decision Point: Option A vs Option B")
    lines.append(f"- **Option A (Active)**: {gate['opt_a']}")
    lines.append(f"- **Option B (Alternative)**: {gate['opt_b']}")
    lines.append("")

    # 2. Behaviour
    lines.append("## Behaviour")
    lines.append("")
    for given, when, then in gate["scenarios"]:
        lines.append(f"- **Given** {given} **When** {when} **Then** {then}")
    lines.append("")

    # 3. Harness fit
    lines.append("## Harness fit")
    lines.append("")
    lines.append(gate["harness_fit"])
    lines.append("")

    # 4. Contracts
    lines.append("## Contracts")
    lines.append("")
    lines.append(gate["contracts"])
    lines.append("")

    # 5. Dependencies
    lines.append("## Dependencies")
    lines.append("")
    lines.append(f"- **Prerequisites:** {gate['deps_text']}")
    lines.append("")

    # 6. References
    lines.append("## References")
    lines.append("")
    lines.append("| File | Lines | Summary |")
    lines.append("| --- | --- | --- |")
    for ref_file, ref_lines, ref_summary in gate["references"]:
        lines.append(f"| `{ref_file}` | `{ref_lines}` | {ref_summary} |")
    lines.append("")

    # 7. How to see it
    lines.append("## How to see it")
    lines.append("")
    lines.append("Run:")
    lines.append("```bash")
    lines.append(gate["how_to_see"]["command"])
    lines.append("```")
    lines.append("Expected output:")
    lines.append("```")
    lines.append(gate["how_to_see"]["expected"])
    lines.append("```")
    lines.append("")

    # 8. Teach me while you build
    t = gate["teach"]
    lines.append("## Teach me while you build")
    lines.append("")
    lines.append(t["voice_intro"])
    lines.append("")
    lines.append(f"- **What it does**: {t['what_it_does']}")
    lines.append(f"- **Background**: {t['background']}")
    lines.append(f"- **How it works here**: {t['how_it_works']}")
    lines.append(f"- **Why this approach**: {t['why_this_approach']}")
    lines.append(f"- **Approaches considered**: {t['approaches_considered']}")
    lines.append(f"- **Prior art inspected**: {t['prior_art']}")
    lines.append(f"- **What we get for free**: {t['what_we_get_for_free']}")
    lines.append(f"- **From the docs**: {t['from_the_docs']}")
    lines.append(f"- **What to notice**: {t['what_to_notice']}")
    lines.append(f"- **Concepts to own**: {t['concepts_to_own']}")
    lines.append(f"- **Interview angle**: {t['interview_angle']}")
    lines.append(f"- **Decisions you can now make alone**: {t['decisions_alone']}")
    lines.append(f"- **What you should learn from this**: {t['lesson']}")
    lines.append("")

    # 9. Resources and proof
    lines.append("## Resources and proof")
    lines.append("")
    lines.append("| Claim | Citation | Method | Date / Version |")
    lines.append("| --- | --- | --- | --- |")
    for claim, cit, method, date_ver in gate["proof"]:
        lines.append(f"| {claim} | `{cit}` | {method} | {date_ver} |")
    lines.append("")

    # 10. Reuse capture
    r = gate["reuse"]
    lines.append("## Reuse capture")
    lines.append("")
    lines.append(f"Reuse candidate: {r['name']}")
    lines.append(f"What it does: {r['what']}")
    lines.append(f"Current usage: {r['usage']}")
    lines.append(f"Potential reuse: {r['potential']}")
    lines.append(f"What would need to become generic: {r['generic']}")
    lines.append(f"Evidence: {r['evidence']}")
    lines.append(f"Confidence: {r['confidence']}")
    lines.append("")

    # 11. Acceptance
    lines.append("## Acceptance")
    lines.append("")
    check_box = "[x]" if gate["status"] == "done" else "[ ]"
    for item in gate["acceptance"]:
        lines.append(f"- {check_box} {item}")
    lines.append(f"- Next Gate: [`{gate['next_gate']}`] — Proceed to next verified milestone.")
    lines.append("")

    return "\n".join(lines)


def write_microgates():
    os.makedirs(DONE_DIR, exist_ok=True)
    generated_files = []

    for idx, gate in enumerate(ALL_GATES, start=1):
        gate["queue"] = idx
        if gate["slug"].endswith(".md"):
            gate["slug"] = gate["slug"][:-3]
        content = format_gate(gate)
        line_count = len(content.splitlines())
        if line_count > 280:
            print(f"WARNING: {gate['slug']} has {line_count} lines (> 280)!")

        filename = f"{gate['slug']}.md"
        if gate["status"] == "done":
            filepath = os.path.join(DONE_DIR, filename)
        else:
            filepath = os.path.join(PIECES_DIR, filename)

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        generated_files.append((gate["id"], filepath, line_count))

    print(f"Successfully generated {len(generated_files)} micro-gates.")
    return generated_files


OLD_COARSE_FILES = [
    os.path.join(DONE_DIR, "00.01-piece-directory.md"),
    os.path.join(DONE_DIR, "00.02-piece-lifecycle.md"),
    os.path.join(DONE_DIR, "00.03-approval-junction.md"),
    os.path.join(DONE_DIR, "00.04-concurrency-queue.md"),
    os.path.join(DONE_DIR, "00.05-worktree-assignment.md"),
    os.path.join(DONE_DIR, "00.06-role-delegation.md"),
    os.path.join(DONE_DIR, "00.07-research-guard.md"),
    os.path.join(DONE_DIR, "00.08-references-provenance.md"),
    os.path.join(PIECES_DIR, "00.09-test-handoff.md"),
    os.path.join(PIECES_DIR, "00.10-verification-gates.md"),
    os.path.join(DONE_DIR, "00.11-command-surface.md"),
    os.path.join(DONE_DIR, "00.12-loop-persistence.md"),
    os.path.join(DONE_DIR, "00.13-claim-verification.md"),
    os.path.join(PIECES_DIR, "00.14-composition-and-preset.md"),
]


def remove_old_files():
    removed_count = 0
    for file_path in OLD_COARSE_FILES:
        if os.path.exists(file_path):
            os.remove(file_path)
            print(f"Removed old coarse piece: {os.path.basename(file_path)}")
            removed_count += 1
    print(f"Total old coarse pieces removed: {removed_count}")


def update_readme_index():
    readme_path = os.path.join(PIECES_DIR, "README.md")
    rows = [
        "# Set 00 — Development Loop Micro-Gates Index",
        "",
        "The autonomous development loop decomposed into 46 verified micro-gates authored by the five persona leads: 🐾 Neko-chan, 🍰 L, 💻 Daru, 🔬 Hououin Kyouma, and 🌸 Mayuri.",
        "",
        "| ID | Title | Lead | Package | Depends on | Queue | Status |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]

    for gate in ALL_GATES:
        link_path = f"done/{gate['slug']}.md" if gate["status"] == "done" else f"{gate['slug']}.md"
        title_cell = f"[{gate['title']}]({link_path})"
        rows.append(
            f"| `{gate['id']}` | {title_cell} | {gate['lead']} | `{gate['package']}` | `{gate['depends']}` | {gate['queue']} | {gate['status']} |"
        )

    rows.extend([
        "",
        "## Micro-Gate Architecture & Personas",
        "",
        "- 🐾 **Neko-chan (Inspector Cat)**: Pure intake, ATX scanning, BDD parsing, and user cheer.",
        "- 🍰 **L (Forensic Detective)**: Evidence checking, claim verification, proof tables, and epistemic bounds.",
        "- 💻 **Daru (Super Hacker)**: Execution rig, test runners, git worktrees, and SQLite WAL persistence.",
        "- 🔬 **Hououin Kyouma (Mad Scientist)**: Monotonic state transitions, worktree allocation, and Steins Gate verification.",
        "- 🌸 **Mayuri (Gentle Seamstress)**: Human-in-the-loop decisions, presentation cards, and preset composition.",
        "",
        "## Verification and Workflow Sequence",
        "",
        "The implementation sequence is Test Writer → RED → Implementer gets tests green → transfer to master → final post-transfer tests → move the completed piece into `done/` and update this index. Human approval is exercised at `00.03a`–`00.03c`.",
        "",
    ])

    with open(readme_path, "w", encoding="utf-8") as f:
        f.write("\n".join(rows))
    print(f"Updated {readme_path} with all 46 micro-gates.")


def update_cross_references():
    plans_dir = os.path.join(BASE_DIR, "plans")
    md_files = glob.glob(os.path.join(plans_dir, "**", "*.md"), recursive=True)
    print(f"Checking cross-references across {len(md_files)} markdown files in plans/...")

    replacements = [
        ("00.01-piece-directory.md", "00.01a-heading-scanner.md"),
        ("00.02-piece-lifecycle.md", "00.02a-lifecycle-states.md"),
        ("00.03-approval-junction.md", "00.03a-presentation-card.md"),
        ("00.04-concurrency-queue.md", "00.04a-priority-comparator.md"),
        ("00.05-worktree-assignment.md", "00.05a-worktree-allocation.md"),
        ("00.06-role-delegation.md", "00.06a-specialist-roles.md"),
        ("00.07-research-guard.md", "00.06b-research-guard.md"),
        ("00.08-references-provenance.md", "00.08a-reference-table-ast.md"),
        ("00.09-test-handoff.md", "00.09a-bdd-extractor.md"),
        ("00.10-verification-gates.md", "00.10a-format-axiom-gate.md"),
        ("00.11-command-surface.md", "00.11a-slash-command-parser.md"),
        ("00.12-loop-persistence.md", "00.12a-write-ahead-intent.md"),
        ("00.13-claim-verification.md", "00.13a-claim-inventory-parser.md"),
        ("00.14-composition-and-preset.md", "00.14a-host-service-assembly.md"),
    ]

    updated_files_count = 0
    for filepath in md_files:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()

        new_content = content
        for old_ref, new_ref in replacements:
            new_content = new_content.replace(old_ref, new_ref)

        if new_content != content:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(new_content)
            updated_files_count += 1
            print(f"Updated references in: {os.path.relpath(filepath, BASE_DIR)}")

    print(f"Total files with updated cross-references: {updated_files_count}")


if __name__ == "__main__":
    write_microgates()
    remove_old_files()
    update_readme_index()
    update_cross_references()
    print("Done!")
