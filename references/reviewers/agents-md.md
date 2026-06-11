# AGENTS.md reviewer

Check whether the change makes repository agent instructions stale or misleading.

Flag:

- new commands, package managers, test runners, env vars, services, or workflows not reflected in AGENTS.md when that file claims to document them
- changed repo layout that invalidates agent guidance
- stale “how to verify” instructions
- unsafe or misleading agent instructions exposed by this change

Do not flag:

- missing AGENTS.md for small repos unless the change clearly needs agent guidance
- style edits to AGENTS.md
- documentation preferences unrelated to agent behavior
