---
name: review-factory
description: Run a code review by orchestrating parallel reviewer subagents. Use for PR/branch/diff/working-tree reviews.
---

# AI Code Review Orchestrator

Reviewer behavior lives in `references/reviewers/*.md`. The parent session reads the relevant prompt files and spawns one generic child subagent per reviewer role.

## Operating model

- Parent/orchestrator: current session model and reasoning settings
- Child reviewers: request a cheaper, lower-reasoning model tier and review-only/read-only behavior when spawning subagents.
- Do not edit code during review.
- Review changed code and directly affected paths only.
- Prefer concrete bugs over broad advice.
- Final output must be deduplicated, concise, and decision-oriented.

## Model and cost policy

Use model tiers instead of fixed model IDs:

- Coordinator / judge: the strongest available reasoning model for the current environment, because it deduplicates reviewer output, rejects false positives, and makes the final risk call.
- Specialist reviewers: a materially cheaper capable coding model with low or no reasoning

The goal is to spend premium tokens only on the coordination and final judgment step, and run parallel specialists on lower-cost models. Concrete examples of the intended downgrade pattern:

- GPT 5.5 high -> GPT 5.5 low
- GPT 5.5 low -> GPT 5.4 mini high
- Opus 4.8 -> Sonnet 4.6
- Sonnet 4.6 -> Haiku-class model

These names are examples only and will age; choose the closest current equivalent in the active agent platform.

Keep the review cache-friendly when possible:
- keep stable instructions and reviewer prompts unchanged;
- put dynamic review data late;
- do not paste the full diff into every subagent prompt;
- pass a short shared context summary and ask reviewers to inspect relevant files directly.

## Inputs to collect

Before spawning reviewers, build a small review context from the repository:

1. Determine the review target:
   - branch vs main, or
   - uncommitted changes, or
   - a specific commit/range supplied by the user.
2. Inspect the changed-file list and diff summary.
3. Ignore obvious noise using `references/NOISE_FILTERS.md`.
4. Assess risk using `references/RUBRIC.md`.
5. Keep shared context short:
   - base/head or diff source
   - changed files
   - notable risky paths
   - obvious test/build commands
   - user custom instructions

## Risk tiers

Use the smallest useful reviewer set.

### Trivial

Conditions:

- <= 10 changed lines
- <= 20 changed files
- no security-sensitive file

Spawn:

- `references/reviewers/generalist.md`

### Lite

Conditions:

- <= 100 changed lines
- <= 20 changed files
- no security-sensitive file

Spawn:

- `references/reviewers/correctness.md`
- `references/reviewers/design.md`
- `references/reviewers/tests-docs.md`

Add `references/reviewers/performance.md` only if runtime, rendering, DB, network, caching, bundle size, concurrency, or memory behavior changed.

### Full

Conditions:

- security-sensitive file changed, or
- > 100 changed lines, or
- > 50 changed files

Spawn:

- `references/reviewers/security.md`
- `references/reviewers/correctness.md`
- `references/reviewers/design.md`
- `references/reviewers/performance.md`
- `references/reviewers/tests-docs.md`
- `references/reviewers/release.md`
- `references/reviewers/agents-md.md`

## How to spawn reviewers

For each selected reviewer:

1. Read `references/REVIEWER_SHARED.md`.
2. Read the reviewer-specific prompt.
3. Spawn one child agent with:
   - the shared review context
   - the reviewer-specific prompt
   - instruction to return only XML matching `references/FINDING_SCHEMA.md`
   - instruction to avoid code edits
4. Wait for all reviewers.

Suggested wording:

> Spawn one review-only subagent for this reviewer using a cheaper capable coding model than the coordinator, with low or disabled reasoning. Give it the shared review context and the reviewer prompt. Ask it to inspect only changed/affected files, avoid code edits, and return only XML findings.

## Judge pass

After reviewers return:

1. Deduplicate overlapping findings.
2. Move findings to the right category if a reviewer misclassified them.
3. Drop speculative issues, nitpicks, style-only comments, unsupported convention-only suggestions, and findings contradicted by the source.
4. If a finding is uncertain but serious, verify by reading the relevant files.
5. Bias toward approval: one isolated warning is not a block unless it creates concrete production or security risk.

## Verdict rubric

- `LGTM`: no findings or only trivial suggestions.
- `COMMENTS`: suggestions or one non-blocking warning.
- `NEEDS_ATTENTION`: multiple warnings or repeated risk pattern.
- `BLOCKER`: critical issue, exploitable vulnerability, production outage risk, data loss risk, or broken release path.

## Final response format

```md
Verdict: LGTM | COMMENTS | NEEDS_ATTENTION | BLOCKER

Summary: one short paragraph.

Findings:
1. [severity] [category] file:line — concrete issue
   Why it matters: ...
   Evidence: ...
   Suggested direction: ...

Dropped / ignored:
- Optional. Mention only if useful.
```

Keep the final response short. Do not include raw XML unless the user asks.
