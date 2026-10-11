export function encodeHomeQr(payload) {
  const bytes = new TextEncoder().encode(payload);
  if (!/^[\x20-\x7e]+$/.test(payload) || bytes.length > 106) throw new RangeError("QR payload does not fit.");
  const bits = [];
  const append = (value, count) => { for (let i = count - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
  append(4, 4); append(bytes.length, 8);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, 864 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, b) => n * 2 + b, 0));
  for (let pad = 0; data.length < 108; pad += 1) data.push(pad % 2 ? 0x11 : 0xec);
  const multiply = (a, b) => {
    let result = 0;
    while (b) { if (b & 1) result ^= a; b >>>= 1; a <<= 1; if (a & 256) a ^= 0x11d; }
    return result;
  };
  let polynomial = [1], root = 1;
  for (let degree = 0; degree < 26; degree += 1) {
    const next = Array(polynomial.length + 1).fill(0);
    polynomial.forEach((coefficient, i) => { next[i] ^= coefficient; next[i + 1] ^= multiply(coefficient, root); });
    polynomial = next; root = multiply(root, 2);
  }
  const remainder = Array(26).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift(); remainder.push(0);
    for (let i = 0; i < 26; i += 1) remainder[i] ^= multiply(polynomial[i + 1], factor);
  }
  const codewords = [...data, ...remainder];
  const size = 37;
  const matrix = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const set = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    matrix[y][x] = Boolean(dark); reserved[y][x] = true;
  };
  for (let i = 0; i < size; i += 1) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [33, 3], [3, 33]]) {
    for (let y = -4; y <= 4; y += 1) for (let x = -4; x <= 4; x += 1) {
      const distance = Math.max(Math.abs(x), Math.abs(y));
      set(cx + x, cy + y, distance !== 2 && distance !== 4);
    }
  }
  for (let y = -2; y <= 2; y += 1) for (let x = -2; x <= 2; x += 1) {
    set(30 + x, 30 + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
  }
  // L format bits are 01 and mask 0, giving five-bit format data 01000.
  const formatData = 8;
  let bch = formatData;
  for (let i = 0; i < 10; i += 1) bch = (bch << 1) ^ ((bch >>> 9) * 0x537);
  const format = ((formatData << 10) | bch) ^ 0x5412;
  const bit = (i) => Boolean((format >>> i) & 1);
  for (let i = 0; i < 6; i += 1) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
  let position = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let row = 0; row < size; row += 1) {
      const y = upward ? size - 1 - row : row;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (reserved[y][x]) continue;
        const dark = position < codewords.length * 8
          && Boolean((codewords[position >>> 3] >>> (7 - (position & 7))) & 1);
        matrix[y][x] = dark !== ((x + y) % 2 === 0); // mask includes remainder modules
        position += 1;
      }
    }
  }
  if (position !== 1079) throw new Error("Invalid QR module count.");
  return matrix;
}
