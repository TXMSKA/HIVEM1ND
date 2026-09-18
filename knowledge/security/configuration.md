# Configuration

A secret is anything that grants access: API keys, database connection strings, signing keys, tokens, passwords, webhook secrets. Configuration is everything else that changes per environment. They are kept apart, and the first is handled as though every copy were a leak. The checks are in [secrets](protocols/secrets.md).

## Where secrets live

Secrets are environment values set in the hosting panel or a secret manager, never in a file the repository can see. Locally, an ignored environment file. Environment files, service account files, keystores, provisioning profiles and private keys are never committed, not even to a private repository: repositories change visibility and get cloned.

A secret is never pasted into a chat, an issue, a screenshot or a prompt. When an agent needs a secret to run something, a person sets the variable.

## The example file

An example environment file lists every variable the application needs, with empty values and one line of documentation each. It is the contract: a new machine or a new person reads it and knows what to set.

## Public prefixes are public

Variables carrying a public prefix, such as `NEXT_PUBLIC_`, `VITE_` or `EXPO_PUBLIC_`, are inlined into the bundle and shipped to every browser. Only keys designed to be public go there, such as a restricted database key with row policies behind it. A search for the prefixes before every deploy returns nothing sensitive, and the value search after a build is what proves it.

## One key per consumer

The browser gets the restricted key, the server gets the service key, and continuous integration gets a key scoped to what it does. One key per consumer, never reused across projects or environments, so a leak has a small blast radius and a clear owner. Webhook and signing secrets get their own variables and their own rotation.

## Validated at startup

Every required variable is read once at startup, the boot fails with the variable's name when one is missing, and the rest of the code reads a typed object. A missing secret crashes the boot, not a request in the middle of the night. A fallback value for a secret is never written in code.

## Same code in every environment

Development, preview and production differ only by environment values. A branch on the environment name that changes behaviour beyond configuration is a finding, because it means production runs code nobody tested. Debug flags and development tools are enabled by an environment value that production does not set.

## When a secret leaks

The secret is rotated at the provider first, because the old value is compromised from the moment it was pushed. The history rewrite comes second, followed by a force push and a notice to every clone. Deleting the file in a new commit changes nothing, and forks, mirrors and caches survive a rewrite. A leaked key is never kept alive because nobody noticed.

## Scanning

A secret scanner runs in the pre-commit hook and in continuous integration, and a dependency audit runs on every dependency change.

## Logs

Known variable names and anything shaped like a token are redacted before they reach a log line or an error report.
