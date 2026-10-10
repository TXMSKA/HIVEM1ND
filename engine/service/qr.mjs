const SIZE = 37;
const DATA_CODEWORDS = 108;
const PARITY_CODEWORDS = 26;
const MAX_BYTES = 106;

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

export function encodeQr(text, { mask = null } = {}) {
  const bytes = Buffer.from(String(text), 'utf8');
  if (bytes.length > MAX_BYTES) {
    const error = new Error('QR payload exceeds 106 bytes.');
    error.code = 'qr_too_large';
    throw error;
  }
  const data = dataCodewords(bytes);
  const codewords = [...data, ...parity(data)];
  const bits = [];
  for (const word of codewords) {
    for (let shift = 7; shift >= 0; shift -= 1) bits.push(((word >> shift) & 1) === 1);
  }
  for (let index = 0; index < 7; index += 1) bits.push(false);
  const base = blank();
  const { modules, isFunction } = base;
  const cells = dataCells(isFunction);
  if (cells.length !== 1079 || bits.length !== 1079) {
    throw new Error('QR writable cell count is not 1079.');
  }
  for (let index = 0; index < cells.length; index += 1) {
    const [x, y] = cells[index];
    modules[y][x] = bits[index];
  }
  let best = null;
  const candidates = mask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [mask];
  for (const candidate of candidates) {
    const drawn = applyMask(modules, isFunction, candidate);
    const score = penalty(drawn);
    if (!best || score < best.score || (score === best.score && candidate < best.mask)) {
      best = { mask: candidate, score, modules: drawn };
    }
  }
  return { modules: best.modules, mask: best.mask, penalty: best.score, size: SIZE };
}

export function penalty(modules) {
  let score = 0;
  score += runPenalty(modules, false);
  score += runPenalty(modules, true);
  for (let y = 0; y < SIZE - 1; y += 1) {
    for (let x = 0; x < SIZE - 1; x += 1) {
      const color = modules[y][x];
      if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) score += 3;
    }
  }
  score += finderPenalty(modules, false);
  score += finderPenalty(modules, true);
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark += 1;
  const percent = Math.abs(dark * 100 / (SIZE * SIZE) - 50);
  score += Math.floor(percent / 5) * 10;
  return score;
}

export function formatBits(mask) {
  const data = (1 << 3) | mask;
  let remainder = data << 10;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if (((remainder >>> bit) & 1) !== 0) remainder ^= 0x537 << (bit - 10);
  }
  return ((data << 10) | (remainder & 0x3ff)) ^ 0x5412;
}

export function toSvg(result, scale = 4) {
  const quiet = 4;
  const dimension = (SIZE + quiet * 2) * scale;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 ${dimension} ${dimension}">`];
  parts.push(`<rect x="0" y="0" width="${dimension}" height="${dimension}" fill="#ffffff"/>`);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (!result.modules[y][x]) continue;
      parts.push(`<rect x="${(x + quiet) * scale}" y="${(y + quiet) * scale}" width="${scale}" height="${scale}" fill="#000000"/>`);
    }
  }
  parts.push('</svg>');
  return parts.join('');
}

export function matrixText(modules) {
  return modules.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('\n');
}

function dataCodewords(bytes) {
  const bits = [0, 1, 0, 0];
  for (let shift = 7; shift >= 0; shift -= 1) bits.push(((bytes.length >> shift) & 1) === 1);
  for (const byte of bytes) {
    for (let shift = 7; shift >= 0; shift -= 1) bits.push(((byte >> shift) & 1) === 1);
  }
  const terminator = Math.min(4, DATA_CODEWORDS * 8 - bits.length);
  for (let index = 0; index < terminator; index += 1) bits.push(false);
  while (bits.length % 8 !== 0) bits.push(false);
  const words = [];
  for (let index = 0; index < bits.length; index += 8) {
    let word = 0;
    for (let shift = 0; shift < 8; shift += 1) word = (word << 1) | (bits[index + shift] ? 1 : 0);
    words.push(word);
  }
  const pads = [0xec, 0x11];
  let pad = 0;
  while (words.length < DATA_CODEWORDS) {
    words.push(pads[pad % 2]);
    pad += 1;
  }
  return words;
}

function multiply(a, b) {
  let result = 0;
  for (let i = 0; i < 8; i += 1) {
    if (b & 1) result ^= a;
    b >>>= 1;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
  }
  return result;
}

