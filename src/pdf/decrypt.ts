import {
  PDFArray, PDFDict, PDFHexString, PDFInvalidObject, PDFName, PDFNumber, PDFObject, PDFObjectParser,
  PDFObjectStreamParser, PDFParser, PDFRawStream, PDFRef, PDFString, PDFWriter,
} from "pdf-lib";
import { aesCbcDecryptNoPad, aesCbcEncryptNoPad, md5, rc4, shaDigest } from "./crypto";

export class PasswordRequiredError extends Error { name = "PasswordRequiredError" }

type Method = "none" | "rc4" | "aes128" | "aes256";

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);
const SALT_ALT = Uint8Array.from([0x73, 0x41, 0x6c, 0x54]);
const ZERO_IV = new Uint8Array(16);

const n = (s: string) => PDFName.of(s);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function numberOf(obj: PDFObject | undefined, fallback: number): number {
  return obj instanceof PDFNumber ? obj.asNumber() : fallback;
}

function bytesOf(obj: PDFObject | undefined): Uint8Array {
  return obj instanceof PDFString || obj instanceof PDFHexString ? obj.asBytes() : new Uint8Array(0);
}

function isString(obj: PDFObject | undefined): obj is PDFString | PDFHexString {
  return obj instanceof PDFString || obj instanceof PDFHexString;
}

function pdfBool(obj: PDFObject | undefined, fallback: boolean): boolean {
  if (obj === undefined) return fallback;
  const s = obj.toString();
  return s === "true" ? true : s === "false" ? false : fallback;
}

function padPassword(pw: Uint8Array): Uint8Array {
  return concat(pw.subarray(0, 32), PAD).subarray(0, 32);
}

async function hash2B(pw: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let k = await shaDigest("SHA-256", concat(pw, salt, udata));
  for (let i = 0; ; ) {
    const unit = concat(pw, k, udata);
    const k1 = new Uint8Array(unit.length * 64);
    for (let r = 0; r < 64; r++) k1.set(unit, r * unit.length);
    const e = aesCbcEncryptNoPad(k.subarray(0, 16), k.subarray(16, 32), k1);
    let sum = 0;
    for (let j = 0; j < 16; j++) sum += e[j];
    const mod = sum % 3;
    k = await shaDigest(mod === 0 ? "SHA-256" : mod === 1 ? "SHA-384" : "SHA-512", e);
    i++;
    if (!(i < 64 || e[e.length - 1] > i - 32)) break;
  }
  return k.subarray(0, 32);
}

function keyLengthBytes(encrypt: PDFDict, v: number, r: number): number {
  if (v === 5) return 32;
  if (r === 2) return 5;
  const lenObj = encrypt.lookup(n("Length"));
  if (v >= 4) {
    let bits = lenObj instanceof PDFNumber ? lenObj.asNumber() : undefined;
    if (bits === undefined) {
      const cf = encrypt.lookup(n("CF"));
      const stmF = encrypt.lookup(n("StmF"));
      const f = cf instanceof PDFDict && stmF instanceof PDFName ? cf.lookup(stmF) : undefined;
      const l = f instanceof PDFDict ? f.lookup(n("Length")) : undefined;
      if (l instanceof PDFNumber) bits = l.asNumber() <= 40 ? l.asNumber() * 8 : l.asNumber();
    }
    return Math.max(5, Math.min(16, (bits ?? 128) / 8));
  }
  return Math.max(5, Math.min(16, numberOf(lenObj, 40) / 8));
}

/** Derives the file encryption key for the Standard security handler (throws PasswordRequiredError). */
export async function computeFileKey(
  encrypt: PDFDict,
  id0: Uint8Array,
  password: Uint8Array = new Uint8Array(0),
): Promise<Uint8Array> {
  const v = numberOf(encrypt.lookup(n("V")), 0);
  const r = numberOf(encrypt.lookup(n("R")), 2);
  const o = bytesOf(encrypt.lookup(n("O")));
  const u = bytesOf(encrypt.lookup(n("U")));

  if (r >= 5) {
    const pw = password.subarray(0, 127);
    const hashFn = r === 5
      ? (salt: Uint8Array) => shaDigest("SHA-256", concat(pw, salt))
      : (salt: Uint8Array) => hash2B(pw, salt, new Uint8Array(0));
    if (u.length < 48) throw new Error("Malformed /U in encryption dictionary");
    const check = await hashFn(u.subarray(32, 40));
    if (!equalBytes(check, u.subarray(0, 32))) throw new PasswordRequiredError("Password required");
    const ikey = await hashFn(u.subarray(40, 48));
    const ue = bytesOf(encrypt.lookup(n("UE")));
    return aesCbcDecryptNoPad(ikey, ZERO_IV, ue.subarray(0, 32));
  }

  const p = numberOf(encrypt.lookup(n("P")), 0) | 0;
  const pBytes = Uint8Array.from([p & 255, (p >> 8) & 255, (p >> 16) & 255, (p >> 24) & 255]);
  const encryptMetadata = pdfBool(encrypt.lookup(n("EncryptMetadata")), true);
  const len = keyLengthBytes(encrypt, v, r);
  let h = md5(concat(
    padPassword(password), o.subarray(0, 32), pBytes, id0,
    r >= 4 && !encryptMetadata ? Uint8Array.from([255, 255, 255, 255]) : new Uint8Array(0),
  ));
  if (r >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, len));
  const key = h.slice(0, len);

  if (r === 2) {
    if (!equalBytes(rc4(key, PAD), u.subarray(0, 32))) throw new PasswordRequiredError("Password required");
  } else {
    let x = rc4(key, md5(concat(PAD, id0)));
    for (let i = 1; i < 20; i++) x = rc4(key.map((b) => b ^ i), x);
    if (!equalBytes(x.subarray(0, 16), u.subarray(0, 16))) throw new PasswordRequiredError("Password required");
  }
  return key;
}

