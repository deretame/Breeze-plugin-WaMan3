/**
 * 运行时 polyfill：保证插件的加解密与二进制能力在任何宿主下可用。
 *
 * 背景：`src/crypto.ts` 依赖 Breeze 宿主注入的全局 `crypto`
 *（`requireCryptoLike()`）和全局 `bytesFromBase64`。如果宿主版本变化导致
 * 方法缺失，插件会在调用时直接炸掉（含公开内容）。本文件只补缺失、
 * 不覆盖已有实现；加载顺序上必须排在 `crypto.ts` 首次调用之前
 *（`crypto.ts` 顶部 `import "./polyfill"` 保证了这一点）。
 *
 * 兜底链（按优先序）：
 * 1. 宿主已注入的全局 `crypto`（Breeze App 内，首选；已齐全则本文件无操作）；
 * 2. Node.js 内建 crypto（`tsx` / Node 调试环境），经 `new Function`
 *    动态获取，避免被 rspack `target: web` 静态分析打包进 bundle；
 * 3. 仍不可用则保持缺失，由调用方抛出明确错误（不静默造假数据）。
 */

export interface NodeCryptoHasher {
  update(data: Uint8Array | string, encoding?: string): NodeCryptoHasher;
  digest(encoding: "hex"): string;
}

export interface NodeCryptoDecipher {
  setAutoPadding(on: boolean): void;
  update(data: Uint8Array): Uint8Array;
  final(): Uint8Array;
}

export interface NodeCryptoShim {
  createHash(algo: string): NodeCryptoHasher;
  createHmac(algo: string, key: Uint8Array | string): NodeCryptoHasher;
  createDecipheriv(algo: string, key: Uint8Array, iv: Uint8Array | null): NodeCryptoDecipher;
  randomBytes(size: number): Uint8Array;
}

type CryptoMethodTable = Record<string, unknown>;

function readGlobal(name: string): unknown {
  try {
    return Reflect.get(globalThis, name);
  } catch {
    return undefined;
  }
}

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === "function";
}

function hasPluginCryptoMethods(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "md5" in value &&
    isFunction(value.md5) &&
    "aesEcbPkcs7Decrypt" in value &&
    isFunction(value.aesEcbPkcs7Decrypt) &&
    "aesCbcPkcs7Decrypt" in value &&
    isFunction(value.aesCbcPkcs7Decrypt)
  );
}

/**
 * 方法存在性校验通过后收窄为可调用的 Node crypto 形状。
 * 四个方法的存在性逐一校验；调用形状与 Node 文档一致。
 */
function asNodeCryptoShim(value: unknown): NodeCryptoShim | undefined {
  if (value === null || typeof value !== "object") return undefined;
  for (const key of ["createHash", "createHmac", "createDecipheriv", "randomBytes"] as const) {
    if (!(key in value)) return undefined;
  }
  const shim = value as NodeCryptoShim;
  if (
    !isFunction(shim.createHash) ||
    !isFunction(shim.createHmac) ||
    !isFunction(shim.createDecipheriv) ||
    !isFunction(shim.randomBytes)
  ) {
    return undefined;
  }
  return shim;
}

/**
 * 动态获取 Node 内建 crypto。禁止静态 `import "node:crypto"`：
 * rspack web 构建无法打包它。new Function 让 bundler 无法静态追踪。
 */
