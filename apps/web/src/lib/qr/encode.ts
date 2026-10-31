/**
 * Minimal QR Code encoder (ISO/IEC 18004), byte mode only.
 *
 * Why not a package: adding one needs a lockfile/supply-chain approval, and this
 * app only ever encodes short ASCII links and account IDs. The algorithm follows
 * the public-domain structure of Project Nayuki's reference generator
 * (https://www.nayuki.io/page/qr-code-generator-library, MIT): data codewords,
 * Reed-Solomon ECC over GF(256) with polynomial 0x11D, block interleaving,
 * function patterns, all eight masks scored with the standard penalty rules,
 * and BCH-coded format/version information.
 *
 * Verified against an independent decoder outside this repository; the tests
 * pin deterministic matrices so any change to this file is caught.
 */

export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H';

/** Bounds-checked read: a table or matrix miss is a bug, so fail loudly instead of assuming. */
function at<T>(values: ReadonlyArray<T>, index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`index ${index} out of range`);
  return value;
}

const ECC_FORMAT_BITS: Readonly<Record<ErrorCorrection, number>> = { L: 1, M: 0, Q: 3, H: 2 };
const ECC_INDEX: Readonly<Record<ErrorCorrection, number>> = { L: 0, M: 1, Q: 2, H: 3 };

// Index [ecc][version]; index 0 is padding. From the ISO table.
const ECC_CODEWORDS_PER_BLOCK: ReadonlyArray<ReadonlyArray<number>> = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS: ReadonlyArray<ReadonlyArray<number>> = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

/** Raw data modules available in a version, excluding function patterns. */
function numRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(version: number, ecc: ErrorCorrection): number {
  const e = ECC_INDEX[ecc];
  return Math.floor(numRawDataModules(version) / 8) - at(at(ECC_CODEWORDS_PER_BLOCK, e), version) * at(at(NUM_ERROR_CORRECTION_BLOCKS, e), version);
}

// --- Reed-Solomon over GF(2^8), primitive polynomial x^8+x^4+x^3+x^2+1 (0x11D) ---

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result: number[] = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(at(result, j), root);
      if (j + 1 < result.length) result[j] = at(result, j) ^ at(result, j + 1);
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: ReadonlyArray<number>, divisor: ReadonlyArray<number>): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ at(result, 0);
    result.shift();
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = at(result, i) ^ gfMultiply(coef, factor);
    });
  }
  return result;
}

function addEccAndInterleave(data: ReadonlyArray<number>, version: number, ecc: ErrorCorrection): number[] {
  const e = ECC_INDEX[ecc];
  const numBlocks = at(at(NUM_ERROR_CORRECTION_BLOCKS, e), version);
  const blockEccLen = at(at(ECC_CODEWORDS_PER_BLOCK, e), version);
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  const divisor = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const eccBytes = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0); // placeholder so all blocks are equal length
    blocks.push(dat.concat(eccBytes));
  }

  const result: number[] = [];
  for (let i = 0; i < at(blocks, 0).length; i++) {
    blocks.forEach((block, j) => {
      // Skip the padding byte in short blocks.
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(at(block, i));
    });
  }
  return result;
}

// --- Matrix construction ---

class Grid {
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
  constructor(readonly size: number) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  set(x: number, y: number, dark: boolean): void {
    at(this.modules, y)[x] = dark;
    at(this.isFunction, y)[x] = true;
  }
  dark(x: number, y: number): boolean {
    return at(at(this.modules, y), x);
  }
  fixed(x: number, y: number): boolean {
    return at(at(this.isFunction, y), x);
  }
  flip(x: number, y: number): void {
    at(this.modules, y)[x] = !this.dark(x, y);
  }
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function drawFinder(grid: Grid, x: number, y: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const xx = x + dx;
      const yy = y + dy;
      if (xx >= 0 && xx < grid.size && yy >= 0 && yy < grid.size) grid.set(xx, yy, dist !== 2 && dist !== 4);
    }
  }
}

function drawAlignment(grid: Grid, x: number, y: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) grid.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
}

function drawFormatBits(grid: Grid, ecc: ErrorCorrection, mask: number): void {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;
  const size = grid.size;
  for (let i = 0; i <= 5; i++) grid.set(8, i, bit(i));
  grid.set(8, 7, bit(6));
  grid.set(8, 8, bit(7));
  grid.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) grid.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) grid.set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) grid.set(8, size - 15 + i, bit(i));
  grid.set(8, size - 8, true); // always-dark module
}

function drawVersion(grid: Grid, version: number): void {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    grid.set(a, b, dark);
    grid.set(b, a, dark);
  }
}

