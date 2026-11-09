import { connect, installedApp, resolveHome } from './vault-client/index.js';

// The Cosmic password saved in the local Vault for the signed-in account (Quantum docs/keys.md, Local Vault password provider).
// Only the trusted service process calls it. The password is never logged, cached or returned to the terminal.
export function createVaultPasswordProvider({ connectVault = connect, installed = () => Boolean(installedApp(resolveHome())) } = {}) {
  let client = null;
  async function open() {
    client ??= connectVault({ app: { id: 'hivem1nd', name: 'ONEM1ND', kind: 'cosmic' } });
    try { return await client; } catch (error) { client = null; throw error; }
  }
  return {
    // Installation is the only signal while Vault is locked; a matching login is learnt after unlocking.
    installed() { try { return installed() === true; } catch { return false; } },
    async status(email) { return (await (await open()).cosmic.passwordStatus(email)).state; },
    async unlock(password) { await (await open()).unlock(password); },
    async read(email) { return (await (await open()).cosmic.readPassword(email)).password; },
    async close() {
      const current = client;
      client = null;
      try { await (await current)?.close(); } catch { /* Vault may already be gone. */ }
    },
  };
}