function loadNodeCrypto(): NodeCryptoShim | undefined {
  try {
    // 动态 require 查找；bundler 必须无法静态解析 "node:crypto"。
    const getRequire = new Function(
      "return typeof require !== 'undefined' ? require : undefined",
    ) as () => ((id: string) => unknown) | undefined;
    const req = getRequire();
    if (typeof req === "function") {
      const shim = asNodeCryptoShim(req("node:crypto"));
      if (shim) return shim;
    }
  } catch {
    // ignore：非 Node 环境
  }
  try {
    const proc = readGlobal("process");
    if (
      proc !== null &&
      typeof proc === "object" &&
      "getBuiltinModule" in proc &&
      isFunction(proc.getBuiltinModule)
    ) {
      const getBuiltin = proc.getBuiltinModule as (id: string) => unknown;
      const shim = asNodeCryptoShim(getBuiltin("node:crypto"));
      if (shim) return shim;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function toBytes(input: unknown): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (typeof input === "string") return new TextEncoder().encode(input);
  if (Array.isArray(input)) return Uint8Array.from(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError("polyfill crypto：不支持的输入类型");
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64EncodeFallback(input: Uint8Array): string {
  const data = toBytes(input);
  let out = "";
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i];
    const b = i + 1 < data.length ? data[i + 1] : 0;
    const c = i + 2 < data.length ? data[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    out += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    out += i + 1 < data.length ? BASE64_ALPHABET[(triple >> 6) & 0x3f] : "=";
    out += i + 2 < data.length ? BASE64_ALPHABET[triple & 0x3f] : "=";
  }
  return out;
}

function sextetValue(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
}

/**
 * 标准 base64 解码；同时容忍无填充输入（服务端偶发省略 `=` 填充）。
 * 只在宿主缺失 `bytesFromBase64` 时安装，不覆盖已有实现。
 *
 * 注意：`=` 只出现在末尾且至多两个；解码时按 4 字符一组处理，
 * 有填充的组按实际有效 sextet 数量输出 1~2 字节，不能先全按 3 字节
 * 输出再整体截断（旧实现错在这里：88 字符输入丢了最后一组 2 字节，
 * 输出 61 而非 64 字节，导致 AES 整块解密失败）。
 */
function base64DecodeFallback(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, "");
  const bytes: number[] = [];
  for (let i = 0; i + 4 <= clean.length; i += 4) {
    const group = clean.slice(i, i + 4);
    const padding = group.endsWith("==") ? 2 : group.endsWith("=") ? 1 : 0;
    const sextets = Array.from(group.slice(0, 4 - padding), (ch) => sextetValue(ch.charCodeAt(0)));
    if (sextets.some((v) => v < 0)) {
      continue;
    }
    const n =
      padding === 0
        ? (sextets[0] << 18) | (sextets[1] << 12) | (sextets[2] << 6) | sextets[3]
        : padding === 1
          ? (sextets[0] << 18) | (sextets[1] << 12) | (sextets[2] << 6)
          : (sextets[0] << 18) | (sextets[1] << 12);
    bytes.push((n >> 16) & 0xff);
    if (padding < 2) bytes.push((n >> 8) & 0xff);
    if (padding === 0) bytes.push(n & 0xff);
  }
  return Uint8Array.from(bytes);
}

function ensureBase64Globals(): void {
  if (!isFunction(readGlobal("bytesFromBase64"))) {
    Reflect.set(globalThis, "bytesFromBase64", (text: string) => base64DecodeFallback(text));
  }
  if (!isFunction(readGlobal("bytesToBase64"))) {
    Reflect.set(globalThis, "bytesToBase64", (input: Uint8Array) =>
      base64EncodeFallback(toBytes(input)),
    );
  }
}

function ensureAbortSignalTimeout(): void {
  const signal = readGlobal("AbortSignal") as { timeout?: unknown } | undefined;
  const controller = readGlobal("AbortController") as
    | (new () => { abort: () => void; signal: AbortSignal })
    | undefined;
  if (!signal || !controller) return;
  if (typeof signal.timeout === "function") return;
  try {
    signal.timeout = (ms: number) => {
      const ctrl = new controller();
      setTimeout(
        () => {
          try {
            ctrl.abort();
          } catch {
            // ignore
          }
        },
        Math.max(0, Number(ms) || 0),
      );
      return ctrl.signal;
    };
  } catch {
    // 宿主对象不可写：调用方做特性检测后降级，见 fetchImageBytes。
  }
}

function md5WithNode(nodeCrypto: NodeCryptoShim, input: unknown): Promise<string> {
  const hasher = nodeCrypto.createHash("md5");
  if (typeof input === "string") {
    hasher.update(input, "utf8");
  } else {
    hasher.update(toBytes(input));
  }
  return Promise.resolve(hasher.digest("hex"));
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function aesDecryptWithNode(
  nodeCrypto: NodeCryptoShim,
  algorithm: "aes-256-ecb" | "aes-128-cbc",
  input: unknown,
  keyRaw: string,
  ivRaw?: string,
): Promise<Uint8Array> {
  const key = new TextEncoder().encode(String(keyRaw));
  const iv = algorithm === "aes-128-cbc" ? new TextEncoder().encode(String(ivRaw ?? "")) : null;
  const decipher = nodeCrypto.createDecipheriv(algorithm, key, iv);
  decipher.setAutoPadding(true);
  return Promise.resolve(concatBytes([decipher.update(toBytes(input)), decipher.final()]));
}

/**
 * 只补插件实际使用的方法，不覆盖宿主已有实现；加密方法不需要，不补
 *（避免给出未经验证的语义）。
 *
 * 注意：breeze-plugin-kit 的 requireCryptoLike() 做形状检查
 *（createHash/createHmac/randomBytes 三者缺一不可）。本补丁的 Node 透传
 * 必须同时满足该形状，否则补了 md5 也会被判定为不可用。
 */
function ensureCryptoMethods(): void {
  if (hasPluginCryptoMethods(readGlobal("crypto"))) return;
  const nodeCrypto = loadNodeCrypto();
  if (!nodeCrypto) {
    // 无兜底可用：保留现场，让 requireCryptoLike() 抛明确错误。
    return;
  }

  // Node 的 globalThis.crypto 是 getter-only accessor：直接替换整个对象
  // 在严格模式下失败；原地补方法则各方读到的仍是同一个对象。
  const existing = readGlobal("crypto");
  const target: CryptoMethodTable =
    existing !== null && typeof existing === "object" ? (existing as CryptoMethodTable) : {};
  target.md5 = (input: unknown) => md5WithNode(nodeCrypto, input);
  target.aesEcbPkcs7Decrypt = (input: unknown, keyRaw: string) =>
    aesDecryptWithNode(nodeCrypto, "aes-256-ecb", input, keyRaw);
  target.aesCbcPkcs7Decrypt = (input: unknown, keyRaw: string, ivRaw: string) =>
    aesDecryptWithNode(nodeCrypto, "aes-128-cbc", input, keyRaw, ivRaw);
  target.createHash = (algo: string) => nodeCrypto.createHash(algo);
  target.createHmac = (algo: string, key: Uint8Array | string) => nodeCrypto.createHmac(algo, key);
  target.randomBytes = (size: number) => nodeCrypto.randomBytes(size);

  try {
    if (existing === null || typeof existing !== "object") {
      Reflect.set(globalThis, "crypto", target);
    }
    Reflect.set(globalThis, "nodeCryptoCompat", target);
  } catch {
    // 宿主对象不可写：调用方会收到明确错误，不静默。
  }
}

ensureBase64Globals();
ensureAbortSignalTimeout();
ensureCryptoMethods();
