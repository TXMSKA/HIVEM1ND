id: 003
status: open
from: overseer
to: executor-myapp
date: 2026-09-15 13:40
depends: 002
design: docs/design.md

## Request
Add password reset. Files: src/auth/reset.ts (new), src/auth/routes.ts. Do not touch src/auth/session.ts. Done means: a user receives the mail, the link opens the form, the new password works, all three seen in the browser.

## Report