function cfMethod(encrypt: PDFDict, filterName: PDFObject | undefined): Method {
  if (!(filterName instanceof PDFName) || filterName === n("Identity")) return "none";
  const cf = encrypt.lookup(n("CF"));
  const f = cf instanceof PDFDict ? cf.lookup(filterName) : undefined;
  const cfm = f instanceof PDFDict ? f.lookup(n("CFM")) : undefined;
  if (cfm === n("V2")) return "rc4";
  if (cfm === n("AESV2")) return "aes128";
  if (cfm === n("AESV3")) return "aes256";
  if (cfm === n("None") || cfm === undefined) return "none";
  throw new Error(`Unsupported crypt filter method ${cfm.toString()}`);
}

interface Crypter {
  stream: Method;
  string: Method;
  key: Uint8Array;
  v5: boolean;
}

function objectKey(c: Crypter, ref: PDFRef, method: Method): Uint8Array {
  if (c.v5) return c.key;
  const num = ref.objectNumber, gen = ref.generationNumber;
  const parts = [c.key, Uint8Array.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255])];
  if (method === "aes128") parts.push(SALT_ALT);
  return md5(concat(...parts)).subarray(0, Math.min(c.key.length + 5, 16));
}

function decryptBytes(c: Crypter, method: Method, data: Uint8Array, ref: PDFRef): Uint8Array {
  if (method === "none") return data;
  const key = objectKey(c, ref, method);
  if (method === "rc4") return rc4(key, data);
  if (data.length < 16) return data;
  const body = data.subarray(16, 16 + ((data.length - 16) >> 4 << 4));
  const plain = aesCbcDecryptNoPad(key, data.subarray(0, 16), body);
  const k = plain.length ? plain[plain.length - 1] : 0;
  return k >= 1 && k <= 16 && k <= plain.length ? plain.slice(0, plain.length - k) : plain;
}

function streamIsExempt(stream: PDFRawStream, encryptMetadata: boolean): boolean {
  const type = stream.dict.lookup(n("Type"));
  if (type === n("XRef")) return true;
  if (!encryptMetadata && type === n("Metadata")) return true;
  const filter = stream.dict.lookup(n("Filter"));
  const parms = stream.dict.lookup(n("DecodeParms"));
  const filters = filter instanceof PDFArray ? filter.asArray().map((f) => stream.dict.context.lookup(f)) : [filter];
  const idx = filters.indexOf(n("Crypt"));
  if (idx < 0) return false;
  const p = parms instanceof PDFArray ? stream.dict.context.lookup(parms.get(idx)) : parms;
  const name = p instanceof PDFDict ? p.lookup(n("Name")) : undefined;
  return name === undefined || name === n("Identity");
}

function decryptStringsIn(obj: PDFObject, fix: (s: PDFString | PDFHexString) => PDFHexString) {
  if (obj instanceof PDFDict) {
    for (const [k, v] of obj.entries()) {
      if (isString(v)) obj.set(k, fix(v));
      else decryptStringsIn(v, fix);
    }
  } else if (obj instanceof PDFArray) {
    obj.asArray().forEach((v, i) => {
      if (isString(v)) obj.set(i, fix(v));
      else decryptStringsIn(v, fix);
    });
  } else if (obj instanceof PDFRawStream) {
    decryptStringsIn(obj.dict, fix);
  }
}

async function withQuietWarn<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = orig; }
}

/**
 * Decrypts a PDF protected with the Standard security handler and an empty user password, returning
 * plaintext bytes. Unencrypted input comes back as the same array. A non-empty user password throws
 * PasswordRequiredError; anything unsupported throws a plain Error.
 */