function drawFunctionPatterns(grid: Grid, version: number, ecc: ErrorCorrection): void {
  const size = grid.size;
  for (let i = 0; i < size; i++) {
    grid.set(6, i, i % 2 === 0);
    grid.set(i, 6, i % 2 === 0);
  }
  drawFinder(grid, 3, 3);
  drawFinder(grid, size - 4, 3);
  drawFinder(grid, 3, size - 4);
  const align = alignmentPositions(version, size);
  const n = align.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // Skip the three corners occupied by finder patterns.
      if (!((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0))) {
        drawAlignment(grid, at(align, i), at(align, j));
      }
    }
  }
  drawFormatBits(grid, ecc, 0); // placeholder, overwritten after masking
  drawVersion(grid, version);
}

function drawCodewords(grid: Grid, codewords: ReadonlyArray<number>): void {
  const size = grid.size;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!grid.fixed(x, y) && i < codewords.length * 8) {
          at(grid.modules, y)[x] = ((at(codewords, i >>> 3) >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}

function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: throw new RangeError('mask');
  }
}

function applyMask(grid: Grid, mask: number): void {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (!grid.fixed(x, y) && maskApplies(mask, x, y)) grid.flip(x, y);
    }
  }
}

// Penalty scoring (ISO 18004 section 7.8.3).
const N1 = 3;
const N2 = 3;
const N3 = 40;
const N4 = 10;

function finderPenaltyCountPatterns(history: ReadonlyArray<number>): number {
  const n = at(history, 1);
  const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
  const first = at(history, 0);
  const last = at(history, 6);
  return (core && first >= n * 4 && last >= n ? 1 : 0) + (core && last >= n * 4 && first >= n ? 1 : 0);
}

function finderPenaltyAddHistory(currentRunLength: number, history: number[], size: number): void {
  if (history[0] === 0) currentRunLength += size; // light border before the first run
  history.pop();
  history.unshift(currentRunLength);
}

function finderPenaltyTerminate(currentRunColor: boolean, currentRunLength: number, history: number[], size: number): number {
  if (currentRunColor) {
    finderPenaltyAddHistory(currentRunLength, history, size);
    currentRunLength = 0;
  }
  currentRunLength += size; // light border after the last run
  finderPenaltyAddHistory(currentRunLength, history, size);
  return finderPenaltyCountPatterns(history);
}

function penaltyScore(grid: Grid): number {
  const size = grid.size;
  let result = 0;

  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let runColor = false;
      let runLength = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < size; b++) {
        const dark = pass === 0 ? grid.dark(b, a) : grid.dark(a, b);
        if (dark === runColor) {
          runLength++;
          if (runLength === 5) result += N1;
          else if (runLength > 5) result++;
        } else {
          finderPenaltyAddHistory(runLength, history, size);
          if (!runColor) result += finderPenaltyCountPatterns(history) * N3;
          runColor = dark;
          runLength = 1;
        }
      }
      result += finderPenaltyTerminate(runColor, runLength, history, size) * N3;
    }
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = grid.dark(x, y);
      if (color === grid.dark(x + 1, y) && color === grid.dark(x, y + 1) && color === grid.dark(x + 1, y + 1)) result += N2;
    }
  }

  let dark = 0;
  for (const row of grid.modules) for (const cell of row) if (cell) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * N4;
  return result;
}

export interface QrMatrix {
  readonly version: number;
  readonly size: number;
  readonly mask: number;
  /** `modules[y][x]`, true = dark. No quiet zone; renderers add 4 modules. */
  readonly modules: ReadonlyArray<ReadonlyArray<boolean>>;
}

/** Encodes UTF-8 text in byte mode at the smallest version that fits. */
export function encodeQr(text: string, ecc: ErrorCorrection = 'M'): QrMatrix {
  const bytes = Array.from(new TextEncoder().encode(text));

  let version = 1;
  let dataCapacityBits = 0;
  for (; version <= 40; version++) {
    dataCapacityBits = numDataCodewords(version, ecc) * 8;
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCapacityBits) break;
  }
  if (version > 40) throw new RangeError('text too long for a QR code');

  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0b0100, 4); // byte mode
  append(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) append(b, 8);
  append(0, Math.min(4, dataCapacityBits - bits.length)); // terminator
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < dataCapacityBits; pad ^= 0xec ^ 0x11) append(pad, 8);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));

  const codewords = addEccAndInterleave(data, version, ecc);
  const size = version * 4 + 17;

  let best: { grid: Grid; mask: number; score: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const grid = new Grid(size);
    drawFunctionPatterns(grid, version, ecc);
    drawCodewords(grid, codewords);
    applyMask(grid, mask);
    drawFormatBits(grid, ecc, mask);
    const score = penaltyScore(grid);
    if (best === null || score < best.score) best = { grid, mask, score };
  }

  if (best === null) throw new Error('no mask evaluated');
  return { version, size, mask: best.mask, modules: best.grid.modules };
}
