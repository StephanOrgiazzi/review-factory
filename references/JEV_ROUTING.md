# Optional Jev reviewer routing

Read this only when TypeSafe/Jev routing is enabled for the review. The ordinary
skill needs no runtime or API key. This helper needs Node.js 20+ or Bun and has no
dependencies.

## Why this integration

Use Jev for bounded semantic judgments about which review domains a change
touches and how much reasoning each selected subagent needs. A small diff in an innocuous filename can affect authorization,
performance, or deployment; line counts and path hints alone miss this.

Keep source inspection, findings, deduplication, severity, and the verdict with
the existing coding reviewers and reasoning coordinator. Jev returns typed
probabilities, not review explanations. This first integration favors coverage:
it can increase reviewer cost. It does not claim measured savings or accuracy.

## Prepare the context

After applying `NOISE_FILTERS.md`, compute added plus deleted lines and changed
file count from the actual target. Include staged, unstaged, and untracked work
when those are in scope. Inspect security-sensitive paths using `RUBRIC.md` and
record known performance impact. These are coordinator facts, not Jev guesses.

Write a temporary JSON file outside the reviewed repository. Example:

```json
{
  "target": "base-commit-sha..head-commit-sha",
  "changedLines": 2,
  "changedFiles": 1,
  "securitySensitive": false,
  "performanceRelevant": false,
  "contextComplete": true,
  "files": ["src/catalog.ts"],
  "summary": "Load product availability for each catalog result.",
  "diff": "-return products;\n+return Promise.all(products.map(loadAvailability));",
  "requiredReviewers": ["correctness"]
}
```

- `files` must contain one unique path per counted file, after noise filtering.
- `summary` gives relevant intent, affected callers, and known constraints;
  `diff` contains the relevant patch, not just filenames or a title.
- Set `contextComplete` to false if evidence needed for routing is missing,
  redacted in a material way, or truncated. The helper then uses the baseline.
- `requiredReviewers` preserves user focus and any extra roles selected by the
  coordinator. Allowed names: `generalist`, `security`, `correctness`, `design`,
  `performance`, `tests-docs`, `release`, `agents-md`.
- Identify immutable base/head commits. For working trees, regenerate context
  after edits. The output `contextHash` fingerprints the supplied evidence; it
  does not automatically detect changes in the repository.

## Run

Offline baseline (no network, even when a key is present):

```sh
bun /path/to/review-factory/scripts/route-review.mjs /tmp/review-context.json
```

For live routing, configure `TYPESAFE_API_KEY` in the environment and add `--live`:

```sh
bun /path/to/review-factory/scripts/route-review.mjs /tmp/review-context.json --live
```

`node` can replace `bun`. Paths are examples; use a temporary location supported
by the host. Do not put credentials in JSON, command arguments, or committed files.
`--live` sends the allowlisted context, including source code, to TypeSafe. Use it
when external routing is authorized by the user or project configuration; the
presence of a key alone does not enable it. Honor any existing authorization
without asking again. Exclude secrets from the context.

`TYPESAFE_MODEL` optionally pins an available model ID; default: `jev-latest`.
The output records the actual response model, token usage when supplied, elapsed
request time, raw domain probabilities, per-reviewer effort judgments, and the
thresholds used.

## Consume the result

1. Use `tier` and `reviewers` as minimum coverage, together with the normal rubric.
   Every name maps to `references/reviewers/<name>.md`.
2. A Noul is probability of yes, not severity or a separate confidence score.
   Each domain has its own independent question in the same request; several
   domains can apply at once.
3. At probability **0.2 or above**, include the reviewer. Values from **0.2 up to
   0.8** appear in `uncertainReviewers` and still receive review. A security
   probability of **0.2 or above** escalates to full coverage. These are
   conservative starting thresholds, not validated performance guarantees.
4. Low probabilities never remove baseline or explicitly requested reviewers.
   The coordinator can always add coverage based on the source. The final judge
   must not use routing probabilities to discard findings or approve changes.
5. `coordinatorReviewRequired` is always true. For `source: "baseline"`, inspect
   `reason` and continue the ordinary review. Missing credentials, incomplete or
   oversized state, HTTP failures, timeouts, and malformed answers do not mean
   the diff is safe. Invalid local input exits nonzero and must be corrected or
   bypassed by doing the ordinary review.

Full-tier changes retain all specialists and can still use Jev to allocate effort.
The helper sends at most one request, uses a 10-second timeout, rejects redirects,
and falls back without retries on rate limits or service failures. The local
16,000-byte context budget bounds the optional request; it is not an API token
limit. Oversized input is never silently truncated.

## Apply the thinking level

The same request includes one speculative `Choice` per reviewer (including the
generalist), assuming that role will be selected. It asks how hard that domain
is to verify. Only selected reviewers' effort answers are consumed; uncertainty
on an unused role has no effect. All questions run independently, so an effort
question never depends on another answer in the request.

`reviewerPlan` maps each selected role to:

| `reasoningEffort` | `modelTier` | Intended work |
| --- | --- | --- |
| `low` | `cheaper-capable` | Direct local checks |
| `medium` | `cheaper-capable` | Trace callers, state, contracts, or edge cases |
| `high` | `stronger-capable` | Deep interacting invariants or uncertain effort |

Accept Jev's effort choice only at confidence **0.8 or above**. Below that, or
with a missing/invalid effort answer, use **high** for that selected reviewer.
Security and release reviewers have a **medium** floor. Keep the original
choice, confidence, and distribution in `judgment`; the selected effort also
records whether uncertainty or a risk floor changed it. These policy thresholds
need evaluation just like domain-routing thresholds.

Map these portable recommendations to the host's available models and actual
reasoning controls when spawning. Do not invent model IDs or send unsupported
effort arguments. Use the nearest supported level that is at least as strong,
and select a capable stronger coding model for `stronger-capable`. Honor explicit
user model/effort settings. If the host cannot select models or thinking levels,
retain its available settings, describe the inspection depth in the task, and
report that the requested reasoning setting could not be applied. Prompt wording
alone is not a configured thinking level.

On fallback, `reasoningEffort` and `modelTier` are null: the coordinator chooses
them under the ordinary policy. It can always increase effort after inspecting
the actual source. Jev does not choose the coordinator/judge's model or effort.

## Validate before tuning

Run the transport and policy regression tests:

```sh
node --test scripts/route-review.test.mjs
```

They use synthetic provider responses and do not measure Jev accuracy. Before
changing coverage thresholds, evaluate representative labeled diffs: a typo,
small authorization change in an unrelated filename, added per-item query,
packaging change, and ambiguous partial evidence. Compare routing with the
coordinator's domain labels, especially missed security/performance/release
coverage; also measure end-to-end review latency, token usage, and reviewer cost.
Pin the tested model when relying on calibrated thresholds. Never infer that
a review is complete from successful routing.

## Contract sources

Integration checked against the live TypeSafe documentation on 2026-09-18:

- [HTTP API](https://docs.typesafe.ai/api): `POST /v1/systemone`, bearer auth,
  `model`, `state`, `questions`, and typed `answers`.
- [Noul](https://docs.typesafe.ai/primitives/noul): independent yes/no probabilities.
- [Confidence](https://docs.typesafe.ai/confidence): Choice uncertainty and escalation.
- [State](https://docs.typesafe.ai/concepts/state): named text context.
- [Intent routing](https://docs.typesafe.ai/patterns/intent-routing): judgments
  composed by deterministic routing code.
- [Models](https://docs.typesafe.ai/models): aliases and version pinning.
