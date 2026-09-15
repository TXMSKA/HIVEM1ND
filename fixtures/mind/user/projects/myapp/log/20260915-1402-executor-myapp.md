unit: executor-myapp
date: 2026-09-15 14:02
branch: feat/login
commits: 3f2a9c1..8b1d044
task: 003

Added the reset flow in src/auth/reset.ts and its route. The mail template is a plain-text stub, to be replaced. Verify: request a reset from /login, open the link from the console output, set a new password, log in.
