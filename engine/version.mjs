import { readFileSync } from 'node:fs';

// The kit's own release version, read once from the package manifest.
export const PRODUCT_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
