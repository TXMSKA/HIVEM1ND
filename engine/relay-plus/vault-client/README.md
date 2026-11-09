# Vault client

A private copy of the built `vault-client` 0.2.0 package (`packages/client/dist`) from Vault commit `c8723a1b464b3268fa72ec8c65f9e1a6f7a95cc9`. Vault does not publish the package; Quantum `docs/keys.md`, Local Vault password provider, asks each host to keep its own copy and refresh it from Vault's build.

ONEM1ND uses only `installedApp`, `resolveHome`, `connect`, `client.unlock` and `client.cosmic.*`, through `engine/relay-plus/vault.mjs`. Do not edit these files; replace them from a newer Vault build.