export async function decryptIfNeeded(bytes: Uint8Array): Promise<{ bytes: Uint8Array; wasEncrypted: boolean }> {
  if (!hasEncryptToken(bytes)) return { bytes, wasEncrypted: false };

  const context = await withQuietWarn(() => PDFParser.forBytesWithOptions(bytes, Infinity, false, false).parseDocument());
  const encObj = context.trailerInfo.Encrypt;
  if (encObj === undefined) return { bytes, wasEncrypted: false };
  const encRef = encObj instanceof PDFRef ? encObj : undefined;
  const encrypt = context.lookup(encObj);
  if (!(encrypt instanceof PDFDict)) throw new Error("Malformed /Encrypt entry");
  if (encrypt.lookup(n("Filter")) !== n("Standard")) {
    const f = encrypt.lookup(n("Filter"));
    throw new Error(`Unsupported encryption filter ${f ? f.toString() : "(none)"}`);
  }

  const idObj = context.trailerInfo.ID;
  const idArr = idObj ? context.lookup(idObj) : undefined;
  const first = idArr instanceof PDFArray ? context.lookup(idArr.get(0)) : undefined;
  const id0 = bytesOf(first);

  const v = numberOf(encrypt.lookup(n("V")), 0);
  const r = numberOf(encrypt.lookup(n("R")), 2);
  if (v < 1 || v > 5 || (v === 5 && r < 5) || (v < 5 && r > 4)) throw new Error(`Unsupported encryption (V ${v}, R ${r})`);
  const key = await computeFileKey(encrypt, id0);

  let crypter: Crypter;
  if (v === 5) {
    const m = cfMethod(encrypt, encrypt.lookup(n("StmF")));
    const s = cfMethod(encrypt, encrypt.lookup(n("StrF")));
    crypter = { stream: m, string: s, key, v5: true };
  } else if (v === 4) {
    crypter = { stream: cfMethod(encrypt, encrypt.lookup(n("StmF"))), string: cfMethod(encrypt, encrypt.lookup(n("StrF"))), key, v5: false };
  } else {
    crypter = { stream: "rc4", string: "rc4", key, v5: false };
  }
  const encryptMetadata = pdfBool(encrypt.lookup(n("EncryptMetadata")), true);

  const skip = new Set<PDFRef>();
  if (encRef) skip.add(encRef);
  if (idObj instanceof PDFRef) skip.add(idObj);

  const snapshot = context.enumerateIndirectObjects().filter(([ref]) => !skip.has(ref));
  const fixStrings = (obj: PDFObject, ref: PDFRef) =>
    decryptStringsIn(obj, (s) => PDFHexString.of(toHex(decryptBytes(crypter, crypter.string, s.asBytes(), ref))));

  const decryptNormal = (ref: PDFRef, obj: PDFObject) => {
    if (isString(obj)) {
      context.assign(ref, PDFHexString.of(toHex(decryptBytes(crypter, crypter.string, obj.asBytes(), ref))));
    } else if (obj instanceof PDFRawStream) {
      if (obj.dict.lookup(n("Type")) === n("XRef")) { context.delete(ref); return; }
      const exempt = streamIsExempt(obj, encryptMetadata);
      fixStrings(obj.dict, ref);
      if (!exempt) context.assign(ref, PDFRawStream.of(obj.dict, decryptBytes(crypter, crypter.stream, obj.contents, ref)));
    } else {
      fixStrings(obj, ref);
    }
  };

  for (const [ref, obj] of snapshot) {
    if (obj instanceof PDFInvalidObject || context.lookup(ref) !== obj) continue;
    decryptNormal(ref, obj);
  }

  for (const [ref, obj] of snapshot) {
    if (!(obj instanceof PDFInvalidObject) || context.lookup(ref) !== obj) continue;
    const data = (obj as unknown as { data: Uint8Array }).data;
    const parsed = await withQuietWarn(async () => PDFObjectParser.forBytes(data, context).parseObject());
    if (parsed instanceof PDFRawStream && parsed.dict.lookup(n("Type")) === n("ObjStm")) {
      fixStrings(parsed.dict, ref);
      const plain = streamIsExempt(parsed, encryptMetadata) ? parsed.contents : decryptBytes(crypter, crypter.stream, parsed.contents, ref);
      const fixed = PDFRawStream.of(parsed.dict, plain);
      context.delete(ref);
      await PDFObjectStreamParser.forStream(fixed).parseIntoContext();
    } else if (parsed instanceof PDFRawStream && parsed.dict.lookup(n("Type")) === n("XRef")) {
      context.delete(ref);
    } else {
      context.assign(ref, parsed);
      decryptNormal(ref, parsed);
    }
  }

  delete context.trailerInfo.Encrypt;
  if (encRef) context.delete(encRef);
  return { bytes: await PDFWriter.forContext(context, Infinity).serializeToBuffer(), wasEncrypted: true };
}

const ENCRYPT_TOKEN = Uint8Array.from("/Encrypt", (c) => c.charCodeAt(0));

function hasEncryptToken(bytes: Uint8Array): boolean {
  const first = ENCRYPT_TOKEN[0];
  const last = bytes.length - ENCRYPT_TOKEN.length;
  outer: for (let i = bytes.indexOf(first); i >= 0 && i <= last; i = bytes.indexOf(first, i + 1)) {
    for (let j = 1; j < ENCRYPT_TOKEN.length; j++) if (bytes[i + j] !== ENCRYPT_TOKEN[j]) continue outer;
    return true;
  }
  return false;
}
