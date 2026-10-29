import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchElectronCheck, runNativeCheck } from './gui-electron-check.mjs';

const script = fileURLToPath(import.meta.url);

// Importing this executable is inert too; only a direct launch runs the check.
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const native = Boolean(process.versions.electron && process.type === 'browser');
  const importsOnly = process.argv.includes('--imports-only');
  const options = { root: fileURLToPath(new URL('../', import.meta.url)), script, importsOnly, timeoutMs: importsOnly ? (native ? 20_000 : 25_000) : undefined };
  process.stdout.write('Electron check starting with an isolated profile.\n');
  // Electron waits for main-module evaluation before emitting ready.
  if (native) void runNativeCheck(options);
  else process.exitCode = await launchElectronCheck(options);
}
