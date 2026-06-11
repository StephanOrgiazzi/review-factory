# Review rubric

Risk tier:

- `trivial`: <= 10 changed lines, <= 20 changed files, no security-sensitive file.
- `lite`: <= 100 changed lines, <= 20 changed files, no security-sensitive file.
- `full`: security-sensitive file changed, > 100 changed lines, or > 50 changed files.

Security-sensitive path hints:

- auth, oauth, session, token, cookie, permission, role, rbac, acl
- crypto, hash, password, secret, credential, key
- payment, billing, invoice
- upload, file, path, storage
- webhook, callback, redirect
- sql, query, migration, schema, db
- cors, csrf, xss, sanitize, escape
- infra, deploy, release, ci, cd, docker, terraform

Final verdict:

- `LGTM`: no real findings.
- `COMMENTS`: suggestions or one safe warning.
- `NEEDS_ATTENTION`: multiple warnings or a pattern worth human review.
- `BLOCKER`: critical issue or concrete production/security risk.
