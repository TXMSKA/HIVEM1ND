import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Wake leases and locks live on the machine, outside the mind; a test process keeps them in a folder of its own and removes it on exit.
const directory = mkdtempSync(path.join(os.tmpdir(), 'relay-local-'));
process.env.RELAY_LOCAL_STATE_DIR = directory;
process.on('exit', () => { rmSync(directory, { recursive: true, force: true }); });