function parity(data) {
  let generator = [1];
  let root = 1;
  for (let degree = 0; degree < PARITY_CODEWORDS; degree += 1) {
    const next = Array(generator.length + 1).fill(0);
    generator.forEach((coefficient, i) => {
      next[i] ^= coefficient;
      next[i + 1] ^= multiply(coefficient, root);
    });
    generator = next;
    root = multiply(root, 2);
  }
  const work = [...data, ...Array(PARITY_CODEWORDS).fill(0)];
  for (let i = 0; i < DATA_CODEWORDS; i += 1) {
    const factor = work[i];
    for (let j = 0; j < generator.length; j += 1) work[i + j] ^= multiply(factor, generator[j]);
  }
  return work.slice(DATA_CODEWORDS);
}

function blank() {
  const modules = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const isFunction = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  drawFinder(modules, isFunction, 3, 3);
  drawFinder(modules, isFunction, 33, 3);
  drawFinder(modules, isFunction, 3, 33);
  for (let index = 0; index < SIZE; index += 1) {
    if (isFunction[6][index]) continue;
    paint(modules, isFunction, index, 6, index % 2 === 0);
    if (isFunction[index][6]) continue;
    paint(modules, isFunction, 6, index, index % 2 === 0);
  }
  drawAlignment(modules, isFunction, 30, 30);
  for (let index = 0; index < 15; index += 1) {
    const [x, y] = formatPrimary(index);
    isFunction[y][x] = true;
    const [sx, sy] = formatSecondary(index);
    isFunction[sy][sx] = true;
  }
  paint(modules, isFunction, 8, 29, true);
  return { modules, isFunction };
}

function drawFinder(modules, isFunction, cx, cy) {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      paint(modules, isFunction, x, y, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(modules, isFunction, cx, cy) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      paint(modules, isFunction, cx + dx, cy + dy, distance !== 1);
    }
  }
}

function paint(modules, isFunction, x, y, dark) {
  modules[y][x] = dark;
  isFunction[y][x] = true;
}

function dataCells(isFunction) {
  const cells = [];
  let x = SIZE - 1;
  while (x > 0) {
    if (x === 6) x = 5;
    const upward = ((x + 1) & 2) === 0;
    for (let row = 0; row < SIZE; row += 1) {
      const y = upward ? SIZE - 1 - row : row;
      for (const column of [x, x - 1]) {
        if (!isFunction[y][column]) cells.push([column, y]);
      }
    }
    x -= 2;
  }
  return cells;
}

function applyMask(source, isFunction, mask) {
  const modules = source.map((row) => row.slice());
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (isFunction[y][x]) continue;
      if (MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
    }
  }
  const bits = formatBits(mask);
  for (let index = 0; index < 15; index += 1) {
    const dark = ((bits >> index) & 1) === 1;
    const [x, y] = formatPrimary(index);
    modules[y][x] = dark;
    const [sx, sy] = formatSecondary(index);
    modules[sy][sx] = dark;
  }
  modules[29][8] = true;
  return modules;
}

function formatPrimary(bit) {
  if (bit <= 5) return [8, bit];
  if (bit === 6) return [8, 7];
  if (bit === 7) return [8, 8];
  if (bit === 8) return [7, 8];
  return [14 - bit, 8];
}

function formatSecondary(bit) {
  if (bit <= 7) return [36 - bit, 8];
  return [8, 22 + bit];
}

function runPenalty(modules, vertical) {
  let score = 0;
  for (let a = 0; a < SIZE; a += 1) {
    let run = 1;
    let previous = vertical ? modules[0][a] : modules[a][0];
    for (let b = 1; b < SIZE; b += 1) {
      const color = vertical ? modules[b][a] : modules[a][b];
      if (color === previous) run += 1;
      else {
        if (run >= 5) score += 3 + run - 5;
        run = 1;
        previous = color;
      }
    }
    if (run >= 5) score += 3 + run - 5;
  }
  return score;
}

function finderPenalty(modules, vertical) {
  let score = 0;
  const pattern = [true, false, true, true, true, false, true];
  for (let a = 0; a < SIZE; a += 1) {
    const line = [];
    for (let b = 0; b < SIZE; b += 1) line.push(vertical ? modules[b][a] : modules[a][b]);
    for (let index = 0; index <= line.length - 7; index += 1) {
      let found = true;
      for (let offset = 0; offset < 7; offset += 1) {
        if (line[index + offset] !== pattern[offset]) found = false;
      }
      if (!found) continue;
      const before = countLight(line, index - 1, -1);
      const after = countLight(line, index + 7, 1);
      if (before >= 4) score += 40;
      if (after >= 4) score += 40;
    }
  }
  return score;
}

function countLight(line, start, step) {
  if (start < 0 || start >= line.length) return 4;
  let count = 0;
  for (let index = start; index >= 0 && index < line.length; index += step) {
    if (line[index]) return count;
    count += 1;
  }
  return count + 4;
}
