// Pure-TS primitives for the PDF Standard security handler. Data sizes are small, so these favour
// clarity over speed. AES is done by hand because WebCrypto always applies PKCS#7 padding, which
// breaks R5/R6 key unwrapping (no padding) and files with sloppy padding.

// ---------- MD5 (RFC 1321) ----------
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0);

export function md5(data: Uint8Array): Uint8Array {
  const len = data.length;
  const padded = new Uint8Array(((len + 8) >> 6 << 6) + 64);
  padded.set(data);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, (len << 3) >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const m = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) m[i] = dv.getUint32(off + i * 4, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      f = (f + a + MD5_K[i] + m[g]) >>> 0;
      a = d; d = c; c = b;
      b = (b + ((f << MD5_S[i]) | (f >>> (32 - MD5_S[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true); ov.setUint32(4, b0, true); ov.setUint32(8, c0, true); ov.setUint32(12, d0, true);
  return out;
}

// ---------- RC4 ----------
export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

// ---------- AES ----------
const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
(() => {
  // Walk the multiplicative group with generator 3 to build the S-box.
  let p = 1, q = 1;
  do {
    p = p ^ ((p << 1) & 255) ^ (p & 0x80 ? 0x1b : 0);
    q = (q ^ (q << 1)) & 255; q = (q ^ (q << 2)) & 255; q = (q ^ (q << 4)) & 255;
    if (q & 0x80) q ^= 0x09;
    const x = q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4);
    SBOX[p] = (x ^ 0x63) & 255;
  } while (p !== 1);
  SBOX[0] = 0x63;
  for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
})();
function rotl8(x: number, n: number): number { return ((x << n) | (x >> (8 - n))) & 255; }

function xtime(x: number): number { return ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 255; }
function gmul(a: number, b: number): number {
  let r = 0;
  while (b) { if (b & 1) r ^= a; a = xtime(a); b >>= 1; }
  return r;
}

function expandKey(key: Uint8Array): { rk: Uint8Array; rounds: number } {
  if (key.length !== 16 && key.length !== 32) throw new Error("Unsupported AES key length");
  const nk = key.length / 4;
  const rounds = nk + 6;
  const rk = new Uint8Array(16 * (rounds + 1));
  rk.set(key);
  let rcon = 1;
  for (let i = nk; i < 4 * (rounds + 1); i++) {
    const t = rk.slice((i - 1) * 4, i * 4);
    if (i % nk === 0) {
      const t0 = t[0];
      t[0] = SBOX[t[1]] ^ rcon; t[1] = SBOX[t[2]]; t[2] = SBOX[t[3]]; t[3] = SBOX[t0];
      rcon = xtime(rcon);
    } else if (nk > 6 && i % nk === 4) {
      for (let k = 0; k < 4; k++) t[k] = SBOX[t[k]];
    }
    for (let k = 0; k < 4; k++) rk[i * 4 + k] = rk[(i - nk) * 4 + k] ^ t[k];
  }
  return { rk, rounds };
}

function addRoundKey(s: Uint8Array, rk: Uint8Array, round: number) {
  for (let i = 0; i < 16; i++) s[i] ^= rk[round * 16 + i];
}

function encryptBlock(rk: Uint8Array, rounds: number, input: Uint8Array): Uint8Array {
  let s = input.slice(0, 16);
  addRoundKey(s, rk, 0);
  for (let round = 1; round <= rounds; round++) {
    const t = new Uint8Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[r + 4 * c] = SBOX[s[r + 4 * ((c + r) % 4)]];
    s = t;
    if (round < rounds) {
      const u = new Uint8Array(16);
      for (let c = 0; c < 4; c++) {
        const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3];
        u[4 * c] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
        u[4 * c + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
        u[4 * c + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
        u[4 * c + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3);
      }
      s = u;
    }
    addRoundKey(s, rk, round);
  }
  return s;
}

function decryptBlock(rk: Uint8Array, rounds: number, input: Uint8Array): Uint8Array {
  let s = input.slice(0, 16);
  addRoundKey(s, rk, rounds);
  for (let round = rounds - 1; round >= 0; round--) {
    const t = new Uint8Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[r + 4 * ((c + r) % 4)] = INV_SBOX[s[r + 4 * c]];
    s = t;
    addRoundKey(s, rk, round);
    if (round > 0) {
      const u = new Uint8Array(16);
      for (let c = 0; c < 4; c++) {
        const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3];
        u[4 * c] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
        u[4 * c + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
        u[4 * c + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
        u[4 * c + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
      }
      s = u;
    }
  }
  return s;
}

export function aesEncryptBlock(key: Uint8Array, block: Uint8Array): Uint8Array {
  const { rk, rounds } = expandKey(key);
  return encryptBlock(rk, rounds, block);
}

export function aesDecryptBlock(key: Uint8Array, block: Uint8Array): Uint8Array {
  const { rk, rounds } = expandKey(key);
  return decryptBlock(rk, rounds, block);
}

/** CBC decrypt without padding handling. Trailing bytes beyond a multiple of 16 are ignored. */
export function aesCbcDecryptNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const { rk, rounds } = expandKey(key);
  const n = data.length >> 4;
  const out = new Uint8Array(n * 16);
  let prev = iv;
  for (let b = 0; b < n; b++) {
    const ct = data.subarray(b * 16, b * 16 + 16);
    const pt = decryptBlock(rk, rounds, ct);
    for (let i = 0; i < 16; i++) out[b * 16 + i] = pt[i] ^ prev[i];
    prev = ct;
  }
  return out;
}

/** CBC encrypt without padding; data length must be a multiple of 16. */
export function aesCbcEncryptNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length % 16 !== 0) throw new Error("AES-CBC data must be a multiple of 16 bytes");
  const { rk, rounds } = expandKey(key);
  const out = new Uint8Array(data.length);
  let prev = iv;
  for (let b = 0; b < data.length / 16; b++) {
    const x = new Uint8Array(16);
    for (let i = 0; i < 16; i++) x[i] = data[b * 16 + i] ^ prev[i];
    prev = encryptBlock(rk, rounds, x);
    out.set(prev, b * 16);
  }
  return out;
}

// ---------- SHA-2 via Web Crypto ----------
export async function shaDigest(alg: "SHA-256" | "SHA-384" | "SHA-512", data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Decrypting this PDF needs Web Crypto (secure context)");
  return new Uint8Array(await subtle.digest(alg, data.slice()));
}
