import { readFile, writeFile } from 'node:fs/promises';

const boardPath = 'C:/Users/ttasc/OneDrive/M1ND/.blueprint/ONEM1ND/blueprint/0e1a1d00-5c05-4a11-9e7a-20261108a001.json';
const board = JSON.parse(await readFile(boardPath, 'utf8'));

function terminalOutput(node) {
  if (!node) return null;
  if (node.name === 'Terminal output' && typeof node.value === 'string') return node.value;
  for (const child of node.kids ?? []) {
    const found = terminalOutput(child);
    if (found) return found;
  }
  return null;
}

const frames = board.screens.map(screen => ({
  id: screen.id,
  title: screen.title,
  lang: screen.lang,
  pageId: screen.pageId,
  output: terminalOutput(screen.root),
}));
const missing = frames.filter(frame => !frame.output);
if (missing.length) throw new Error(`Missing terminal output: ${missing.map(frame => frame.title).join(', ')}`);
const fixture = {
  boardId: board.id,
  source: 'C:\\Users\\ttasc\\OneDrive\\M1ND\\.blueprint\\ONEM1ND\\blueprint\\0e1a1d00-5c05-4a11-9e7a-20261108a001.json',
  note: 'Terminal output values from that board. Tests prefer the board file when it is present.',
  frames,
};
await writeFile(new URL('../test/fixtures/sign-in-board-output.json', import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`frames ${frames.length}`);
