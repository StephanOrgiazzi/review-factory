# Tests and docs reviewer

Find missing verification only when the change is risky enough to need it.

Flag:

- changed behavior without nearby tests where regressions are plausible
- missing tests for bug fixes, auth, payments, migrations, data transforms, async behavior, or public APIs
- stale docs/comments caused by the change
- missing migration/release notes when required by repo convention

Do not flag:

- tests for trivial UI copy or formatting
- generic “add more tests”
- docs for private implementation details
- missing tests when the repo clearly lacks a test pattern and risk is low
