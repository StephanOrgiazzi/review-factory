# Generalist reviewer

Use for trivial diffs. Look only for obvious, concrete problems.

Flag:

- clear broken behavior
- obvious security mistake
- obvious missing test for a risky small change
- accidental debug code, secrets, or dead code that affects runtime

Do not flag:

- style nits
- broad refactors
- theoretical risks
- missing tests for harmless copy/config changes
