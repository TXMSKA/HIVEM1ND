// Void: the words of a page and the difference between two texts.
//
// The diff is the one the full Void app draws: runs of equal, deleted and
// inserted words, so what Void Lite marks reads the same in both.

// The text of a page as the reader shows it: the lines and paragraph breaks the
// reader draws, without the bold and italic marks. Comment offsets count in
// this text, so they do not move when a mark is added or removed.
export function plain(text) {
  const lines = String(text ?? '').split('\n');
  let out = '';
  let gap = '';
  lines.forEach((line, at) => {
    if (line === '') return;
    out += gap + line.replace(/<\/?[bi]>/g, '');
    gap = lines[at + 1] === '' ? '\n\n' : '\n';
  });
  return out;
}

// Hirschberg keeps two score rows only; identical ends are trimmed first, so a
// routine edit of a long page costs almost nothing.
export function commonSequence(a, b) {
  const result = [];
  const possible = new Set(a);
  if (!b.some((value) => possible.has(value))) return result;

  function row(as, ae, bs, be, reverse) {
    let previous = new Uint32Array(be - bs + 1);
    let current = new Uint32Array(be - bs + 1);
    for (let i = 0; i < ae - as; i++) {
      for (let j = 1; j <= be - bs; j++) {
        current[j] = a[reverse ? ae - i - 1 : as + i] === b[reverse ? be - j : bs + j - 1]
          ? previous[j - 1] + 1
          : Math.max(previous[j], current[j - 1]);
      }
      [previous, current] = [current, previous];
      current.fill(0);
    }
    return previous;
  }

  function visit(as, ae, bs, be) {
    while (as < ae && bs < be && a[as] === b[bs]) result.push([as++, bs++]);
    let tail = 0;
    while (as < ae && bs < be && a[ae - 1] === b[be - 1]) { ae--; be--; tail++; }
    if (as < ae && bs < be) {
      if (ae - as === 1) {
        for (let j = bs; j < be; j++) if (a[as] === b[j]) { result.push([as, j]); break; }
      } else {
        const mid = (as + ae) >>> 1;
        let split = 0;
        const left = row(as, mid, bs, be, false);
        const right = row(mid, ae, bs, be, true);
        let score = -1;
        for (let j = 0; j <= be - bs; j++) {
          if (left[j] + right[be - bs - j] > score) { score = left[j] + right[be - bs - j]; split = j; }
        }
        visit(as, mid, bs, bs + split);
        visit(mid, ae, bs + split, be);
      }
    }
    for (let i = 0; i < tail; i++) result.push([ae + i, be + i]);
  }

  visit(0, a.length, 0, b.length);
  return result;
}

// The person's text and a text changed from outside, both made from the same
// base: the stretches only one side changed are both kept, as the page's words
// are compared token by token. Null when both changed the same stretch, and
// then the caller picks a side.
export function merge(base, mine, theirs) {
  if (mine === theirs) return mine;
  if (mine === base) return theirs;
  if (theirs === base) return mine;
  const segmenter = new Intl.Segmenter('en', { granularity: 'word' });
  const tokens = (text) => Array.from(segmenter.segment(text), (item) => item.segment);
  const a = tokens(base);
  const b = tokens(mine);
  const c = tokens(theirs);
  const toMine = new Map(commonSequence(a, b));
  const toTheirs = new Map(commonSequence(a, c));
  const out = [];
  let ai = 0;
  let bi = 0;
  let ci = 0;
  const settle = (aj, bj, cj) => {
    const was = a.slice(ai, aj).join('');
    const mineHere = b.slice(bi, bj).join('');
    const theirsHere = c.slice(ci, cj).join('');
    if (mineHere === theirsHere || theirsHere === was) out.push(mineHere);
    else if (mineHere === was) out.push(theirsHere);
    else return false;
    return true;
  };
  // A base token that both sides kept splits the text into stretches that are settled one by one.
  for (let j = 0; j < a.length; j++) {
    if (!toMine.has(j) || !toTheirs.has(j)) continue;
    if (!settle(j, toMine.get(j), toTheirs.get(j))) return null;
    out.push(a[j]);
    ai = j + 1;
    bi = toMine.get(j) + 1;
    ci = toTheirs.get(j) + 1;
  }
  return settle(a.length, b.length, c.length) ? out.join('') : null;
}

// Runs of { kind: 'equal' | 'delete' | 'insert', text } over the plain text of
// both versions, joined so that one run is one stretch of words.
export function wordDiff(before, after) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'word' });
  const tokens = (text) => Array.from(segmenter.segment(text), (item) => item.segment);
  const a = tokens(plain(before));
  const b = tokens(plain(after));
  const runs = [];
  const add = (kind, text) => {
    if (!text) return;
    if (runs.at(-1)?.kind === kind) runs[runs.length - 1].text += text;
    else runs.push({ kind, text });
  };
  let ai = 0;
  let bi = 0;
  for (const [i, j] of [...commonSequence(a, b), [a.length, b.length]]) {
    add('delete', a.slice(ai, i).join(''));
    add('insert', b.slice(bi, j).join(''));
    if (i < a.length) add('equal', a[i]);
    ai = i + 1;
    bi = j + 1;
  }
  return runs;
}
